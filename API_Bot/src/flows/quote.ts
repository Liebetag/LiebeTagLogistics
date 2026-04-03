// src/flows/quote.ts
// Price quote flow — no booking, just estimation

import { sendText } from "../services/evolution.ts"
import { getState, setState, updateData } from "../bot/states.ts"
import { geocode, reverseGeocode, suggestAddresses, inAbuja } from "../services/geocoding.ts"
import { calculateFare } from "../pricing/index.ts"
import { backHint, ITEM_LIST_MSG, WEIGHT_LIST, parseItems, parseWeight } from "../bot/utils.ts"
import type { ConversationData, Location } from "../types/index.ts"

export async function handleQuote(
  phone: string, text: string, lower: string,
  location: Location | null, state: string, data: ConversationData
) {
  if (state === "QUOTE_PICKUP") {
    if (location) {
      if (!inAbuja(location.lat, location.lng)) {
        await sendText(phone, `🚫 *Outside delivery zone*\n\nWe serve Abuja FCT and nearby areas.\n\n${backHint()}`)
        return
      }
      const addr = await reverseGeocode(location.lat, location.lng) ?? `${location.lat}, ${location.lng}`
      await setState(phone, "QUOTE_DROPOFF", { pickup: { lat: location.lat, lng: location.lng, address: addr } })
      await sendText(phone, `✅ Pickup: _${addr}_\n\n🏁 Now share or type the *drop-off address:*\n\n${backHint()}`)
    } else {
      const result = await geocode(text)
      if (result && inAbuja(result.lat, result.lng)) {
        await setState(phone, "QUOTE_DROPOFF", { pickup: result })
        await sendText(phone, `✅ Pickup: _${result.address}_\n\n🏁 Now share or type the *drop-off address:*\n\n${backHint()}`)
      } else {
        const sugg = await suggestAddresses(text, 4)
        if (sugg.length) {
          let msg = `❓ Couldn't find *${text.slice(0, 30)}* exactly. Did you mean:\n\n`
          sugg.forEach((s, i) => msg += `${i+1}. ${s.address.slice(0, 55)}\n`)
          msg += `${sugg.length+1}. 📍 Share location pin\n\n_Reply with a number_\n\n${backHint()}`
          await setState(phone, "QUOTE_PICKUP_SUGGEST", { ...data, suggestions: sugg })
          await sendText(phone, msg)
        } else {
          await sendText(phone, `❓ Couldn't find that address. Try sharing your location pin or type more specifically.\n\n${backHint()}`)
        }
      }
    }
    return
  }

  if (state === "QUOTE_PICKUP_SUGGEST") {
    const sugg = (data.suggestions ?? []) as Location[]
    if (/^\d+$/.test(lower) && parseInt(lower) - 1 < sugg.length) {
      const s = sugg[parseInt(lower) - 1]!
      await setState(phone, "QUOTE_DROPOFF", { pickup: s })
      await sendText(phone, `✅ Pickup: _${s.address}_\n\n🏁 Share or type the *drop-off address:*\n\n${backHint()}`)
    } else if (location) {
      const addr = await reverseGeocode(location.lat, location.lng) ?? `${location.lat}, ${location.lng}`
      await setState(phone, "QUOTE_DROPOFF", { pickup: { lat: location.lat, lng: location.lng, address: addr } })
      await sendText(phone, `✅ Pickup: _${addr}_\n\n🏁 Share or type the *drop-off address:*\n\n${backHint()}`)
    } else {
      await sendText(phone, "❓ Please share your location pin or reply with a number from the list.")
    }
    return
  }

  if (state === "QUOTE_DROPOFF") {
    if (location) {
      if (!inAbuja(location.lat, location.lng)) {
        await sendText(phone, `🚫 *Outside delivery zone*\n\nPlease share a drop-off within Abuja FCT.\n\n${backHint()}`)
        return
      }
      const addr = await reverseGeocode(location.lat, location.lng) ?? `${location.lat}, ${location.lng}`
      await updateData(phone, { dropoff: { lat: location.lat, lng: location.lng, address: addr } })
      await setState(phone, "QUOTE_ITEMS", { ...data, dropoff: { lat: location.lat, lng: location.lng, address: addr } })
      await sendText(phone, `✅ Drop-off: _${addr}_\n\n${ITEM_LIST_MSG}\n\n${backHint()}`)
    } else {
      const result = await geocode(text)
      if (result && inAbuja(result.lat, result.lng)) {
        await setState(phone, "QUOTE_ITEMS", { ...data, dropoff: result })
        await sendText(phone, `✅ Drop-off: _${result.address}_\n\n${ITEM_LIST_MSG}\n\n${backHint()}`)
      } else {
        const sugg = await suggestAddresses(text, 4)
        if (sugg.length) {
          let msg = `❓ Couldn't find *${text.slice(0, 30)}* exactly. Did you mean:\n\n`
          sugg.forEach((s, i) => msg += `${i+1}. ${s.address.slice(0, 55)}\n`)
          msg += `${sugg.length+1}. 📍 Share location pin\n\n_Reply with a number_\n\n${backHint()}`
          await setState(phone, "QUOTE_DROPOFF_SUGGEST", { ...data, suggestions: sugg })
          await sendText(phone, msg)
        } else {
          await sendText(phone, `❓ Couldn't find that address. Try sharing your location pin.\n\n${backHint()}`)
        }
      }
    }
    return
  }

  if (state === "QUOTE_DROPOFF_SUGGEST") {
    const sugg = (data.suggestions ?? []) as Location[]
    if (/^\d+$/.test(lower) && parseInt(lower) - 1 < sugg.length) {
      const s = sugg[parseInt(lower) - 1]!
      await setState(phone, "QUOTE_ITEMS", { ...data, dropoff: s })
      await sendText(phone, `✅ Drop-off: _${s.address}_\n\n${ITEM_LIST_MSG}\n\n${backHint()}`)
    } else if (location) {
      const addr = await reverseGeocode(location.lat, location.lng) ?? `${location.lat}, ${location.lng}`
      await setState(phone, "QUOTE_ITEMS", { ...data, dropoff: { lat: location.lat, lng: location.lng, address: addr } })
      await sendText(phone, `✅ Drop-off: _${addr}_\n\n${ITEM_LIST_MSG}\n\n${backHint()}`)
    } else {
      await sendText(phone, "❓ Please share your location pin or reply with a number from the list.")
    }
    return
  }

  if (state === "QUOTE_ITEMS") {
    const items = parseItems(lower)
    if (!items.length) {
      await sendText(phone, `❓ Couldn't understand that.\n\n${ITEM_LIST_MSG}`)
      return
    }
    await updateData(phone, { items })
    await setState(phone, "QUOTE_WEIGHT", { ...data, items })
    await sendText(phone,
      `✅ Items: *${items.join(", ")}*\n\n` +
      WEIGHT_LIST.replace("{item}", "items") +
      `\n\n_For multiple items, enter the total combined weight._\n\n${backHint()}`
    )
    return
  }

  if (state === "QUOTE_WEIGHT") {
    const w = parseWeight(lower)
    if (w === null) {
      await sendText(phone, `❓ Enter weight e.g. *2* or *2kg*\n\n${backHint()}`)
      return
    }
    await updateData(phone, { weightKg: w })
    await setState(phone, "QUOTE_FRAGILE", { ...data, weightKg: w })
    await sendText(phone,
      `✅ Weight: *${w}kg*\n\n*Are any items fragile?*\n\n1. Yes — handle with care (+₦500)\n2. No — standard handling\n\n${backHint()}`
    )
    return
  }

  if (state === "QUOTE_FRAGILE") {
    let fragile: boolean
    if (["1","yes","y","fragile"].includes(lower)) fragile = true
    else if (["2","no","n","standard"].includes(lower)) fragile = false
    else {
      await sendText(phone, `❓ Reply *1* for Yes or *2* for No\n\n${backHint()}`)
      return
    }
    await updateData(phone, { fragile })
    await setState(phone, "QUOTE_TYPE", { ...data, fragile })
    await sendText(phone,
      `✅ ${fragile ? "Fragile — noted." : "Standard handling."}\n\n` +
      `*Delivery urgency:*\n\n1. 🚲 Normal\n2. ⚡ Priority (+₦1,500)\n3. 🗓️ Scheduled — *save ₦200* when booking ≥4hrs ahead\n\n_Reply 1, 2, or 3_\n\n${backHint()}`
    )
    return
  }

  if (state === "QUOTE_TYPE") {
    const typeMap: Record<string, string> = {
      "1":"NORMAL","normal":"NORMAL","2":"PRIORITY","priority":"PRIORITY","3":"SCHEDULED","scheduled":"SCHEDULED"
    }
    const dtype = typeMap[lower]
    if (!dtype) {
      await sendText(phone, `Reply *1* Normal, *2* Priority, *3* Scheduled\n\n${backHint()}`)
      return
    }
    const d      = await getState(phone)
    const pickup  = d.data.pickup!
    const dropoff = d.data.dropoff!
    const fare    = calculateFare(pickup.lat, pickup.lng, dropoff.lat, dropoff.lng, {
      weightKg: d.data.weightKg ?? 0, deliveryType: dtype, fragile: d.data.fragile ?? false,
    })
    const fragileNote = d.data.fragile ? "  ⚠️ fragile" : ""

    await setState(phone, "QUOTE_CONFIRM", { ...d.data, deliveryType: dtype, fare })
    await sendText(phone,
      `💰 *Delivery Quote*\n\n` +
      `📍 ${pickup.address.slice(0, 45)}\n🏁 ${dropoff.address.slice(0, 45)}\n` +
      `📦 ${(d.data.items ?? []).join(", ")} · ${d.data.weightKg ?? 0}kg${fragileNote}\n` +
      `🚀 ${dtype.replace("_"," ").toLowerCase()}\n\n` +
      `💰 *Total: ₦${fare.totalFare.toLocaleString()}*\n` +
      `_(Rider earns ₦${fare.riderEarnings.toLocaleString()})_\n\n` +
      `_Type_ *1* _to book this delivery or_ *menu* _to go back_`
    )
    return
  }

  if (state === "QUOTE_CONFIRM") {
    if (["1","book","yes","confirm","ok","proceed"].includes(lower)) {
      const d = await getState(phone)
      // Jump into delivery flow at receiver name (addresses + items already known)
      await setState(phone, "RECEIVER_NAME", {
        ...d.data,
        packageDesc:  (d.data.items ?? []).join(", "),
        itemsData:    (d.data.items ?? []).map(name => ({ name, weight: (d.data.weightKg ?? 0) / (d.data.items ?? []).length, fragile: d.data.fragile ?? false })),
        itemsPending: [],
      })
      await sendText(phone,
        `✅ *Great — let's book your delivery!*\n\n👤 *Who is receiving this package?*\n\nType the receiver's full name:\n\n${backHint()}`
      )
    } else {
      await setState(phone, "IDLE")
      const { sendMenu } = await import("../bot/utils.ts")
      await sendMenu(phone)
    }
    return
  }
}
