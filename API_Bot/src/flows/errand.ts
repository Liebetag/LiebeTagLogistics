// src/flows/errand.ts
// Errand booking flow — shopping, bank runs, pharmacy, collection, etc.

import { sendText } from "../services/evolution.ts"
import { getState, setState, updateData, db } from "../bot/states.ts"
import { geocode, suggestAddresses, inAbuja, reverseGeocode } from "../services/geocoding.ts"
import { calculateErrandFare, RIDER_PCT } from "../pricing/index.ts"
import { createPaymentLink } from "../services/paystack.ts"
import { notifyAdmin, backHint, genErrandRef, genOrderNumber, genDeliveryCode, deliveryQuote, gmapsLink } from "../bot/utils.ts"
import { dispatchAllRidersErrand } from "./dispatch.ts"
import type { ConversationData, Location } from "../types/index.ts"
import { env } from "../utils/env.ts"

export const ERRAND_TYPES: Record<string, { label: string; emoji: string; description: string }> = {
  "SHOPPING":     { label: "Shopping",        emoji: "🛒", description: "Buy something for me" },
  "BANK":         { label: "Bank / ATM",       emoji: "🏦", description: "Bank run or ATM withdrawal" },
  "PHARMACY":     { label: "Pharmacy",         emoji: "💊", description: "Buy medicine or health items" },
  "FOOD_PICKUP":  { label: "Food Pickup",      emoji: "🍽️", description: "Pick up food from restaurant" },
  "DOCUMENT":     { label: "Documents",        emoji: "📋", description: "Submit or collect documents/forms" },
  "COLLECTION":   { label: "Collection",       emoji: "📦", description: "Collect something on my behalf" },
  "OTHER":        { label: "Other",            emoji: "✏️", description: "Describe your errand" },
}

export async function handleErrand(
  phone: string, text: string, lower: string,
  location: Location | null, state: string, data: ConversationData
) {
  // ── ERRAND TYPE SELECTION ─────────────────────────────────────────────────
  if (state === "ERRAND_TYPE") {
    const typeMap: Record<string, string> = {
      "1": "SHOPPING", "shopping": "SHOPPING",
      "2": "BANK",     "bank": "BANK", "atm": "BANK",
      "3": "PHARMACY", "pharmacy": "PHARMACY", "medicine": "PHARMACY",
      "4": "FOOD_PICKUP", "food": "FOOD_PICKUP", "restaurant": "FOOD_PICKUP",
      "5": "DOCUMENT", "document": "DOCUMENT", "documents": "DOCUMENT", "form": "DOCUMENT",
      "6": "COLLECTION", "collection": "COLLECTION", "collect": "COLLECTION",
      "7": "OTHER",    "other": "OTHER",
    }
    const etype = typeMap[lower]
    if (!etype) {
      await sendText(phone, `❓ Please reply with a number 1–7\n\n${errandTypeMenu()}\n\n${backHint()}`)
      return
    }
    const t = ERRAND_TYPES[etype]!
    await setState(phone, "ERRAND_LOCATION", { ...data, errandType: etype })
    await sendText(phone,
      `✅ *${t.emoji} ${t.label}*\n\n📍 *Where should the errand runner go?*\n\n` +
      `Share the location pin or type the address:\n\n_Example: Shoprite, Jabi Lake Mall_\n\n${backHint()}`
    )
    return
  }

  // ── ERRAND LOCATION ────────────────────────────────────────────────────────
  if (state === "ERRAND_LOCATION") {
    let errandLoc: Location | null = null

    if (location) {
      if (!inAbuja(location.lat, location.lng)) {
        await sendText(phone, `🚫 *Outside service area*\n\nWe only run errands within Abuja FCT and nearby areas.\n\n${backHint()}`)
        return
      }
      const addr = await reverseGeocode(location.lat, location.lng) ?? `${location.lat}, ${location.lng}`
      errandLoc  = { lat: location.lat, lng: location.lng, address: addr }
    } else {
      const result = await geocode(text)
      if (result && inAbuja(result.lat, result.lng)) {
        errandLoc = result
      } else {
        const sugg = await suggestAddresses(text, 4)
        if (sugg.length) {
          let msg = `❓ Couldn't find *${text.slice(0, 30)}* exactly. Did you mean:\n\n`
          sugg.forEach((s, i) => msg += `${i+1}. ${s.address.slice(0, 55)}\n`)
          msg += `${sugg.length+1}. 📍 Share location pin\n\n_Reply with a number_\n\n${backHint()}`
          await setState(phone, "ERRAND_LOCATION_SUGGEST", { ...data, suggestions: sugg })
          await sendText(phone, msg)
        } else {
          await sendText(phone, `❓ Couldn't find that location.\n\nTry:\n• Tap 📎 → *Location*\n• Type specifically e.g. *Shoprite Jabi Lake Mall*\n\n${backHint()}`)
        }
        return
      }
    }

    await setState(phone, "ERRAND_TASK", { ...data, errandLocation: errandLoc })
    await sendText(phone,
      `✅ *Location:* _${errandLoc.address}_\n\n📋 *Describe exactly what needs to be done:*\n\n` +
      `Be as specific as possible:\n` +
      `_Example: "Buy 2 bags of 5kg rice and a bottle of groundnut oil. Get receipt."_\n\n` +
      `_Or for bank: "Deposit ₦50,000 into account 0123456789 at GTBank"_\n\n${backHint()}`
    )
    return
  }

  // ── ERRAND LOCATION SUGGEST ────────────────────────────────────────────────
  if (state === "ERRAND_LOCATION_SUGGEST") {
    const sugg = (data.suggestions ?? []) as Location[]
    if (/^\d+$/.test(lower)) {
      const idx = parseInt(lower) - 1
      if (idx >= 0 && idx < sugg.length) {
        const s = sugg[idx]!
        await setState(phone, "ERRAND_TASK", { ...data, errandLocation: s })
        await sendText(phone,
          `✅ *Location:* _${s.address}_\n\n📋 *Describe exactly what needs to be done:*\n\n${backHint()}`
        )
      } else {
        await sendText(phone, "❓ Please share your location pin instead.")
      }
    } else if (location) {
      const addr = await reverseGeocode(location.lat, location.lng) ?? `${location.lat}, ${location.lng}`
      const loc  = { lat: location.lat, lng: location.lng, address: addr }
      await setState(phone, "ERRAND_TASK", { ...data, errandLocation: loc })
      await sendText(phone, `✅ *Location:* _${addr}_\n\n📋 *Describe exactly what needs to be done:*\n\n${backHint()}`)
    }
    return
  }

  // ── ERRAND TASK DESCRIPTION ────────────────────────────────────────────────
  if (state === "ERRAND_TASK") {
    if (text.trim().length < 5) {
      await sendText(phone, "❓ Please describe the task in more detail.\n\n_Example: Buy 2 bags of 5kg rice from Shoprite Jabi_")
      return
    }
    await setState(phone, "ERRAND_DEADLINE", { ...data, taskDescription: text.trim() })
    await sendText(phone,
      `✅ Task noted!\n\n🕐 *When do you need this done by?*\n\n` +
      `_Examples:_\n• *Today by 3pm*\n• *Within 2 hours*\n• *Tomorrow morning*\n• *No deadline (as soon as possible)*\n\n${backHint()}`
    )
    return
  }

  // ── ERRAND DEADLINE ────────────────────────────────────────────────────────
  if (state === "ERRAND_DEADLINE") {
    const deadline = lower === "no deadline" || lower === "asap" || lower === "as soon as possible"
      ? null : text.trim()
    await setState(phone, "ERRAND_NEEDS_CASH", { ...data, errandDeadline: deadline ?? undefined })
    await sendText(phone,
      `✅ ${deadline ? `Deadline: *${deadline}*` : "ASAP — no deadline"}\n\n` +
      `💰 *Does the errand runner need money from you?*\n\n` +
      `1. Yes — they need money to buy items / pay fees\n` +
      `2. No — errand runner handles their own expenses (I'll reimburse later)\n\n` +
      `_Reply 1 or 2_\n\n${backHint()}`
    )
    return
  }

  // ── ERRAND NEEDS CASH ──────────────────────────────────────────────────────
  if (state === "ERRAND_NEEDS_CASH") {
    if (["1","yes","y"].includes(lower)) {
      await setState(phone, "ERRAND_CASH_AMOUNT", { ...data, runnerNeedsCash: true })
      await sendText(phone,
        `💰 *How much money does the runner need?*\n\n` +
        `_Type the amount in Naira e.g._ *5000* _or_ *₦5,000*\n\n` +
        `_This will be added to your total payment_\n\n${backHint()}`
      )
    } else if (["2","no","n"].includes(lower)) {
      const d = await getState(phone)
      await showErrandQuote(phone, { ...d.data, runnerNeedsCash: false })
    } else {
      await sendText(phone, `❓ Reply *1* (Yes) or *2* (No)\n\n${backHint()}`)
    }
    return
  }

  // ── ERRAND CASH AMOUNT ─────────────────────────────────────────────────────
  if (state === "ERRAND_CASH_AMOUNT") {
    const amount = parseInt(text.replace(/[^\d]/g, ""))
    if (isNaN(amount) || amount <= 0) {
      await sendText(phone, "❓ Please type the amount e.g. *5000*\n\n${backHint()}")
      return
    }
    const d = await getState(phone)
    await showErrandQuote(phone, { ...d.data, cashProvided: amount })
    return
  }

  // ── ERRAND PAYMENT METHOD ──────────────────────────────────────────────────
  if (state === "ERRAND_PAYMENT" || state === "ERRAND_PROCESSING") {
    if (state === "ERRAND_PROCESSING") return

    const lastTs = data._paymentTs ?? 0
    if (Date.now() / 1000 - lastTs < 10) return

    if (["1","online","card","pay"].includes(lower)) {
      await updateData(phone, { _paymentTs: Date.now() / 1000 })
      const d = await getState(phone)
      await setState(phone, "ERRAND_PROCESSING", d.data)
      await processErrandOnlinePayment(phone, d.data)
    } else if (["2","cash"].includes(lower)) {
      await updateData(phone, { _paymentTs: Date.now() / 1000 })
      const d = await getState(phone)
      await setState(phone, "ERRAND_PROCESSING", d.data)
      await processErrandCashPayment(phone, d.data)
    } else if (lower === "back" || lower === "0") {
      await setState(phone, "ERRAND_NEEDS_CASH", data)
      await sendText(phone, `↩️ Back.\n\nDoes the runner need money from you?\n\n1. Yes\n2. No\n\n${backHint()}`)
    } else {
      await sendText(phone, `Reply *1* for online payment or *2* for cash\n\n${backHint()}`)
    }
    return
  }

  // ── ERRAND TRACKING ────────────────────────────────────────────────────────
  if (state === "ERRAND_TRACKING") {
    if (["1","status","where","track"].includes(lower)) {
      await sendText(phone,
        `🏃 *Errand Update*\n\nRef: \`${data.errandRef}\`\nStatus: Runner is working on your errand.\n\n` +
        `They'll contact you if needed.\n\n${backHint()}`
      )
    } else if (["2","confirm","done","completed","received"].includes(lower)) {
      await db.errand.updateMany({
        where: { errandRef: data.errandRef ?? "" },
        data: { status: "completed", completedAt: new Date() }
      })
      await setState(phone, "IDLE", {})
      await sendText(phone,
        `✅ *Errand completed!*\n\nRef: \`${data.errandRef}\`\n\n${deliveryQuote()}\n\n` +
        `Thank you for using *Liebe Tag Logistics* 🙏\nType *menu* for more options.`
      )
    } else {
      await sendText(phone,
        `🏃 *Your errand is in progress!*\nRef: \`${data.errandRef ?? ""}\`\n\n` +
        `1. Check status\n2. ✅ Confirm errand completed\n\n_Type_ *cancel* _only if there is a problem_`
      )
    }
    return
  }
}

async function showErrandQuote(phone: string, data: ConversationData) {
  const loc    = data.errandLocation!
  // Use a default central Abuja position for distance calculation
  const fare   = calculateErrandFare(9.0579, 7.4951, loc.lat, loc.lng, {
    rush:       data.errandDeadline?.toLowerCase().includes("hour") ?? false,
    returnTrip: !!data.errandReturnLocation,
  })
  const etype  = ERRAND_TYPES[data.errandType ?? "OTHER"]!
  const cash   = data.cashProvided ?? 0
  const total  = fare.totalFee + cash

  await setState(phone, "ERRAND_PAYMENT", { ...data, errandFare: fare })

  await sendText(phone,
    `💰 *Errand Quote*\n\n${etype.emoji} *${etype.label}*\n` +
    `📍 Location: _${loc.address.slice(0, 50)}_\n` +
    `📋 Task: _${(data.taskDescription ?? "").slice(0, 80)}_\n` +
    (data.errandDeadline ? `🕐 By: ${data.errandDeadline}\n` : "") +
    `\n*Errand fee: ₦${fare.totalFee.toLocaleString()}*\n` +
    (cash ? `Item/cash advance: ₦${cash.toLocaleString()}\n` : "") +
    `💰 *Total: ₦${total.toLocaleString()}*\n\n` +
    `*How would you like to pay?*\n\n1. Pay now online\n2. Cash to runner\n\n_Reply 1 or 2_\n\n${backHint()}`
  )
}

async function processErrandOnlinePayment(phone: string, data: ConversationData) {
  const fare      = data.errandFare!
  const errandRef = genErrandRef()
  const errandNum = genOrderNumber()
  const cash      = data.cashProvided ?? 0
  const total     = fare.totalFee + cash

  const payment = await createPaymentLink(
    `${phone}@liebetag.com`, total, errandRef,
    { phone, errandRef, errandType: data.errandType, ...data },
    `${env.APP_URL}/payments/errand/verify/${errandRef}`
  )

  if (!payment) {
    await setState(phone, "ERRAND_PAYMENT", data)
    await sendText(phone, "Sorry, couldn't generate a payment link. Call *+234 811 870 7226*.")
    return
  }

  await setState(phone, "ERRAND_AWAIT_PAYMENT", { ...data, errandRef, errandNumber: errandNum, paymentUrl: payment.paymentUrl })

  await db.errand.create({ data: {
    errandRef, errandNumber: errandNum, clientPhone: phone,
    errandType: data.errandType ?? "OTHER",
    locationJson: JSON.stringify(data.errandLocation ?? {}),
    taskDescription: data.taskDescription ?? "",
    errandFee: fare.totalFee, itemCost: cash, totalCharge: total,
    paymentType: "online", runnerNeedsCash: data.runnerNeedsCash ?? false,
    cashProvided: cash, errandDeadline: data.errandDeadline,
  }}).catch(() => {})

  const etype = ERRAND_TYPES[data.errandType ?? "OTHER"]!
  await sendText(phone,
    `${etype.emoji} *Errand Confirmed — Pay to Book*\n\n📋 Ref No: *${errandNum}*\n🔖 Ref: \`${errandRef}\`\n\n` +
    `📍 Location: _${data.errandLocation?.address.slice(0, 50)}_\n` +
    `📋 Task: _${(data.taskDescription ?? "").slice(0, 60)}_\n\n` +
    `💰 *Total: ₦${total.toLocaleString()}*\n\n${payment.paymentUrl}\n\n` +
    `⏰ Link expires in 30 minutes.\nType *cancel* to cancel`
  )

  await notifyAdmin(`🏃 New errand — awaiting payment\nRef: ${errandRef} | Type: ${data.errandType} | ₦${total.toLocaleString()}`)
}

async function processErrandCashPayment(phone: string, data: ConversationData) {
  const fare      = data.errandFare!
  const errandRef = genErrandRef()
  const errandNum = genOrderNumber()
  const cash      = data.cashProvided ?? 0
  const total     = fare.totalFee + cash

  await setState(phone, "ERRAND_WAITING_RUNNER", { ...data, errandRef, errandNumber: errandNum })

  await db.errand.create({ data: {
    errandRef, errandNumber: errandNum, clientPhone: phone,
    errandType: data.errandType ?? "OTHER",
    locationJson: JSON.stringify(data.errandLocation ?? {}),
    taskDescription: data.taskDescription ?? "",
    errandFee: fare.totalFee, itemCost: cash, totalCharge: total,
    paymentType: "cash", runnerNeedsCash: data.runnerNeedsCash ?? false,
    cashProvided: cash, errandDeadline: data.errandDeadline,
  }}).catch(() => {})

  const etype = ERRAND_TYPES[data.errandType ?? "OTHER"]!
  await sendText(phone,
    `${etype.emoji} *Errand Confirmed — Cash Payment*\n\n📋 Ref No: *${errandNum}*\n🔖 Ref: \`${errandRef}\`\n\n` +
    `📍 Location: _${data.errandLocation?.address.slice(0, 50)}_\n` +
    `📋 Task: _${(data.taskDescription ?? "").slice(0, 60)}_\n\n` +
    `💰 *Pay runner: ₦${fare.totalFee.toLocaleString()}*\n` +
    (cash ? `🛒 Item cost advance: ₦${cash.toLocaleString()}\n` : "") +
    `\n⏳ Finding your runner now...`
  )

  await dispatchAllRidersErrand(phone, errandRef, data, fare)
  await notifyAdmin(`🏃 New CASH errand\nRef: ${errandRef} | Type: ${data.errandType} | ₦${total.toLocaleString()}`)
}

function errandTypeMenu(): string {
  return Object.entries(ERRAND_TYPES)
    .map(([, v], i) => `${i+1}. ${v.emoji} ${v.label} — ${v.description}`)
    .join("\n")
}

export { errandTypeMenu }
