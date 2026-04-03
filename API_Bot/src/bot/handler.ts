// src/bot/handler.ts
// Main WhatsApp message router

import { sendText } from "../services/evolution.ts"
import { getState, setState, updateData, resetState, getUserName, setUserName, upsertUser, touchUser } from "./states.ts"
import { parseIntent, isGreeting, isDeliveryIntent, isErrandIntent, transcribeVoice } from "../services/nlp.ts"
import { geocode, inAbuja } from "../services/geocoding.ts"
import { sendMenu, notifyAdmin, backHint, genDeliveryCode, deliveryQuote, gmapsLink } from "./utils.ts"
import { handleDelivery } from "../flows/delivery.ts"
import { handleErrand, errandTypeMenu } from "../flows/errand.ts"
import { handleRider } from "./rider.ts"
import { calculateFare, RIDER_PCT, waitingCharge } from "../pricing/index.ts"
import { db } from "./states.ts"
import { env } from "../utils/env.ts"
import type { ConversationData, Location } from "../types/index.ts"

export async function handleMessage(
  phone: string,
  message: string,
  location: Location | null = null,
  voiceBuffer?: Buffer,
  photoId?: string,
) {
  let text  = (message || "").trim()
  let lower = text.toLowerCase().trim()

  const role = env.ADMIN_PHONES.includes(phone) ? "admin"
             : env.RIDER_PHONES.includes(phone)  ? "rider"
             : "customer"

  // Track last seen
  await touchUser(phone)

  // Voice note transcription
  if (voiceBuffer && voiceBuffer.length > 0 && !text) {
    await sendText(phone, "🎤 _Transcribing your voice note..._")
    const transcribed = await transcribeVoice(voiceBuffer)
    if (transcribed) {
      text  = transcribed
      lower = text.toLowerCase().trim()
      await sendText(phone, `🎤 _I heard:_ "${text}"`)
    } else {
      await sendText(phone, "🎤 Couldn't transcribe that. Please type your message instead.")
      return
    }
  }

  // Photo from rider
  if (photoId) {
    if (role === "rider") {
      await handleRiderPhoto(phone, photoId)
      return
    }
    return
  }

  const conv  = await getState(phone)
  const state = conv.state
  const data  = conv.data

  // Auto-detect tracking number
  if (role === "customer" && !["PICKUP_ADDRESS","DROPOFF_ADDRESS","RECEIVER_NAME",
      "RECEIVER_PHONE","ITEM_SELECT","ITEM_WEIGHT_0","ITEM_FRAGILE_0","ITEM_NAME_0",
      "DELIVERY_TYPE","PAYMENT_METHOD","ONBOARDING_NAME","SCHEDULED_TIME",
      "ADDRESS_SUGGEST_PICKUP","ADDRESS_SUGGEST_DROPOFF"].includes(state)) {
    const digits = text.replace(/\D/g, "")
    if (lower.startsWith("lt-") || lower.startsWith("er-") ||
        (digits.length === 16 && text.trim() === digits)) {
      await showOrderStatus(phone, text.trim())
      return
    }
  }

  if (role === "admin") { await handleAdmin(phone, lower, data); return }
  if (role === "rider") { await handleRider(phone, text, lower, location, state, data); return }

  // Customer handler
  await handleCustomer(phone, text, lower, location, state, data)
}

async function handleCustomer(
  phone: string, text: string, lower: string,
  location: Location | null, state: string, data: ConversationData
) {
  // Name check — ask on first interaction
  if (state !== "ONBOARDING_NAME") {
    const name = await getUserName(phone)
    if (!name) {
      await upsertUser(phone)
      await setState(phone, "ONBOARDING_NAME")
      await sendText(phone,
        "👋 *Welcome to Liebe Tag Logistics!* 🏍️\n\n" +
        "Fast delivery and errands across Abuja.\n\n" +
        "Before we start — *what is your name?*\n\n" +
        "_Type your full name e.g._ *Amaka Johnson*"
      )
      return
    }
  }

  // Onboarding
  if (state === "ONBOARDING_NAME") {
    if (text.trim().length >= 2 && !/^\d+$/.test(text.trim())) {
      const name = text.trim().replace(/\b\w/g, c => c.toUpperCase())
      await setUserName(phone, name)
      await setState(phone, "MENU")
      await sendMenu(phone, name)
      return
    }
    await sendText(phone, "❓ Please type your full name e.g. *Amaka Johnson*")
    return
  }

  const userName = await getUserName(phone)

  // Global cancel
  if (["cancel", "stop", "main menu", "mainmenu"].includes(lower)) {
    await resetState(phone)
    await sendMenu(phone, userName)
    return
  }

  // Back navigation
  const BACK_MAP: Record<string, string> = {
    DROPOFF_ADDRESS:   "PICKUP_ADDRESS",
    ADDRESS_SUGGEST_PICKUP: "PICKUP_ADDRESS",
    ADDRESS_SUGGEST_DROPOFF: "DROPOFF_ADDRESS",
    RECEIVER_NAME:     "DROPOFF_ADDRESS",
    RECEIVER_PHONE:    "RECEIVER_NAME",
    ITEM_SELECT:       "RECEIVER_PHONE",
    ITEM_WEIGHT_0:     "ITEM_SELECT",
    ITEM_FRAGILE_0:    "ITEM_WEIGHT_0",
    ITEM_NAME_0:       "ITEM_SELECT",
    DELIVERY_TYPE:     "ITEM_FRAGILE_0",
    SCHEDULED_TIME:    "DELIVERY_TYPE",
    PAYMENT_METHOD:    "DELIVERY_TYPE",
    ERRAND_TYPE:       "MENU",
    ERRAND_LOCATION:   "ERRAND_TYPE",
    ERRAND_TASK:       "ERRAND_LOCATION",
    ERRAND_DEADLINE:   "ERRAND_TASK",
    ERRAND_NEEDS_CASH: "ERRAND_DEADLINE",
    ERRAND_PAYMENT:    "ERRAND_NEEDS_CASH",
  }
  if ((lower === "back" || lower === "0" || lower === "b") && BACK_MAP[state]) {
    await setState(phone, BACK_MAP[state]!, data)
    await sendText(phone, `↩️ Going back...\n\n_Type_ *cancel* _to start over_`)
    return
  }

  // Menu state
  if (["IDLE", "MENU"].includes(state)) {
    // Greeting with possible delivery intent
    if (isGreeting(text)) {
      const greetName = userName ? ` ${userName}!` : "!"
      if (isDeliveryIntent(text) && text.length > 20) {
        await sendText(phone, `👋 *Good to hear from you${greetName}* Let me help with your delivery!`)
        await processNLPDelivery(phone, text, userName)
        return
      }
      if (isErrandIntent(text) && text.length > 15) {
        await sendText(phone, `👋 *Good to hear from you${greetName}* Let me help with your errand!`)
        await startErrand(phone)
        return
      }
      await sendText(phone, `👋 *Good to hear from you${greetName}*\n\nWhat would you like to do today?`)
      await sendMenu(phone, userName)
      await setState(phone, "MENU")
      return
    }

    // Menu selections
    if (lower === "1" || ["new", "delivery", "send", "book"].includes(lower)) {
      await startDelivery(phone)
      return
    }
    if (lower === "2" || ["errand", "errand runner", "run errand"].includes(lower)) {
      await startErrand(phone)
      return
    }
    if (lower === "3" || ["track", "track order", "tracking"].includes(lower)) {
      await sendText(phone,
        "🔍 *Track your order*\n\nType your *16-digit order number* or tracking number\n\n" +
        "_Example: 20260321XXXXXXXX or LT-WA..._\n\n_Type_ *cancel* _to go back_"
      )
      await setState(phone, "AWAITING_TRACKING")
      return
    }
    if (lower === "4" || ["quote", "price", "estimate", "how much"].includes(lower)) {
      await startQuote(phone)
      return
    }
    if (lower === "5" || ["help", "support", "faq"].includes(lower)) {
      await sendText(phone,
        "📞 *Support & FAQ*\n\n📧 info@liebetag.com\n📱 +234 811 870 7226\n⏰ Mon–Sat, 8am–8pm WAT\n\n" +
        "_Just type your question and I'll answer it!_\n\n_Type_ *menu* _to go back_"
      )
      return
    }

    // NLP delivery / errand intent
    if (isDeliveryIntent(text) && text.length > 10) {
      await processNLPDelivery(phone, text, userName)
      return
    }
    if (isErrandIntent(text) && text.length > 10) {
      await startErrand(phone)
      return
    }

    // FAQ fallback
    const result = await parseIntent(text, userName)
    await sendText(phone, (result.message ?? "Type *menu* to see all options.") + "\n\n_Type_ *menu_ _for main menu_")
    return
  }

  // Tracking
  if (state === "AWAITING_TRACKING") {
    await showOrderStatus(phone, text.trim())
    await setState(phone, "IDLE")
    return
  }

  // Quote flows
  const quoteStates = [
    "QUOTE_PICKUP", "QUOTE_PICKUP_SUGGEST", "QUOTE_DROPOFF", "QUOTE_DROPOFF_SUGGEST",
    "QUOTE_ITEMS", "QUOTE_WEIGHT", "QUOTE_FRAGILE", "QUOTE_TYPE", "QUOTE_CONFIRM",
  ]
  if (quoteStates.includes(state)) {
    const { handleQuote } = await import("../flows/quote.ts")
    await handleQuote(phone, text, lower, location as any, state, data)
    return
  }

  // Delivery flows
  const deliveryStates = [
    "PICKUP_ADDRESS", "ADDRESS_SUGGEST_PICKUP", "DROPOFF_ADDRESS", "ADDRESS_SUGGEST_DROPOFF",
    "RECEIVER_NAME", "RECEIVER_PHONE", "ITEM_SELECT", "ITEM_NAME_0", "ITEM_WEIGHT_0",
    "ITEM_FRAGILE_0", "PACKAGE_FRAGILE", "DELIVERY_TYPE", "SCHEDULED_TIME",
    "PAYMENT_METHOD", "PROCESSING_PAYMENT", "AWAIT_PAYMENT", "WAITING_RIDER", "TRACKING",
    // Quote flow
    "QUOTE_PICKUP", "QUOTE_DROPOFF", "QUOTE_ITEMS", "QUOTE_WEIGHT",
    "QUOTE_FRAGILE", "QUOTE_TYPE", "QUOTE_CONFIRM",
  ]
  if (deliveryStates.includes(state)) {
    await handleDelivery(phone, text, lower, location, state, data)
    return
  }

  // Errand flows
  const errandStates = [
    "ERRAND_TYPE", "ERRAND_LOCATION", "ERRAND_LOCATION_SUGGEST", "ERRAND_TASK",
    "ERRAND_DEADLINE", "ERRAND_NEEDS_CASH", "ERRAND_CASH_AMOUNT", "ERRAND_PAYMENT",
    "ERRAND_PROCESSING", "ERRAND_AWAIT_PAYMENT", "ERRAND_WAITING_RUNNER", "ERRAND_TRACKING",
  ]
  if (errandStates.includes(state)) {
    await handleErrand(phone, text, lower, location, state, data)
    return
  }

  // FAQ fallback for any unknown state
  const result = await parseIntent(text, userName)
  await sendText(phone, (result.message ?? "Type *menu* to see all options.") + "\n\n_Type_ *menu_ _for main menu_")
}

async function startDelivery(phone: string) {
  await setState(phone, "PICKUP_ADDRESS", {})
  await sendText(phone,
    "📍 *Step 1 — Pickup address*\n\n" +
    "Tap 📎 → *Location* to share your pickup point.\n\n" +
    "_Or type the address e.g._ *12 Ahmadu Bello Way, Wuse 2*\n\n" +
    backHint()
  )
}

async function startErrand(phone: string) {
  await setState(phone, "ERRAND_TYPE", {})
  await sendText(phone,
    "🏃 *Book an Errand*\n\nWhat type of errand do you need?\n\n" +
    errandTypeMenu() + `\n\n_Reply with a number_\n\n${backHint()}`
  )
}

async function startQuote(phone: string) {
  await setState(phone, "QUOTE_PICKUP", {})
  await sendText(phone, "💰 *Get a price estimate*\n\n📍 Share or type your *pickup address:*\n\n" + backHint())
}

async function processNLPDelivery(phone: string, text: string, userName: string) {
  const result = await parseIntent(text, userName)
  if (result.intent !== "delivery") {
    await startDelivery(phone)
    return
  }

  const prefill: ConversationData = {}
  let needsPickupPin = false

  if (result.pickup?.match(/current|here|my location|where i am/i)) {
    needsPickupPin = true
  } else if (result.pickup) {
    const coords = await geocode(result.pickup)
    if (coords && inAbuja(coords.lat, coords.lng)) prefill.pickup = coords
  }

  if (result.dropoff) {
    const coords = await geocode(result.dropoff)
    if (coords && inAbuja(coords.lat, coords.lng)) prefill.dropoff = coords
  }

  if (result.weight) {
    const { parseWeight } = await import("./utils.ts")
    const w = parseWeight(result.weight)
    if (w) prefill.weightKg = w
  }
  if (result.fragile !== null) prefill.fragile = result.fragile ?? undefined

  if (needsPickupPin && prefill.dropoff) {
    await setState(phone, "PICKUP_ADDRESS", prefill)
    await sendText(phone,
      `Sending to *${prefill.dropoff.address.slice(0, 50)}*.\n\n` +
      `📍 *Share your pickup location:*\nTap 📎 → *Location* to share your GPS pin.\n\n` + backHint()
    )
  } else if (prefill.pickup && prefill.dropoff) {
    await setState(phone, "RECEIVER_NAME", prefill)
    await sendText(phone,
      `✅ *Got it!*\n\n📍 Pickup: _${prefill.pickup.address.slice(0, 50)}_\n` +
      `🏁 Drop-off: _${prefill.dropoff.address.slice(0, 50)}_\n\n` +
      `👤 *Who is receiving this package?*\n_Type the receiver's full name:_\n\n` + backHint()
    )
  } else if (prefill.dropoff) {
    await setState(phone, "PICKUP_ADDRESS", prefill)
    await sendText(phone,
      `Drop-off noted: _${prefill.dropoff.address.slice(0, 50)}_\n\n` +
      `📍 *What is the pickup address?*\nShare location pin or type address:\n\n` + backHint()
    )
  } else {
    await startDelivery(phone)
  }
}

async function showOrderStatus(phone: string, ref: string) {
  const refUpper = ref.toUpperCase().trim()

  // Check active state first
  const conv = await getState(phone)
  const stored = (conv.data.orderRef ?? "").toUpperCase()
  if (stored === refUpper || conv.data.orderNumber === ref.trim()) {
    const statusMap: Record<string, string> = {
      AWAIT_PAYMENT: "⏳ Awaiting payment",
      WAITING_RIDER: "🔍 Finding a rider",
      TRACKING:      "🏍️ Rider on the way",
    }
    await sendText(phone,
      `📦 *Package Status*\n\n🔖 Tracking: \`${conv.data.orderRef}\`\n📋 Order No: ${conv.data.orderNumber ?? "—"}\n\n` +
      `📌 Status: *${statusMap[conv.state] ?? "Active"}*\n\n_Type_ *1* _to track your rider_`
    )
    return
  }

  // Search DB
  const order = await db.order.findFirst({
    where: { OR: [{ orderRef: { contains: refUpper } }, { orderNumber: ref.trim() }] }
  })

  if (order) {
    const EMOJI: Record<string, string> = {
      created: "📋 Order placed", paid: "💳 Payment confirmed",
      assigned: "🏍️ Rider assigned", picked_up: "📦 Package collected",
      delivered: "✅ Delivered", cancelled: "❌ Cancelled",
    }

    const pickup  = JSON.parse(order.pickupJson) as { address?: string }
    const dropoff = JSON.parse(order.dropoffJson) as { address?: string }

    let timeline = ""
    if (order.createdAt)   timeline += `🕐 Booked: ${order.createdAt.toISOString().slice(0,16).replace("T"," ")}\n`
    if (order.paidAt)      timeline += `💳 Paid: ${order.paidAt.toISOString().slice(0,16).replace("T"," ")}\n`
    if (order.assignedAt)  timeline += `🏍️ Assigned: ${order.assignedAt.toISOString().slice(0,16).replace("T"," ")}\n`
    if (order.pickedUpAt)  timeline += `📦 Collected: ${order.pickedUpAt.toISOString().slice(0,16).replace("T"," ")}\n`
    if (order.deliveredAt) timeline += `✅ Delivered: ${order.deliveredAt.toISOString().slice(0,16).replace("T"," ")}\n`

    await sendText(phone,
      `📦 *Package Details*\n\n🔖 Tracking: \`${order.orderRef}\`\n📋 Order No: ${order.orderNumber}\n\n` +
      `📍 From: ${pickup.address?.slice(0, 45) ?? "—"}\n🏁 To: ${dropoff.address?.slice(0, 45) ?? "—"}\n\n` +
      `📌 *${EMOJI[order.status] ?? "Order placed"}*\n\n` +
      (timeline ? `🕒 *Timeline:*\n${timeline}` : "") +
      `\n_Type_ *menu* _to go back_`
    )
  } else {
    await sendText(phone,
      `❓ *Order not found:* \`${ref}\`\n\nCheck your 16-digit order number or tracking number.\n` +
      `Tracking numbers look like: \`LT-WA1A2B3C4D5E\`\n\n_Type_ *menu* _to go back_`
    )
  }
}

async function handleAdmin(phone: string, lower: string, data: ConversationData) {
  if (lower === "status") {
    const orders  = await db.order.count({ where: { status: { in: ["assigned", "picked_up", "in_transit"] } } })
    const errands = await db.errand.count({ where: { status: { in: ["assigned", "in_progress"] } } })
    await sendText(phone,
      `📊 *Admin Status*\n\nActive deliveries: ${orders}\nActive errands: ${errands}\n\n` +
      `Commands:\n• *orders* — recent orders\n• *riders* — rider status\n• *settle* — run settlement`
    )
  } else if (lower === "orders") {
    const recent = await db.order.findMany({ orderBy: { createdAt: "desc" }, take: 5 })
    const lines  = recent.map(o => `• \`${o.orderRef}\` — ${o.status} — ₦${o.fareTotal.toLocaleString()}`).join("\n")
    await sendText(phone, `📋 *Recent Orders*\n\n${lines || "No orders yet"}`)
  } else {
    const { parseIntent } = await import("../services/nlp.ts")
    const result = await parseIntent(lower)
    await sendText(phone, result.message ?? "Type *status*, *orders*, or *settle*")
  }
}

async function handleRiderPhoto(phone: string, photoId: string) {
  const conv  = await getState(phone)
  const state = conv.state
  const data  = conv.data

  if (state === "RIDER_AWAITING_PICKUP_PHOTO") {
    const orderRef     = data.currentOrder?.orderRef ?? data.orderRef ?? ""
    const orderNumber  = data.pickupOrderNumber ?? ""
    const pickupTime   = new Date().toLocaleTimeString("en-NG", { timeZone: "Africa/Lagos" }) + " WAT"

    await updateData(phone, { pickupPhotoId: photoId, pickupPhotoTime: pickupTime })
    await sendText(phone,
      `📷 *Photo saved!* ${pickupTime}\n\nPickup confirmed for order \`${orderRef}\`\n\nType *queue* to see your delivery bag.`
    )

    // Complete pickup via DB
    await db.order.updateMany({ where: { orderRef }, data: { status: "picked_up", pickedUpAt: new Date() } })
    await setState(phone, "RIDER_ON_JOB", { ...data, pickupPhotoId: photoId, pickupPhotoTime: pickupTime })

    // Notify customer
    const order = await db.order.findFirst({ where: { orderRef } })
    if (order?.senderPhone) {
      await sendText(order.senderPhone,
        `📦 *Package collected!*\n\nOrder: \`${orderRef}\`\n${pickupTime}\n\nYour rider is on the way to the drop-off.\n\nType *1* to track.`
      )
    }
  }
}
