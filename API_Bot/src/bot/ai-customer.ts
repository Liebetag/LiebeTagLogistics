// src/bot/ai-customer.ts
// AI-driven conversational customer handler — replaces the rigid state machine
// for the info-collection phase. Post-booking states (AWAIT_PAYMENT, TRACKING, etc.)
// continue to be handled by the existing delivery/errand flow handlers.

import { sendText } from "../services/evolution.ts"
import { getState, setState, updateData, getUserName, setUserName, db } from "./states.ts"
import { geocode, reverseGeocode, inAbuja } from "../services/geocoding.ts"
import { calculateFare, calculateErrandFare } from "../pricing/index.ts"
import { createPaymentLink } from "../services/paystack.ts"
import { dispatchAllRiders, dispatchAllRidersErrand } from "../flows/dispatch.ts"
import { notifyAdmin, sendMenu, genTrackingRef, genOrderNumber, genErrandRef, genDeliveryCode } from "./utils.ts"
import { processAIMessage } from "../services/ai.ts"
import type { ConversationData, Location, FareBreakdown } from "../types/index.ts"
import type { AIMessage, ExtractedFields } from "../services/ai.ts"
import { env } from "../utils/env.ts"

const MAX_HISTORY = 24  // messages kept in DB for context

// ─── Main entry point ───────────────────────────────────────────────────────
export async function handleAICustomer(
  phone:    string,
  text:     string,
  lower:    string,
  location: Location | null,
  state:    string,
  data:     ConversationData,
) {
  const userName = await getUserName(phone)

  // ── Handle GPS pin ──────────────────────────────────────────────────────
  if (location) {
    if (!inAbuja(location.lat, location.lng)) {
      await sendText(phone, "🚫 That location is outside our delivery zone (Abuja FCT only). Please share an Abuja address.")
      return
    }
    const addr = await reverseGeocode(location.lat, location.lng)
      ?? `${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}`
    const loc: Location = { lat: location.lat, lng: location.lng, address: addr }

    // Assign to pickup or dropoff based on what's missing
    if (!data.pickup) {
      await updateData(phone, { pickup: loc })
      text = `My pickup location is: ${addr}`
    } else if (!data.dropoff) {
      await updateData(phone, { dropoff: loc })
      text = `The drop-off location is: ${addr}`
    } else {
      text = `Location pin shared: ${addr}`
    }
    // Reload fresh data
    const refreshed = await getState(phone)
    data = refreshed.data
  }

  // ── Global cancel ───────────────────────────────────────────────────────
  if (["cancel", "stop", "main menu", "mainmenu"].includes(lower)) {
    await setState(phone, "IDLE", {})
    await sendMenu(phone, userName)
    return
  }

  // ── AI_CONFIRM shortcut: yes/no without calling Claude ─────────────────
  if (state === "AI_CONFIRM") {
    if (/^(yes|yeah|yep|y|confirm|proceed|ok|go ahead|sure|done|1)(\W|$)/i.test(lower)) {
      await executeBooking(phone, userName, data)
      return
    }
    if (/^(no|nope|n|change|modify|edit|wrong|different|cancel|2)(\W|$)/i.test(lower)) {
      await setState(phone, "AI_CHAT", { ...data, aiConfirmIntent: undefined })
      await sendText(phone, "No problem! What would you like to change?")
      return
    }
    // Ambiguous — fall through to AI with full history
  }

  // ── Build conversation history ──────────────────────────────────────────
  const history: AIMessage[] = ((data.aiMessages ?? []) as AIMessage[]).slice(-MAX_HISTORY)
  history.push({ role: "user", content: text })

  // ── Call Claude (with history suggestions injected into summary) ────────
  const summary = buildCollectedSummary(data) + "\n" + await buildHistorySummary(phone)
  const result  = await processAIMessage(history, summary)

  // Add Claude's reply to history
  history.push({ role: "assistant", content: result.reply })

  // ── Handle name-change intent immediately ───────────────────────────────
  if (result.intent === "update_profile" && result.fields.newName) {
    const formatted = result.fields.newName.trim().replace(/\b\w/g, c => c.toUpperCase())
    await setUserName(phone, formatted)
    await sendText(phone, result.reply)
    // Don't discard existing conversation data — just save updated history
    const nd = { ...data, aiMessages: history as unknown as ConversationData["aiMessages"] }
    await setState(phone, state === "AI_CONFIRM" ? "AI_CONFIRM" : "AI_CHAT", nd)
    return
  }

  // ── Merge extracted fields → geocode new addresses ─────────────────────
  let newData = await mergeFields(data, result.fields)
  newData.aiMessages = history as unknown as ConversationData["aiMessages"]
  newData.aiIntent   = result.intent

  // ── Handle cancel intent ────────────────────────────────────────────────
  if (result.intent === "cancel") {
    await setState(phone, "IDLE", {})
    await sendMenu(phone, userName)
    return
  }

  // ── Route by action ─────────────────────────────────────────────────────
  switch (result.action) {

    case "chat": {
      await setState(phone, "AI_CHAT", newData)
      await sendText(phone, result.reply)
      break
    }

    case "confirm": {
      // Calculate and embed fare if not already in the reply
      let confirmMsg = result.reply

      if ((result.intent === "delivery" || result.intent === "quote") &&
           newData.pickup && newData.dropoff) {
        const fare = calculateFare(
          newData.pickup.lat,  newData.pickup.lng,
          newData.dropoff.lat, newData.dropoff.lng,
          {
            weightKg:     newData.weightKg,
            deliveryType: newData.deliveryType,
            fragile:      newData.fragile,
          }
        )
        newData.fare = fare

        // Append fare breakdown if Claude didn't include it
        if (!confirmMsg.includes("₦")) {
          confirmMsg +=
            `\n\n💰 *Delivery fee: ₦${fare.totalFare.toLocaleString()}*\n` +
            `_${fare.breakdown}_`
        }
      }

      if (result.intent === "quote") {
        // Quote only — show price, offer to book
        await setState(phone, "AI_CHAT", { ...newData, aiIntent: "quote_done" })
        await sendText(phone,
          confirmMsg +
          "\n\n_Reply_ *book* _to go ahead with booking, or_ *menu* _to exit_"
        )
        break
      }

      // Real booking confirm
      newData.aiConfirmIntent = result.intent
      await setState(phone, "AI_CONFIRM", newData)
      await sendText(phone, confirmMsg + "\n\n*Reply YES to confirm or NO to make changes*")
      break
    }

    case "execute": {
      // Claude determined user confirmed — execute directly
      await setState(phone, "AI_CHAT", newData)
      await executeBooking(phone, userName, newData)
      break
    }

    case "track": {
      const ref = (result.fields.trackRef ?? text).trim()
      await showOrderStatus(phone, ref)
      break
    }

    default: {
      await setState(phone, "AI_CHAT", newData)
      await sendText(phone, result.reply)
    }
  }
}

// ─── Merge AI-extracted fields into ConversationData ────────────────────────
async function mergeFields(
  data:   ConversationData,
  fields: ExtractedFields,
): Promise<ConversationData> {
  const d = { ...data }

  if (fields.pickupAddress && fields.pickupAddress !== "CURRENT_LOCATION") {
    // Only geocode if address changed
    if (!d.pickup || !d.pickup.address.toLowerCase().includes(fields.pickupAddress.toLowerCase().slice(0, 15))) {
      const loc = await geocode(fields.pickupAddress)
      if (loc && inAbuja(loc.lat, loc.lng)) d.pickup = loc
    }
  }

  if (fields.dropoffAddress) {
    if (!d.dropoff || !d.dropoff.address.toLowerCase().includes(fields.dropoffAddress.toLowerCase().slice(0, 15))) {
      const loc = await geocode(fields.dropoffAddress)
      if (loc && inAbuja(loc.lat, loc.lng)) d.dropoff = loc
    }
  }

  if (fields.errandLocation) {
    if (!d.errandLocation) {
      const loc = await geocode(fields.errandLocation)
      if (loc) d.errandLocation = loc
    }
  }

  if (fields.recipientName)               d.recipientName   = fields.recipientName
  if (fields.recipientPhone)              d.recipientPhone  = normalizePhone(fields.recipientPhone)
  if (fields.packageDesc)                 d.packageDesc     = fields.packageDesc
  if (typeof fields.weightKg === "number") d.weightKg       = fields.weightKg
  if (typeof fields.fragile === "boolean") d.fragile        = fields.fragile
  if (fields.deliveryType)                d.deliveryType    = fields.deliveryType
  if (fields.scheduledTime)               d.scheduledTime   = fields.scheduledTime
  if (fields.paymentMethod)               d.paymentType     = fields.paymentMethod
  if (fields.errandType)                  d.errandType      = fields.errandType
  if (fields.taskDescription)             d.taskDescription = fields.taskDescription
  if (fields.deadline)                    d.errandDeadline  = fields.deadline
  if (typeof fields.runnerNeedsCash === "boolean") d.runnerNeedsCash = fields.runnerNeedsCash
  if (typeof fields.cashAmount === "number")        d.cashProvided   = fields.cashAmount

  return d
}

// ─── Build customer history hints for Claude context ────────────────────────
async function buildHistorySummary(phone: string): Promise<string> {
  try {
    const past = await db.order.findMany({
      where:   { senderPhone: phone },
      orderBy: { createdAt: "desc" },
      take:    10,
      select:  { recipientName: true, recipientPhone: true, dropoffJson: true },
    })
    if (!past.length) return ""

    // Dedupe recipients by phone
    const seen  = new Map<string, { name: string; addresses: string[] }>()
    for (const o of past) {
      if (!o.recipientPhone) continue
      let dropAddr = ""
      try { dropAddr = (JSON.parse(o.dropoffJson) as any).address ?? "" } catch {}
      const entry: { name: string; addresses: string[] } = seen.get(o.recipientPhone) ?? { name: o.recipientName ?? "", addresses: [] }
      if (dropAddr && !entry.addresses.includes(dropAddr)) entry.addresses.push(dropAddr)
      if (!entry.name && o.recipientName) entry.name = o.recipientName
      seen.set(o.recipientPhone, entry)
    }

    if (!seen.size) return ""
    const lines = ["Frequent recipients (from this customer's history):"]
    for (const [recPhone, info] of seen) {
      const addrs = info.addresses.slice(0, 2).map(a => a.slice(0, 50)).join(" / ")
      lines.push(`- ${info.name || "Unknown"} · ${recPhone}${addrs ? ` · Previously delivered to: ${addrs}` : ""}`)
    }
    return lines.join("\n")
  } catch {
    return ""
  }
}

// ─── Build collected-data summary for Claude context ────────────────────────
function buildCollectedSummary(data: ConversationData): string {
  const lines: string[] = []
  if (data.pickup)                                   lines.push(`Pickup: ${data.pickup.address} ✓`)
  if (data.dropoff)                                  lines.push(`Drop-off: ${data.dropoff.address} ✓`)
  if (data.recipientName)                            lines.push(`Recipient name: ${data.recipientName} ✓`)
  if (data.recipientPhone)                           lines.push(`Recipient phone: ${data.recipientPhone} ✓`)
  if (data.packageDesc)                              lines.push(`Package: ${data.packageDesc} ✓`)
  if (data.weightKg)                                 lines.push(`Weight: ${data.weightKg}kg ✓`)
  if (typeof data.fragile === "boolean")             lines.push(`Fragile: ${data.fragile ? "yes" : "no"} ✓`)
  if (data.deliveryType)                             lines.push(`Delivery type: ${data.deliveryType} ✓`)
  if (data.scheduledTime)                            lines.push(`Scheduled time: ${data.scheduledTime} ✓`)
  if (data.paymentType)                              lines.push(`Payment method: ${data.paymentType} ✓`)
  if (data.errandType)                               lines.push(`Errand type: ${data.errandType} ✓`)
  if (data.errandLocation)                           lines.push(`Errand location: ${data.errandLocation.address} ✓`)
  if (data.taskDescription)                          lines.push(`Task: ${data.taskDescription} ✓`)
  if (data.errandDeadline)                           lines.push(`Deadline: ${data.errandDeadline} ✓`)
  if (typeof data.runnerNeedsCash === "boolean")     lines.push(`Runner needs cash: ${data.runnerNeedsCash ? "yes" : "no"} ✓`)
  if (typeof data.cashProvided === "number" && data.cashProvided > 0) lines.push(`Cash amount: ₦${data.cashProvided.toLocaleString()} ✓`)
  return lines.join("\n")
}

// ─── Execute booking (delivery or errand) ───────────────────────────────────
async function executeBooking(phone: string, userName: string, data: ConversationData) {
  const intent = String(data.aiConfirmIntent ?? data.aiIntent ?? "delivery")
  if (intent === "errand") {
    await executeErrand(phone, userName, data)
  } else {
    await executeDelivery(phone, userName, data)
  }
}

// ─── Create delivery order ───────────────────────────────────────────────────
async function executeDelivery(phone: string, userName: string, data: ConversationData) {
  const pickup  = data.pickup
  const dropoff = data.dropoff

  if (!pickup || !dropoff) {
    await sendText(phone, "❌ I still need both pickup and drop-off locations. What are they?")
    await setState(phone, "AI_CHAT", data)
    return
  }
  if (!data.recipientName || !data.recipientPhone) {
    await sendText(phone, "❌ I need the recipient's name and phone number. Please provide them.")
    await setState(phone, "AI_CHAT", data)
    return
  }

  const fare: FareBreakdown = data.fare ?? calculateFare(
    pickup.lat, pickup.lng, dropoff.lat, dropoff.lng,
    { weightKg: data.weightKg, deliveryType: data.deliveryType, fragile: data.fragile }
  )

  const orderRef    = genTrackingRef()
  const orderNumber = genOrderNumber()
  const delivCode   = genDeliveryCode()
  const isCash      = data.paymentType === "cash"

  try {
    await db.order.create({
      data: {
        id:              crypto.randomUUID(),
        orderRef,
        orderNumber,
        status:          isCash ? "assigned" : "created",
        senderPhone:     phone,
        senderName:      userName,
        recipientPhone:  data.recipientPhone!,
        recipientName:   data.recipientName!,
        pickupJson:      JSON.stringify(pickup),
        dropoffJson:     JSON.stringify(dropoff),
        packageDesc:     data.packageDesc   ?? "Package",
        weightKg:        data.weightKg      ?? 0,
        fragile:         data.fragile ? 1 : 0,
        itemsJson:       "[]",
        deliveryType:    data.deliveryType  ?? "NORMAL",
        scheduledTime:   data.scheduledTime ?? null,
        fareTotal:       fare.totalFare,
        fareJson:        JSON.stringify(fare),
        paymentType:     data.paymentType   ?? "online",
        paymentStatus:   "pending",
        deliveryCode:    delivCode,
        deliveryCodeUsed: 0,
        pickupPhotoId:   "",
        pickupPhotoTime: "",
        extraJson:       "{}",
      },
    })
  } catch (e) {
    console.error("[ai-customer] Order create error:", e)
    await sendText(phone, "❌ Something went wrong saving your order. Please try again.")
    await setState(phone, "AI_CHAT", data)
    return
  }

  const newData: ConversationData = {
    ...data,
    orderRef,
    orderNumber,
    deliveryCode: delivCode,
    fare,
    senderName: userName,
  }

  // Notify recipient
  sendText(data.recipientPhone!,
    `📦 *Incoming package for you!*\n\n` +
    `From: *${userName}*\n` +
    `Tracking: \`${orderRef}\`\n\n` +
    `A rider will bring your package soon.\n` +
    `You'll get a 4-digit delivery code to hand to the rider on arrival.\n\n` +
    `_Track at liebetag.com_`
  ).catch(() => {})

  if (isCash) {
    await setState(phone, "WAITING_RIDER", newData)
    await sendText(phone,
      `✅ *Order placed!*\n\n` +
      `🔖 Tracking: \`${orderRef}\`\n` +
      `📋 Order No: ${orderNumber}\n\n` +
      `📍 Pickup: _${pickup.address.slice(0, 55)}_\n` +
      `🏁 Drop-off: _${dropoff.address.slice(0, 55)}_\n` +
      `👤 Recipient: ${data.recipientName}\n\n` +
      `💰 Fare: *₦${fare.totalFare.toLocaleString()}* (cash to rider)\n` +
      `_${fare.breakdown}_\n\n` +
      `🔗 Track order: ${env.APP_URL}/track/${orderRef}\n\n` +
      `🔍 *Finding your rider now...*`
    )
    await dispatchAllRiders(phone, orderRef, newData, fare, pickup, dropoff, "cash", userName)
  } else {
    const link = await createPaymentLink(
      `${phone}@whatsapp.com`,
      fare.totalFare,
      orderRef,
      { phone, orderRef, orderNumber },
      `${env.APP_URL}/payments/verify/${orderRef}`,
    )
    if (!link) {
      await sendText(phone, "❌ Couldn't generate a payment link. Please try again or choose cash payment.")
      await setState(phone, "AI_CHAT", newData)
      return
    }
    newData.paymentUrl = link.paymentUrl
    await setState(phone, "AWAIT_PAYMENT", newData)
    await sendText(phone,
      `✅ *Order confirmed!*\n\n` +
      `🔖 Tracking: \`${orderRef}\`\n` +
      `📋 Order No: ${orderNumber}\n\n` +
      `📍 Pickup: _${pickup.address.slice(0, 55)}_\n` +
      `🏁 Drop-off: _${dropoff.address.slice(0, 55)}_\n` +
      `👤 Recipient: ${data.recipientName}\n\n` +
      `💰 *Total: ₦${fare.totalFare.toLocaleString()}*\n` +
      `_${fare.breakdown}_\n\n` +
      `🔗 Track order: ${env.APP_URL}/track/${orderRef}\n\n` +
      `💳 *Pay here:*\n${link.paymentUrl}\n\n` +
      `⏳ _Link expires in 30 minutes_\n` +
      `_Type_ *resend* _if you need a new link_`
    )
    await notifyAdmin(
      `📦 New delivery!\n` +
      `Ref: \`${orderRef}\`\n` +
      `From: ${userName} (${phone})\n` +
      `${pickup.address.slice(0, 40)} → ${dropoff.address.slice(0, 40)}\n` +
      `Fare: ₦${fare.totalFare.toLocaleString()} (online — awaiting payment)`
    )
  }
}

// ─── Create errand order ─────────────────────────────────────────────────────
async function executeErrand(phone: string, userName: string, data: ConversationData) {
  const location = data.errandLocation

  if (!location) {
    await sendText(phone, "❌ I need the errand location. Where should the runner go?")
    await setState(phone, "AI_CHAT", data)
    return
  }
  if (!data.taskDescription) {
    await sendText(phone, "❌ Please describe the task for the runner.")
    await setState(phone, "AI_CHAT", data)
    return
  }

  const deadline   = (data.errandDeadline ?? "").toLowerCase()
  const isRush     = deadline.includes("hour") || deadline.includes("urgent") || deadline.includes("asap") || deadline.includes("now")
  const centralLat = 9.0579, centralLng = 7.4951  // Central Abuja fallback

  const fare = calculateErrandFare(centralLat, centralLng, location.lat, location.lng, {
    rush:       isRush,
    returnTrip: false,
    itemCost:   (data.cashProvided as number) ?? 0,
  })

  const errandRef    = genErrandRef()
  const errandNumber = genOrderNumber()
  const delivCode    = genDeliveryCode()
  const isCash       = data.paymentType === "cash"
  const cashAmt      = (data.cashProvided as number) ?? 0

  try {
    await db.errand.create({
      data: {
        id:              crypto.randomUUID(),
        errandRef,
        errandNumber,
        status:          isCash ? "assigned" : "created",
        errandType:      data.errandType      ?? "Other",
        clientPhone:     phone,
        clientName:      userName,
        riderPhone:      "",
        locationJson:    JSON.stringify(location),
        returnJson:      "{}",
        taskDescription: data.taskDescription,
        shoppingList:    "[]",
        deadline:        data.errandDeadline  ?? "No deadline",
        errandFee:       fare.totalFee,
        itemCost:        cashAmt,
        totalCharge:     fare.totalFee + cashAmt,
        paymentType:     data.paymentType     ?? "online",
        paymentStatus:   "pending",
        runnerNeedsCash: data.runnerNeedsCash ? 1 : 0,
        cashProvided:    0,
        proofPhotos:     "[]",
        receiptPhotoId:  "",
        deliveryCode:    delivCode,
        extraJson:       "{}",
      },
    })
  } catch (e) {
    console.error("[ai-customer] Errand create error:", e)
    await sendText(phone, "❌ Something went wrong saving your errand. Please try again.")
    await setState(phone, "AI_CHAT", data)
    return
  }

  const newData: ConversationData = { ...data, errandRef, orderRef: errandRef }

  if (isCash) {
    await setState(phone, "ERRAND_WAITING_RUNNER", newData)
    await sendText(phone,
      `✅ *Errand booked!*\n\n` +
      `🔖 Ref: \`${errandRef}\`\n` +
      `📋 No: ${errandNumber}\n\n` +
      `📍 Location: _${location.address.slice(0, 55)}_\n` +
      `📝 Task: ${data.taskDescription.slice(0, 100)}\n` +
      `⏰ Deadline: ${data.errandDeadline ?? "No deadline"}\n\n` +
      `💰 Errand fee: *₦${fare.totalFee.toLocaleString()}* (cash)\n\n` +
      `🔗 Track: ${env.APP_URL}/track/${errandRef}\n\n` +
      `🔍 *Finding a runner...*`
    )
    await dispatchAllRidersErrand(phone, errandRef, newData, fare)
  } else {
    const link = await createPaymentLink(
      `${phone}@whatsapp.com`,
      fare.totalFee,
      errandRef,
      { phone, errandRef, errandNumber },
    )
    if (!link) {
      await sendText(phone, "❌ Couldn't generate a payment link. Please try again.")
      await setState(phone, "AI_CHAT", newData)
      return
    }
    newData.paymentUrl = link.paymentUrl
    await setState(phone, "ERRAND_AWAIT_PAYMENT", newData)
    await sendText(phone,
      `✅ *Errand confirmed!*\n\n` +
      `🔖 Ref: \`${errandRef}\`\n\n` +
      `📍 Location: _${location.address.slice(0, 55)}_\n` +
      `📝 Task: ${data.taskDescription.slice(0, 100)}\n` +
      `⏰ Deadline: ${data.errandDeadline ?? "No deadline"}\n\n` +
      `💰 *Errand fee: ₦${fare.totalFee.toLocaleString()}*\n\n` +
      `💳 *Pay here:*\n${link.paymentUrl}\n\n` +
      `⏳ _Link expires in 30 minutes_`
    )
    await notifyAdmin(
      `🏃 New errand!\n` +
      `Ref: \`${errandRef}\`\n` +
      `From: ${userName} (${phone})\n` +
      `Task: ${data.taskDescription.slice(0, 60)}\n` +
      `Fee: ₦${fare.totalFee.toLocaleString()} (online — awaiting payment)`
    )
  }
}

// ─── Show order/errand status ────────────────────────────────────────────────
export async function showOrderStatus(phone: string, ref: string) {
  const clean = ref.toUpperCase().replace(/[^A-Z0-9\-]/g, "")

  const order = await db.order.findFirst({
    where: {
      OR: [
        { orderRef:    { contains: clean } },
        { orderNumber: ref.replace(/\D/g, "") },
      ],
    },
  })

  const errand = !order ? await db.errand.findFirst({
    where: {
      OR: [
        { errandRef:    { contains: clean } },
        { errandNumber: ref.replace(/\D/g, "") },
      ],
    },
  }) : null

  const record = order ?? errand

  if (!record) {
    await sendText(phone,
      `❓ *Order not found:* \`${ref}\`\n\n` +
      `Check your tracking number (e.g. \`LT-WA1A2B3C4D5\`) or 16-digit order number.\n\n` +
      `_Type_ *menu* _to go back_`
    )
    return
  }

  const STATUS: Record<string, string> = {
    created:    "📋 Order placed",
    paid:       "💳 Payment confirmed",
    assigned:   "🏍️ Rider assigned",
    picked_up:  "📦 Package collected",
    in_progress:"🏃 Errand in progress",
    in_transit: "🚀 On the way",
    delivered:  "✅ Delivered",
    completed:  "✅ Completed",
    cancelled:  "❌ Cancelled",
  }

  const locJson  = JSON.parse((record as any).pickupJson ?? (record as any).locationJson ?? "{}") as { address?: string }
  const destJson = JSON.parse((record as any).dropoffJson ?? "{}") as { address?: string }

  let timeline = ""
  const r = record as any
  if (r.createdAt)   timeline += `🕐 Booked: ${new Date(r.createdAt).toISOString().slice(0, 16).replace("T", " ")} WAT\n`
  if (r.paidAt)      timeline += `💳 Paid: ${new Date(r.paidAt).toISOString().slice(0, 16).replace("T", " ")} WAT\n`
  if (r.assignedAt)  timeline += `🏍️ Assigned: ${new Date(r.assignedAt).toISOString().slice(0, 16).replace("T", " ")} WAT\n`
  if (r.pickedUpAt)  timeline += `📦 Collected: ${new Date(r.pickedUpAt).toISOString().slice(0, 16).replace("T", " ")} WAT\n`
  if (r.deliveredAt || r.completedAt) {
    const d = r.deliveredAt ?? r.completedAt
    timeline += `✅ Done: ${new Date(d).toISOString().slice(0, 16).replace("T", " ")} WAT\n`
  }

  await sendText(phone,
    `📦 *Order Status*\n\n` +
    `🔖 \`${(record as any).orderRef ?? (record as any).errandRef}\`\n` +
    `📌 *${STATUS[record.status] ?? record.status}*\n\n` +
    (locJson.address  ? `📍 ${locJson.address.slice(0, 55)}\n`  : "") +
    (destJson.address ? `🏁 ${destJson.address.slice(0, 55)}\n` : "") +
    (timeline ? `\n🕒 *Timeline:*\n${timeline}` : "") +
    `\n_Type_ *menu* _to go back_`
  )
}

// ─── Normalize Nigerian phone numbers ────────────────────────────────────────
function normalizePhone(p: string): string {
  const digits = p.replace(/\D/g, "")
  if (digits.startsWith("234") && digits.length === 13) return digits
  if (digits.startsWith("0")   && digits.length === 11) return `234${digits.slice(1)}`
  return digits
}
