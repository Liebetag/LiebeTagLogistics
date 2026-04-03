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
import { handleAICustomer } from "./ai-customer.ts"
import { calculateFare, RIDER_PCT, waitingCharge } from "../pricing/index.ts"
import { db } from "./states.ts"
import { env } from "../utils/env.ts"
import type { ConversationData, Location } from "../types/index.ts"

// States handled by legacy flow handlers (post-booking mechanical states)
const LEGACY_DELIVERY_STATES = new Set([
  "AWAIT_PAYMENT", "WAITING_RIDER", "TRACKING",
  "PROCESSING_PAYMENT",
  // Legacy collection states (keep working if someone is mid-flow)
  "PICKUP_ADDRESS", "ADDRESS_SUGGEST_PICKUP", "DROPOFF_ADDRESS", "ADDRESS_SUGGEST_DROPOFF",
  "RECEIVER_NAME", "RECEIVER_PHONE", "ITEM_SELECT", "ITEM_NAME_0", "ITEM_WEIGHT_0",
  "ITEM_FRAGILE_0", "PACKAGE_FRAGILE", "DELIVERY_TYPE", "SCHEDULED_TIME",
  "PAYMENT_METHOD",
])
const LEGACY_ERRAND_STATES = new Set([
  "ERRAND_AWAIT_PAYMENT", "ERRAND_WAITING_RUNNER", "ERRAND_TRACKING",
  "ERRAND_PROCESSING",
  // Legacy collection states
  "ERRAND_TYPE", "ERRAND_LOCATION", "ERRAND_LOCATION_SUGGEST", "ERRAND_TASK",
  "ERRAND_DEADLINE", "ERRAND_NEEDS_CASH", "ERRAND_CASH_AMOUNT", "ERRAND_PAYMENT",
])
const LEGACY_QUOTE_STATES = new Set([
  "QUOTE_PICKUP", "QUOTE_PICKUP_SUGGEST", "QUOTE_DROPOFF", "QUOTE_DROPOFF_SUGGEST",
  "QUOTE_ITEMS", "QUOTE_WEIGHT", "QUOTE_FRAGILE", "QUOTE_TYPE", "QUOTE_CONFIRM",
])

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
  await handleCustomer(phone, text, lower, location, state, data, role)
}

async function handleCustomer(
  phone: string, text: string, lower: string,
  location: Location | null, state: string, data: ConversationData,
  _role: string,
) {
  // ── First-time name collection ──────────────────────────────────────────
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

  if (state === "ONBOARDING_NAME") {
    if (text.trim().length >= 2 && !/^\d+$/.test(text.trim())) {
      const name = text.trim().replace(/\b\w/g, c => c.toUpperCase())
      await setUserName(phone, name)
      await setState(phone, "AI_CHAT", {})
      await sendText(phone,
        `✅ *Nice to meet you, ${name}!* 👋\n\n` +
        `I'm your Liebe Tag Logistics assistant.\n\n` +
        `Just tell me what you need — I understand natural language!\n\n` +
        `_Examples:_\n` +
        `• _"Send a package from Wuse 2 to Garki for Amaka, 08012345678"_\n` +
        `• _"Book an errand to pick up food from Chicken Republic, Jabi"_\n` +
        `• _"How much to deliver from Maitama to Gwarinpa?"_\n\n` +
        `What can I help you with? 😊`
      )
      return
    }
    await sendText(phone, "❓ Please type your full name e.g. *Amaka Johnson*")
    return
  }

  // ── Post-booking states → existing flow handlers ────────────────────────
  if (LEGACY_DELIVERY_STATES.has(state)) {
    await handleDelivery(phone, text, lower, location, state, data)
    return
  }
  if (LEGACY_ERRAND_STATES.has(state)) {
    await handleErrand(phone, text, lower, location, state, data)
    return
  }
  if (LEGACY_QUOTE_STATES.has(state)) {
    const { handleQuote } = await import("../flows/quote.ts")
    await handleQuote(phone, text, lower, location as any, state, data)
    return
  }

  // ── AWAITING_TRACKING (legacy) ──────────────────────────────────────────
  if (state === "AWAITING_TRACKING") {
    const { showOrderStatus } = await import("./ai-customer.ts")
    await showOrderStatus(phone, text.trim())
    await setState(phone, "AI_CHAT", {})
    return
  }

  // ── Everything else → AI conversational handler ─────────────────────────
  await handleAICustomer(phone, text, lower, location, state, data)
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
