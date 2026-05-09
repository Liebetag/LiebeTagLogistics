// src/flows/delivery.ts
// Full customer delivery booking flow

import { sendText, sendLocation } from "../services/evolution.ts"
import { getState, setState, updateData, resetState, getUserName, setUserName, upsertUser, db } from "../bot/states.ts"
import { geocode, reverseGeocode, suggestAddresses, inAbuja } from "../services/geocoding.ts"
import { calculateFare, RIDER_PCT } from "../pricing/index.ts"
import { createPaymentLink } from "../services/paystack.ts"
import { parseIntent, isDeliveryIntent } from "../services/nlp.ts"
import { notifyAdmin, sendMenu, backHint, genTrackingRef, genOrderNumber, genDeliveryCode, gmapsLink, deliveryQuote, ITEM_LIST_MSG, WEIGHT_LIST, NEEDS_NAME, parseItems, parseWeight } from "../bot/utils.ts"
import { dispatchAllRiders } from "./dispatch.ts"
import type { ConversationData, Location } from "../types/index.ts"
import { env } from "../utils/env.ts"

export async function handleDelivery(
  phone: string, text: string, lower: string,
  location: Location | null, state: string, data: ConversationData
) {
  // ── PICKUP ADDRESS ────────────────────────────────────────────────────────
  if (state === "PICKUP_ADDRESS") {
    if (location) {
      if (!inAbuja(location.lat, location.lng)) {
        await sendText(phone, `🚫 *Outside delivery zone*\n\nWe serve Abuja FCT and nearby areas only.\n\n${backHint()}`)
        return
      }
      const addr = await reverseGeocode(location.lat, location.lng) ?? `${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}`
      await setState(phone, "DROPOFF_ADDRESS", { pickup: { lat: location.lat, lng: location.lng, address: addr } })
      await sendText(phone, `✅ *Pickup set*\n_${addr}_\n\n🏁 *Step 2 — Drop-off address*\n\nShare your drop-off location pin or type the address:\n\n${backHint()}`)
    } else if (lower === "+" || lower === "use this" || lower === "confirm") {
      const last = data._lastLocation as Location | undefined
      if (last) {
        const addr = await reverseGeocode(last.lat, last.lng) ?? `${last.lat}, ${last.lng}`
        await setState(phone, "DROPOFF_ADDRESS", { pickup: { ...last, address: addr } })
        await sendText(phone, `✅ *Pickup confirmed*\n_${addr}_\n\n🏁 *Drop-off address:*\n\nShare location or type address:\n\n${backHint()}`)
      } else {
        await sendText(phone, `❓ No location saved. Please share your location pin.\n\n${backHint()}`)
      }
    } else {
      const result = await geocode(text)
      if (result) {
        if (!inAbuja(result.lat, result.lng)) {
          await sendText(phone, `🚫 *Outside delivery zone*\n\nPlease enter an Abuja address.\n\n${backHint()}`)
          return
        }
        await setState(phone, "DROPOFF_ADDRESS", { pickup: result })
        await sendText(phone, `✅ *Pickup set*\n_${result.address}_\n\n🏁 *Step 2 — Drop-off address*\n\nShare location or type address:\n\n${backHint()}`)
      } else {
        const sugg = await suggestAddresses(text, 4)
        if (sugg.length) {
          let msg = `❓ Couldn't find *${text.slice(0, 30)}* exactly. Did you mean:\n\n`
          sugg.forEach((s, i) => msg += `${i+1}. ${s.address.slice(0, 55)}\n`)
          msg += `${sugg.length+1}. 📍 Share my location pin\n\n_Reply with a number or share pin_\n\n${backHint()}`
          await setState(phone, "ADDRESS_SUGGEST_PICKUP", { ...data, suggestions: sugg })
          await sendText(phone, msg)
        } else {
          await sendText(phone, `❓ Couldn't find that address.\n\nTry:\n• Tap 📎 → *Location* to share GPS\n• Type specifically e.g. *12 Ahmadu Bello Way, Wuse 2*\n\n${backHint()}`)
        }
      }
    }
    return
  }

  // ── ADDRESS SUGGESTION HANDLERS ───────────────────────────────────────────
  if (state === "ADDRESS_SUGGEST_PICKUP" || state === "ADDRESS_SUGGEST_DROPOFF") {
    const isPickup  = state === "ADDRESS_SUGGEST_PICKUP"
    const sugg      = (data.suggestions ?? []) as Location[]

    if (location) {
      if (!inAbuja(location.lat, location.lng)) {
        await sendText(phone, `🚫 *Outside delivery zone*\n\nPlease share a location within Abuja FCT.\n\n${backHint()}`)
        return
      }
      const addr = await reverseGeocode(location.lat, location.lng) ?? `${location.lat}, ${location.lng}`
      const loc  = { lat: location.lat, lng: location.lng, address: addr }
      if (isPickup) {
        await setState(phone, "DROPOFF_ADDRESS", { ...data, pickup: loc })
        await sendText(phone, `✅ *Pickup set*\n_${addr}_\n\n🏁 Now share your drop-off address:\n\n${backHint()}`)
      } else {
        await updateData(phone, { dropoff: loc })
        await setState(phone, "RECEIVER_NAME", { ...data, dropoff: loc })
        await sendText(phone, `✅ *Drop-off set*\n_${addr}_\n\n👤 What is the *receiver's full name?*\n\n${backHint()}`)
      }
    } else if (/^\d+$/.test(lower)) {
      const idx = parseInt(lower) - 1
      if (idx >= 0 && idx < sugg.length) {
        const s = sugg[idx]!
        if (isPickup) {
          await setState(phone, "DROPOFF_ADDRESS", { ...data, pickup: s })
          await sendText(phone, `✅ *Pickup set*\n_${s.address}_\n\n🏁 Now share or type the *drop-off address:*\n\n${backHint()}`)
        } else {
          await setState(phone, "RECEIVER_NAME", { ...data, dropoff: s })
          await sendText(phone, `✅ *Drop-off set*\n_${s.address}_\n\n👤 What is the *receiver's full name?*\n\n${backHint()}`)
        }
      } else {
        await sendText(phone, "❓ Please share your location pin instead.")
      }
    } else {
      const newSugg = await suggestAddresses(text, 4)
      if (newSugg.length) {
        let msg = "❓ Try one of these:\n\n"
        newSugg.forEach((s, i) => msg += `${i+1}. ${s.address.slice(0, 55)}\n`)
        msg += `${newSugg.length+1}. 📍 Share location pin\n\n_Reply with a number_`
        await updateData(phone, { suggestions: newSugg })
        await sendText(phone, msg)
      } else {
        await sendText(phone, `❓ Still couldn't find that. Please share your location pin using 📎 → Location.\n\n${backHint()}`)
      }
    }
    return
  }

  // ── DROPOFF ADDRESS ───────────────────────────────────────────────────────
  if (state === "DROPOFF_ADDRESS") {
    if (location) {
      if (!inAbuja(location.lat, location.lng)) {
        await sendText(phone, `🚫 *Outside delivery zone*\n\nWe serve Abuja FCT and nearby areas only. Please share a drop-off within this zone.\n\n${backHint()}`)
        return
      }
      const addr = await reverseGeocode(location.lat, location.lng) ?? `${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}`
      await updateData(phone, { dropoff: { lat: location.lat, lng: location.lng, address: addr } })
      await setState(phone, "RECEIVER_NAME", { ...data, dropoff: { lat: location.lat, lng: location.lng, address: addr } })
      await sendText(phone, `✅ *Drop-off set*\n_${addr}_\n\n👤 *Step 3 — Receiver details*\n\nWhat is the *full name* of the receiver?\n\n${backHint()}`)
    } else {
      const result = await geocode(text)
      if (result) {
        if (!inAbuja(result.lat, result.lng)) {
          await sendText(phone, `🚫 *Outside delivery zone*\n\nPlease enter an Abuja address.\n\n${backHint()}`)
          return
        }
        await updateData(phone, { dropoff: result })
        await setState(phone, "RECEIVER_NAME", { ...data, dropoff: result })
        await sendText(phone, `✅ *Drop-off set*\n_${result.address}_\n\n👤 *Step 3 — Receiver details*\n\nWhat is the receiver's *full name?*\n\n_Type their name e.g._ *Amaka Johnson*\n\n${backHint()}`)
      } else {
        const sugg = await suggestAddresses(text, 4)
        if (sugg.length) {
          let msg = `❓ Couldn't find *${text.slice(0, 30)}* exactly. Did you mean:\n\n`
          sugg.forEach((s, i) => msg += `${i+1}. ${s.address.slice(0, 55)}\n`)
          msg += `${sugg.length+1}. 📍 Share my location pin\n\n_Reply with a number or share pin_\n\n${backHint()}`
          await setState(phone, "ADDRESS_SUGGEST_DROPOFF", { ...data, suggestions: sugg })
          await sendText(phone, msg)
        } else {
          await sendText(phone, `❓ Couldn't find that address.\n\nTry:\n• Tap 📎 → *Location*\n• Type more specifically e.g. *12 Ahmadu Bello Way, Wuse 2*\n\n${backHint()}`)
        }
      }
    }
    return
  }

  // ── RECEIVER NAME ─────────────────────────────────────────────────────────
  if (state === "RECEIVER_NAME") {
    if (text.trim().length < 2) {
      await sendText(phone, "❓ Please enter the receiver's full name.")
      return
    }
    await updateData(phone, { recipientName: text.trim() })
    await setState(phone, "RECEIVER_PHONE", { ...data, recipientName: text.trim() })
    await sendText(phone,
      `✅ Receiver: *${text.trim()}*\n\n📱 What is the receiver's *WhatsApp number?*\n\n` +
      `_Type their number e.g._ *08012345678* _or_ *2348012345678*\n\n` +
      `_They will be notified and can track their delivery_\n\n${backHint()}`
    )
    return
  }

  // ── RECEIVER PHONE ────────────────────────────────────────────────────────
  if (state === "RECEIVER_PHONE") {
    const digits = text.replace(/\D/g, "")
    if (digits.length < 10) {
      await sendText(phone, `❓ Please enter a valid phone number.\n_Example: 08012345678_\n\n${backHint()}`)
      return
    }
    const normalized = digits.length === 11 && digits.startsWith("0")
      ? "234" + digits.slice(1)
      : digits.length === 10 ? "234" + digits : digits

    const newData = { ...data, recipientPhone: normalized }

    // If coming from quote flow (fare already calculated), skip to payment
    if (data.fare && data.deliveryType && data.packageDesc) {
      await setState(phone, "PAYMENT_METHOD", newData)
      const fare    = data.fare!
      const pickup  = data.pickup!
      const dropoff = data.dropoff!
      await sendText(phone,
        `✅ Receiver's number: *+${normalized}*\n\n` +
        `📋 *Order Summary*\n\n` +
        `📍 From: _${pickup.address.slice(0, 45)}_\n` +
        `🏁 To: _${dropoff.address.slice(0, 45)}_\n` +
        `📦 ${data.packageDesc} · ${data.weightKg ?? 0}kg\n` +
        `🚀 ${data.deliveryType?.replace("_", " ").toLowerCase()}\n` +
        `👤 Receiver: ${data.recipientName} · +${normalized}\n\n` +
        `💰 *Total: ₦${fare.totalFare.toLocaleString()}*\n\n` +
        `*How would you like to pay?*\n\n1. Pay now online (card / bank transfer)\n2. Cash on pickup\n\n` +
        `_Reply 1 or 2_\n\n${backHint()}`
      )
    } else {
      await setState(phone, "ITEM_SELECT", newData)
      await sendText(phone, `✅ Receiver's number: *+${normalized}*\n\n${ITEM_LIST_MSG}\n\n${backHint()}`)
    }
    return
  }

  // ── ITEM SELECT ───────────────────────────────────────────────────────────
  if (state === "ITEM_SELECT") {
    const items = parseItems(lower)
    if (!items.length) {
      await sendText(phone, `❓ Couldn't understand that.\n\n${ITEM_LIST_MSG}`)
      return
    }
    const needsNames = items.filter(i => NEEDS_NAME.has(i))
    const nextState  = needsNames.length ? "ITEM_NAME_0" : "ITEM_WEIGHT_0"
    await setState(phone, nextState, {
      ...data, items, itemsPending: [...items],
      itemsNeedingNames: needsNames, itemsData: [], currentItemIdx: 0,
    })
    if (needsNames.length) {
      await sendText(phone,
        `✅ Items: *${items.join(", ")}*\n\nWhat specific item are you sending as *${needsNames[0]}*?\n\n` +
        `_e.g. iPhone 15, Samsung TV, Blender..._\n_This helps with claims if needed._\n\n${backHint()}`
      )
    } else {
      await sendText(phone,
        `✅ Items: *${items.join(", ")}*\n\n📦 *Item 1 of ${items.length}: ${items[0]}*\n\n` +
        WEIGHT_LIST.replace("{item}", items[0]!) + `\n\n${backHint()}`
      )
    }
    return
  }

  // ── ITEM NAME ─────────────────────────────────────────────────────────────
  if (state === "ITEM_NAME_0") {
    if (text.trim().length < 2) {
      await sendText(phone, "❓ Please type the specific name e.g. *iPhone 15*")
      return
    }
    const needs   = data.itemsNeedingNames ?? []
    const items   = [...(data.items ?? [])]
    const pending = [...(data.itemsPending ?? [])]
    const cur     = needs[0]!
    const idx     = items.indexOf(cur)
    const named   = `${cur}: ${text.trim()}`
    if (idx !== -1) items[idx] = named
    const newPending   = pending.map(p => p === cur ? named : p)
    const remaining    = needs.slice(1)
    const newData      = { ...data, items, itemsPending: newPending, itemsNeedingNames: remaining }

    if (remaining.length) {
      await setState(phone, "ITEM_NAME_0", newData)
      await sendText(phone, `✅ Noted: *${text.trim()}*\n\nWhat specific item are you sending as *${remaining[0]}*?\n\n${backHint()}`)
    } else {
      await setState(phone, "ITEM_WEIGHT_0", { ...newData, currentItemIdx: 0 })
      await sendText(phone,
        `✅ Items named!\n\n📦 *Item 1 of ${items.length}: ${newPending[0]}*\n\n` +
        WEIGHT_LIST.replace("{item}", newPending[0]!) + `\n\n${backHint()}`
      )
    }
    return
  }

  // ── ITEM WEIGHT ───────────────────────────────────────────────────────────
  if (state === "ITEM_WEIGHT_0") {
    const w = parseWeight(lower)
    if (w === null) {
      await sendText(phone, `❓ Enter weight e.g. *2* or *2kg* or *1.5*\n\n${backHint()}`)
      return
    }
    const curItem = data.itemsPending?.[0] ?? "item"
    await updateData(phone, { currentItemWeight: w })
    await setState(phone, "ITEM_FRAGILE_0", { ...data, currentItemWeight: w })
    await sendText(phone,
      `✅ ${curItem}: *${w}kg*\n\n*Is ${curItem} fragile?*\n\n1. Yes — handle with care (+₦500)\n2. No — standard handling\n\n${backHint()}`
    )
    return
  }

  // ── ITEM FRAGILE ──────────────────────────────────────────────────────────
  if (state === "ITEM_FRAGILE_0") {
    const d       = await getState(phone)
    const pending = d.data.itemsPending ?? []

    if (!pending.length) {
      await setState(phone, "DELIVERY_TYPE", d.data)
      await sendText(phone, `*Delivery urgency:*\n\n1. 🚲 Normal\n2. ⚡ Priority (+₦1,500)\n3. 🗓️ Scheduled (save ₦200)\n\n${backHint()}`)
      return
    }

    let fragile: boolean
    if (["1","yes","y","fragile","yep","yeah"].includes(lower)) fragile = true
    else if (["2","no","n","nope","standard"].includes(lower)) fragile = false
    else {
      await sendText(phone, `❓ *Is ${pending[0]} fragile?*\n\n1. Yes\n2. No\n\n${backHint()}`)
      return
    }

    const curItem  = pending[0]!
    const curWeight = d.data.currentItemWeight ?? 0
    const itemsData = [...(d.data.itemsData ?? []), { name: curItem, weight: curWeight, fragile }]
    const remaining = pending.slice(1)

    if (remaining.length) {
      const itemNum = (d.data.currentItemIdx ?? 0) + 2
      const total   = (d.data.items ?? []).length
      await setState(phone, "ITEM_WEIGHT_0", {
        ...d.data, itemsPending: remaining, itemsData,
        currentItemWeight: 0, currentItemIdx: (d.data.currentItemIdx ?? 0) + 1,
      })
      await sendText(phone,
        `✅ ${curItem}: *${ fragile ? "fragile" : "standard"}*\n\n📦 *Item ${itemNum} of ${total}: ${remaining[0]}*\n\n` +
        WEIGHT_LIST.replace("{item}", remaining[0]!) + `\n\n${backHint()}`
      )
    } else {
      const totalWeight = itemsData.reduce((s, i) => s + i.weight, 0)
      const anyFragile  = itemsData.some(i => i.fragile)
      const pkgDesc     = itemsData.map(i => i.name).join(", ")
      const summary     = itemsData.map(i => `• ${i.name}: ${i.weight}kg ${i.fragile ? "⚠️" : "✅"}`).join("\n")

      await setState(phone, "DELIVERY_TYPE", {
        ...d.data, itemsData, itemsPending: [],
        packageDesc: pkgDesc, weightKg: totalWeight, fragile: anyFragile,
      })
      await sendText(phone,
        `✅ *Items confirmed:*\n${summary}\n📦 Total: *${totalWeight}kg*\n\n` +
        `*Delivery urgency:*\n\n1. 🚲 Normal\n2. ⚡ Priority (+₦1,500)\n3. 🗓️ Scheduled — *save ₦200* when booking ≥4hrs ahead\n\n_Reply 1, 2, or 3_\n\n${backHint()}`
      )
    }
    return
  }

  // ── DELIVERY TYPE ─────────────────────────────────────────────────────────
  if (state === "DELIVERY_TYPE") {
    const typeMap: Record<string, string> = {
      "1": "NORMAL", "normal": "NORMAL",
      "2": "PRIORITY", "priority": "PRIORITY",
      "3": "SCHEDULED", "scheduled": "SCHEDULED",
    }
    const dtype = typeMap[lower]
    if (!dtype) {
      await sendText(phone, `Reply *1* Normal, *2* Priority, *3* Scheduled\n\n${backHint()}`)
      return
    }
    const d = await getState(phone)
    if (dtype === "SCHEDULED") {
      await setState(phone, "SCHEDULED_TIME", { ...d.data, deliveryType: "SCHEDULED" })
      await sendText(phone,
        `🗓️ *Scheduled Delivery*\n\nWhen would you like the pickup?\n\n` +
        `Type date and time e.g.:\n• *Tomorrow 2pm*\n• *25 March 3:30pm*\n• *Saturday 10am*\n\n` +
        `💡 *Save ₦200* when pickup is 4+ hours from now\n\n${backHint()}`
      )
      return
    }
    const pickup  = d.data.pickup!
    const dropoff = d.data.dropoff!
    const fare    = calculateFare(pickup.lat, pickup.lng, dropoff.lat, dropoff.lng, {
      weightKg: d.data.weightKg ?? 0, deliveryType: dtype, fragile: d.data.fragile ?? false,
    })
    await setState(phone, "PAYMENT_METHOD", { ...d.data, deliveryType: dtype, fare })
    await sendText(phone,
      `✅ *${dtype} delivery*\n\n📍 From: _${pickup.address.slice(0, 45)}_\n🏁 To: _${dropoff.address.slice(0, 45)}_\n` +
      `📦 ${d.data.packageDesc ?? "Package"} · ${d.data.weightKg ?? 0}kg${d.data.fragile ? "  ⚠️ fragile" : ""}\n\n` +
      `💰 *Total: ₦${fare.totalFare.toLocaleString()}*\n\n` +
      `*How would you like to pay?*\n\n1. Pay now online (card / bank transfer)\n2. Cash on pickup\n\n_Reply 1 or 2_\n\n${backHint()}`
    )
    return
  }

  // ── SCHEDULED TIME ────────────────────────────────────────────────────────
  if (state === "SCHEDULED_TIME") {
    const scheduledText = text.trim()
    const lower_t       = scheduledText.toLowerCase()
    let hoursAhead      = lower_t.includes("tomorrow") || lower_t.includes("next day") ? 24 : 4
    if (lower_t.match(/now|asap|immediately|urgent/)) hoursAhead = 0

    const d      = await getState(phone)
    const pickup  = d.data.pickup!
    const dropoff = d.data.dropoff!
    const fare    = calculateFare(pickup.lat, pickup.lng, dropoff.lat, dropoff.lng, {
      weightKg: d.data.weightKg ?? 0, deliveryType: "SCHEDULED",
      fragile: d.data.fragile ?? false,
    })

    await setState(phone, "PAYMENT_METHOD", { ...d.data, scheduledTime: scheduledText, fare })
    const discNote = hoursAhead >= 4 ? "\n💡 ₦200 discount applied!" : "\n_Book 4+ hours ahead for ₦200 savings_"
    await sendText(phone,
      `✅ *Scheduled delivery*\n📅 Pickup: *${scheduledText}*\n\n` +
      `📍 From: _${pickup.address.slice(0, 45)}_\n🏁 To: _${dropoff.address.slice(0, 45)}_\n` +
      `📦 ${d.data.packageDesc ?? "Package"} · ${d.data.weightKg ?? 0}kg\n\n` +
      `💰 *Total: ₦${fare.totalFare.toLocaleString()}*${discNote}\n\n` +
      `*How would you like to pay?*\n\n1. Pay now online\n2. Cash on pickup\n\n_Reply 1 or 2_\n\n${backHint()}`
    )
    return
  }

  // ── PAYMENT METHOD ────────────────────────────────────────────────────────
  if (state === "PAYMENT_METHOD" || state === "PROCESSING_PAYMENT") {
    if (state === "PROCESSING_PAYMENT") {
      if (lower === "back" || lower === "0") {
        const d = await getState(phone)
        await setState(phone, "PAYMENT_METHOD", d.data)
        await sendText(phone, `↩️ Back to payment selection\n\n1. Pay online\n2. Cash on pickup\n\n_Reply 1 or 2_\n\n${backHint()}`)
      }
      return  // ignore everything else
    }

    // Dedup guard
    const lastTs = data._paymentTs ?? 0
    if (Date.now() / 1000 - lastTs < 10) return

    if (["1","online","card","pay online","paystack","bank transfer"].includes(lower)) {
      await updateData(phone, { _paymentTs: Date.now() / 1000 })
      const d = await getState(phone)
      await setState(phone, "PROCESSING_PAYMENT", d.data)
      await processOnlinePayment(phone, d.data)
    } else if (["2","cash","cash on pickup","cash payment","pay cash"].includes(lower)) {
      await updateData(phone, { _paymentTs: Date.now() / 1000 })
      const d = await getState(phone)
      await setState(phone, "PROCESSING_PAYMENT", d.data)
      await processCashPayment(phone, d.data)
    } else if (lower === "back" || lower === "0") {
      await setState(phone, "DELIVERY_TYPE", data)
      await sendText(phone, `↩️ Back to delivery type\n\n1. Normal\n2. Priority (+₦1,500)\n3. Scheduled\n\n${backHint()}`)
    } else {
      await sendText(phone, `Reply *1* for online payment or *2* for cash\n\n${backHint()}`)
    }
    return
  }

  // ── AWAIT PAYMENT ─────────────────────────────────────────────────────────
  if (state === "AWAIT_PAYMENT") {
    if (lower === "resend link" || lower === "resend_link") {
      await sendText(phone,
        `💳 *Payment link*\n\nOrder: \`${data.orderRef}\`\nAmount: ₦${(data.fare?.totalFare ?? 0).toLocaleString()}\n\n` +
        `${data.paymentUrl}\n\n⏰ Tap to pay. Expires in 30 minutes.\n\n_Type_ *cancel* _to cancel_`
      )
    } else {
      await sendText(phone,
        `⏳ *Waiting for your payment*\n\nOrder: \`${data.orderRef}\`\n` +
        `Amount: ₦${(data.fare?.totalFare ?? 0).toLocaleString()}\n\n${data.paymentUrl}\n\n` +
        `Type *resend link* to get the link again\nType *cancel* to cancel`
      )
    }
    return
  }

  // ── WAITING RIDER ─────────────────────────────────────────────────────────
  if (state === "WAITING_RIDER") {
    await sendText(phone, "⏳ *Finding your rider...*\n\nYou'll be notified as soon as a rider accepts.\n\n_Type_ *cancel* _to cancel_")
    return
  }

  // ── TRACKING ─────────────────────────────────────────────────────────────
  if (state === "TRACKING") {
    await handleTracking(phone, lower, data)
    return
  }
}

async function handleTracking(phone: string, lower: string, data: ConversationData) {
  if (["1","eta","where","track","track rider","location"].includes(lower)) {
    const deviceId   = data.deviceId
    const riderPhone = data.riderPhone
    let   finalDevice = deviceId

    if (!finalDevice && riderPhone) {
      const rState = await getState(riderPhone)
      finalDevice  = rState.data.deviceId
    }

    if (finalDevice) {
      const { cantrack } = await import("../services/cantrack.ts")
      const loc = await cantrack.fetchOne(finalDevice)
      if (loc && loc.status !== "offline" && loc.latitude !== null && loc.longitude !== null) {
        const dropoff = data.dropoff!
        let etaMsg = ""
        if (dropoff) {
          const { haversineKm } = await import("../pricing/index.ts")
          const dist  = haversineKm(loc.latitude, loc.longitude, dropoff.lat, dropoff.lng)
          const eta   = Math.max(5, Math.round(dist / 0.4))
          etaMsg      = `⏱️ ETA: *~${eta} min*\n`
        }
        await sendText(phone, `🏍️ *Live Rider Update*\n\n⚡ Speed: ${loc.speedKmh} km/h\n${etaMsg}📍 Location pin below 👇`)
        await sendLocation(phone, loc.latitude, loc.longitude, "Your Liebe Tag rider", "Tap to open in Maps")
      } else {
        await sendText(phone, `📡 *GPS is updating...*\n\nYour rider's tracker is syncing. Try again in 30 seconds.\n\n_Type_ *1* _to refresh_`)
      }
    } else {
      await sendText(phone, `⏳ Rider is on the way — GPS tracking will be available shortly.\n\n_Type_ *1* _to try again_`)
    }
    return
  }

  if (["2","confirm delivery","i confirm","received","i received"].includes(lower)) {
    const orderRef = data.orderRef ?? ""
    await db.order.updateMany({ where: { orderRef }, data: { status: "delivered", deliveredAt: new Date() } })
    await resetState(phone)
    await sendText(phone,
      `✅ *Delivery confirmed!*\n\nOrder: \`${orderRef}\`\n\n${deliveryQuote()}\n\nThank you for choosing *Liebe Tag Logistics* 🙏\nType *1* to send another package.`
    )
    await notifyAdmin(`✅ Sender confirmed delivery\nOrder: ${orderRef} | Sender: ${phone}`)
    return
  }

  if (lower === "3" || lower === "menu") {
    await sendMenu(phone)
    return
  }

  await sendText(phone,
    `🏍️ *Your rider is on the way!*\nOrder: \`${data.orderRef ?? ""}\`\n\n` +
    `1. 📍 Track rider location\n2. ✅ I confirm delivery received\n3. 🏠 Main menu\n\n_Type_ *cancel* _only if there is a problem_`
  )
}

async function processOnlinePayment(phone: string, data: ConversationData) {
  const fare      = data.fare!
  const pickup    = data.pickup!
  const dropoff   = data.dropoff!
  const orderRef  = genTrackingRef()
  const orderNum  = genOrderNumber()
  const senderName = await getUserName(phone)

  const payment = await createPaymentLink(
    `${phone}@liebetag.com`, fare.totalFare, orderRef,
    { phone, orderRef, ...data },
    `${env.APP_URL}/payments/verify/${orderRef}`
  )

  if (!payment) {
    await setState(phone, "PAYMENT_METHOD", data)
    await sendText(phone, "Sorry, couldn't generate a payment link right now.\nPlease call *+234 811 870 7226* to place your order.")
    return
  }

  await setState(phone, "AWAIT_PAYMENT", { ...data, orderRef, orderNumber: orderNum, paymentUrl: payment.paymentUrl })

  // Persist order
  await db.order.create({ data: {
    orderRef, orderNumber: orderNum, senderPhone: phone, senderName,
    recipientName: data.recipientName ?? "", recipientPhone: data.recipientPhone ?? "",
    pickupJson: JSON.stringify(pickup), dropoffJson: JSON.stringify(dropoff),
    packageDesc: data.packageDesc ?? "", weightKg: data.weightKg ?? 0,
    fragile: data.fragile ?? false, itemsJson: JSON.stringify(data.itemsData ?? []),
    deliveryType: data.deliveryType ?? "NORMAL", scheduledTime: data.scheduledTime,
    fareTotal: fare.totalFare, fareJson: JSON.stringify(fare), paymentType: "online",
  }}).catch(() => {})

  await sendText(phone,
    `🧾 *Order Confirmed — Pay to Book*\n\n📋 Order No: *${orderNum}*\n🔖 Tracking: \`${orderRef}\`\n\n` +
    `📍 From: _${pickup.address.slice(0, 45)}_\n🏁 To: _${dropoff.address.slice(0, 45)}_\n` +
    `📦 ${data.packageDesc ?? "Package"} · ${data.weightKg ?? 0}kg\n` +
    `👤 Receiver: ${data.recipientName ?? "?"} · ${data.recipientPhone ?? "?"}\n\n` +
    `💰 *Amount: ₦${fare.totalFare.toLocaleString()}*\n\n${payment.paymentUrl}\n\n` +
    `⏰ Link expires in 30 minutes.\nType *resend link* if you need it again\nType *cancel* to cancel`
  )

  // Notify receiver
  if (data.recipientPhone) {
    await notifyReceiver(data.recipientPhone, data.recipientName ?? "", phone, orderRef, orderNum, data)
  }

  // Pre-notify riders
  await dispatchAllRiders(phone, orderRef, data, fare, pickup, dropoff, "online", senderName)

  await notifyAdmin(`🛒 New order — awaiting payment\nOrder: ${orderNum} | Ref: ${orderRef}\nFare: ₦${fare.totalFare.toLocaleString()} | ${data.deliveryType ?? "NORMAL"}`)
}

async function processCashPayment(phone: string, data: ConversationData) {
  const fare      = data.fare!
  const pickup    = data.pickup!
  const dropoff   = data.dropoff!
  const orderRef  = genTrackingRef()
  const orderNum  = genOrderNumber()
  const senderName = await getUserName(phone)

  await setState(phone, "WAITING_RIDER", { ...data, orderRef, orderNumber: orderNum, paymentType: "cash" })

  await db.order.create({ data: {
    orderRef, orderNumber: orderNum, senderPhone: phone, senderName,
    recipientName: data.recipientName ?? "", recipientPhone: data.recipientPhone ?? "",
    pickupJson: JSON.stringify(pickup), dropoffJson: JSON.stringify(dropoff),
    packageDesc: data.packageDesc ?? "", weightKg: data.weightKg ?? 0,
    fragile: data.fragile ?? false, itemsJson: JSON.stringify(data.itemsData ?? []),
    deliveryType: data.deliveryType ?? "NORMAL", fareTotal: fare.totalFare,
    fareJson: JSON.stringify(fare), paymentType: "cash",
  }}).catch(() => {})

  await sendText(phone,
    `💵 *Cash on Pickup — Order Confirmed*\n\n📋 Order No: *${orderNum}*\n🔖 Tracking: \`${orderRef}\`\n\n` +
    `📍 From: _${pickup.address.slice(0, 45)}_\n🏁 To: _${dropoff.address.slice(0, 45)}_\n` +
    `📦 ${data.packageDesc ?? "Package"} · ${data.weightKg ?? 0}kg\n` +
    `👤 Receiver: ${data.recipientName ?? "?"} · +${data.recipientPhone ?? "?"}\n\n` +
    `💰 *Amount to pay rider: ₦${fare.totalFare.toLocaleString()}*\n\n⏳ Finding your rider now...`
  )

  if (data.recipientPhone) {
    await notifyReceiver(data.recipientPhone, data.recipientName ?? "", phone, orderRef, orderNum, data)
  }

  await dispatchAllRiders(phone, orderRef, data, fare, pickup, dropoff, "cash", senderName)
  await notifyAdmin(`💵 New CASH order\nOrder: ${orderNum} | Ref: ${orderRef}\nFare: ₦${fare.totalFare.toLocaleString()} | ${data.deliveryType ?? "NORMAL"}`)
}

async function notifyReceiver(
  receiverPhone: string, receiverName: string, senderPhone: string,
  orderRef: string, orderNumber: string, data: ConversationData
) {
  const greeting  = receiverName ? `Hi ${receiverName}! 👋\n\n` : "Hello! 👋\n\n"
  const dropoff   = data.dropoff
  const pkgDesc   = data.packageDesc ?? "a package"
  const dtype     = (data.deliveryType ?? "NORMAL").replace("_", " ").toLowerCase()

  await sendText(receiverPhone,
    `${greeting}🏍️ *LIEBE TAG LOGISTICS*\n\n` +
    `Someone is sending you *${pkgDesc}*!\n\n` +
    `📋 Order No: *${orderNumber}*\n🔖 Tracking: \`${orderRef}\`\n` +
    `📍 Delivery to: _${dropoff?.address.slice(0, 50) ?? "your address"}_\n🚀 Type: ${dtype}\n\n` +
    `Your package will be delivered soon. You'll get updates when your rider is on the way.\n\n` +
    `*To track:* Reply with your tracking number: \`${orderRef}\`\n\nQuestions? Reply *hi*\n📞 +234 811 870 7226`
  )
}

export { notifyReceiver }
