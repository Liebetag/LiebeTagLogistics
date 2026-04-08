// src/bot/ai-customer.ts
// AI-driven conversational customer handler — replaces the rigid state machine
// for the info-collection phase. Post-booking states (AWAIT_PAYMENT, TRACKING, etc.)
// continue to be handled by the existing delivery/errand flow handlers.

import { sendText, sendDocumentBase64 } from "../services/evolution.ts"
import { generateCustomerPDF, type OrderPDFData } from "../utils/pdf.ts"
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

  // ── Menu / help shortcut — show menu without clearing booking state ──────
  if (["menu", "help"].includes(lower)) {
    await sendMenu(phone, userName)
    return
  }

  // ── Map numbered menu picks to natural language so AI understands them ───
  const menuMap: Record<string, string> = {
    "1": "I want to book a delivery",
    "2": "I want to book an errand",
    "3": "I want to track my order",
    "4": "I want a price quote",
    "5": "FAQ and support information",
  }
  if (menuMap[lower.trim()] && !data.pickup && !data.dropoff) {
    text  = menuMap[lower.trim()]!
    lower = text.toLowerCase()
  }

  // ── Detect raw "lat,lng" pasted as text — treat same as GPS pin ──────────
  if (!location) {
    const coordMatch = lower.match(/^(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,2}\.\d{3,})$/)
    if (coordMatch) {
      const lat = parseFloat(coordMatch[1]!)
      const lng = parseFloat(coordMatch[2]!)
      if (inAbuja(lat, lng)) {
        const addr = await reverseGeocode(lat, lng) ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`
        const loc: Location = { lat, lng, address: addr }
        if (!data.pickup) {
          await updateData(phone, { pickup: loc })
          text = `My pickup location is: ${addr}`
        } else {
          await updateData(phone, { dropoff: loc })
          text = `The drop-off location is: ${addr}`
        }
        lower = text.toLowerCase()
        const refreshed = await getState(phone)
        data = refreshed.data
      }
    }
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

  // Only save to history if the AI call actually succeeded
  // (prevents failed "Sorry" messages from poisoning future conversations)
  if (!result._failed) {
    history.push({ role: "assistant", content: result.reply })
  } else {
    history.pop() // remove the user message we just pushed, keep history clean
  }

  // ── Handle name-change intent immediately ───────────────────────────────
  if (result.intent === "update_profile" && result.fields.newName) {
    const formatted = result.fields.newName.trim().replace(/\b\w/g, c => c.toUpperCase())
    await setUserName(phone, formatted)
    await sendText(phone, result.reply)
    const nd = { ...data, aiMessages: history as unknown as ConversationData["aiMessages"] }
    await setState(phone, state === "AI_CONFIRM" ? "AI_CONFIRM" : "AI_CHAT", nd)
    return
  }

  // ── If AI failed, send the error reply and stop — don't merge anything ──
  if (result._failed) {
    await sendText(phone, result.reply)
    await setState(phone, state === "AI_CONFIRM" ? "AI_CONFIRM" : "AI_CHAT", {
      ...data,
      aiMessages: history as unknown as ConversationData["aiMessages"],
    })
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
        // Always append the actual calculated fare — strip any ₦ estimate Claude may have included
        confirmMsg = confirmMsg.replace(/₦[\d,]+[^\n]*/g, "").replace(/\n{3,}/g, "\n\n").trimEnd()
        confirmMsg += `\n\n💰 *Delivery fee: ₦${fare.totalFare.toLocaleString()}*`
        const fareExtras: string[] = []
        if (fare.weightCharge > 0)      fareExtras.push(`Heavy item +₦${fare.weightCharge.toLocaleString()}`)
        if (fare.fragileCharge > 0)     fareExtras.push(`Fragile handling +₦${fare.fragileCharge.toLocaleString()}`)
        if (fare.priorityFee > 0)       fareExtras.push(`Priority service +₦${fare.priorityFee.toLocaleString()}`)
        if (fare.scheduledDiscount > 0) fareExtras.push(`Scheduled saving -₦${fare.scheduledDiscount.toLocaleString()}`)
        if (fareExtras.length > 0) confirmMsg += `\n_${fareExtras.join(" · ")}_`
      }

      if (result.intent === "quote") {
        await setState(phone, "AI_CHAT", { ...newData, aiIntent: "quote_done" })
        await sendText(phone,
          confirmMsg +
          "\n\n_Reply_ *book* _to go ahead with booking, or_ *menu* _to exit_"
        )
        break
      }

      newData.aiConfirmIntent = result.intent
      await setState(phone, "AI_CONFIRM", newData)
      await sendText(phone, confirmMsg + "\n\n*Reply YES to confirm or NO to make changes*")
      break
    }

    case "execute": {
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

  if (fields.recipientName)                d.recipientName   = fields.recipientName
  if (fields.recipientPhone)               d.recipientPhone  = normalizePhone(fields.recipientPhone)
  if (fields.packageDesc)                  d.packageDesc     = fields.packageDesc
  if (typeof fields.weightKg === "number") d.weightKg        = fields.weightKg
  if (typeof fields.fragile === "boolean") d.fragile         = fields.fragile
  if (fields.deliveryType)                 d.deliveryType    = fields.deliveryType
  if (fields.scheduledTime)               d.scheduledTime    = fields.scheduledTime
  if (fields.paymentMethod)               d.paymentType      = fields.paymentMethod
  if (fields.errandType)                  d.errandType       = fields.errandType
  if (fields.taskDescription)             d.taskDescription  = fields.taskDescription
  if (fields.deadline)                    d.errandDeadline   = fields.deadline
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
    const lines = ["Frequent recipients (for name/phone pre-fill only — do NOT use these to set dropoffAddress):"]
    for (const [recPhone, info] of seen) {
      lines.push(`- ${info.name || "Unknown"} · ${recPhone}`)
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

  if (!pickup || !pickup.lat || !pickup.lng) {
    await sendText(phone, "📍 I need your pickup location. Please share your GPS pin or type the full address.")
    await setState(phone, "AI_CHAT", data)
    return
  }
  if (!dropoff || !dropoff.lat || !dropoff.lng) {
    await sendText(phone, "📍 I need the drop-off location. Please share a GPS pin or type the full address.")
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

  // ── Ensure sender user record exists (required by DB foreign key) ───────
  try {
    await db.user.upsert({
      where:  { phone },
      update: { name: userName || undefined },
      create: { phone, name: userName ?? "" },
    })
  } catch (e) {
    console.error("[ai-customer] Sender upsert error:", e)
  }

  // ── Ensure recipient user record exists (required by DB foreign key) ────
  if (data.recipientPhone) {
    try {
      await db.user.upsert({
        where:  { phone: data.recipientPhone },
        update: {},
        create: { phone: data.recipientPhone, name: data.recipientName ?? "" },
      })
    } catch (e) {
      console.error("[ai-customer] Recipient upsert error:", e)
    }
  }

  try {
    await db.order.create({
      data: {
        id:               crypto.randomUUID(),
        orderRef,
        orderNumber,
        status:           isCash ? "assigned" : "created",
        senderPhone:      phone,
        senderName:       userName ?? "",
        recipientPhone:   data.recipientPhone ?? "",
        recipientName:    data.recipientName  ?? "",
        pickupJson:       JSON.stringify(pickup),
        dropoffJson:      JSON.stringify(dropoff),
        packageDesc:      data.packageDesc    ?? "Package",
        weightKg:         data.weightKg       ?? 0,
        fragile:          data.fragile === true,    // ← explicit boolean, never 0/1
        itemsJson:        "[]",
        deliveryType:     data.deliveryType   ?? "NORMAL",
        scheduledTime:    data.scheduledTime  ?? null,
        fareTotal:        fare.totalFare,
        fareJson:         JSON.stringify(fare),
        paymentType:      data.paymentType    ?? "cash",
        paymentStatus:    "pending",
        deliveryCode:     delivCode,
        deliveryCodeUsed: false,                    // ← explicit boolean, never 0
        pickupPhotoId:    "",
        pickupPhotoTime:  "",
        extraJson:        "{}",
      },
    })
  } catch (e) {
    console.error("[ai-customer] Order create error:", e)
    await sendText(phone,
      "❌ Something went wrong saving your order. Please try again or type *menu* to start over."
    )
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

  // Build PDF data (shared between cash + online paths)
  const pdfData: OrderPDFData = {
    orderRef,
    orderNumber,
    senderName:     userName ?? "",
    senderPhone:    phone,
    recipientName:  data.recipientName  ?? "",
    recipientPhone: data.recipientPhone ?? "",
    pickupAddress:  pickup.address,
    dropoffAddress: dropoff.address,
    packageDesc:    data.packageDesc ?? "Package",
    weightKg:       data.weightKg    ?? 0,
    fragile:        data.fragile === true,
    deliveryType:   data.deliveryType ?? "NORMAL",
    fareTotal:      fare.totalFare,
    riderEarnings:  fare.riderEarnings,
    commission:     fare.companyCommission,
    paymentType:    data.paymentType ?? "cash",
    paymentStatus:  "pending",
    createdAt:      new Date(),
  }

  if (isCash) {
    await setState(phone, "WAITING_RIDER", newData)
    await sendText(phone,
      `✅ *Order placed!*\n\n` +
      `🔖 Tracking: \`${orderRef}\`\n` +
      `📋 Order No: ${orderNumber}\n\n` +
      `📍 Pickup: _${pickup.address.slice(0, 55)}_\n` +
      `🏁 Drop-off: _${dropoff.address.slice(0, 55)}_\n` +
      `👤 Recipient: ${data.recipientName}\n\n` +
      `💰 Fare: *₦${fare.totalFare.toLocaleString()}* (cash to rider)\n\n` +
      `🔗 Track order: ${env.APP_URL}/track/${orderRef}\n\n` +
      `🔍 *Finding your rider now...*\n\n` +
      `📄 _Sending your shipping label & receipt..._`
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
      `💰 *Total: ₦${fare.totalFare.toLocaleString()}*\n\n` +
      `🔗 Track order: ${env.APP_URL}/track/${orderRef}\n\n` +
      `💳 *Pay here:*\n${link.paymentUrl}\n\n` +
      `⏳ _Link expires in 30 minutes_\n` +
      `_Type_ *resend* _if you need a new link_\n\n` +
      `📄 _Sending your shipping label & receipt..._`
    )
    await notifyAdmin(
      `📦 New delivery!\n` +
      `Ref: \`${orderRef}\`\n` +
      `From: ${userName} (${phone})\n` +
      `${pickup.address.slice(0, 40)} → ${dropoff.address.slice(0, 40)}\n` +
      `Fare: ₦${fare.totalFare.toLocaleString()} (online — awaiting payment)`
    )
  }

  // Send customer PDF (fire-and-forget — don't block the confirmation flow)
  generateCustomerPDF(pdfData)
    .then(b64 => sendDocumentBase64(
      phone, b64, "application/pdf",
      `LT-ShippingLabel-${orderRef}.pdf`,
      `📄 Your shipping label & receipt for order ${orderRef}`
    ))
    .catch(e => console.error("[pdf] Customer PDF error:", e))
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
  const centralLat = 9.0579, centralLng = 7.4951

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

  // ── Ensure client user record exists (required by DB foreign key) ────────
  try {
    await db.user.upsert({
      where:  { phone },
      update: { name: userName || undefined },
      create: { phone, name: userName ?? "" },
    })
  } catch (e) {
    console.error("[ai-customer] Client upsert error:", e)
  }

  try {
    await db.errand.create({
      data: {
        id:              crypto.randomUUID(),
        errandRef,
        errandNumber,
        status:          isCash ? "assigned" : "created",
        errandType:      data.errandType      ?? "Other",
        clientPhone:     phone,
        clientName:      userName             ?? "",
        riderPhone:      "",
        locationJson:    JSON.stringify(location),
        returnJson:      "{}",
        taskDescription: data.taskDescription,
        shoppingList:    "[]",
        deadline:        data.errandDeadline  ?? "No deadline",
        errandFee:       fare.totalFee,
        itemCost:        cashAmt,
        totalCharge:     fare.totalFee + cashAmt,
        paymentType:     data.paymentType     ?? "cash",
        paymentStatus:   "pending",
        runnerNeedsCash: data.runnerNeedsCash === true,  // ← explicit boolean
        cashProvided:    0,
        proofPhotos:     "[]",
        receiptPhotoId:  "",
        deliveryCode:    delivCode,
        extraJson:       "{}",
      },
    })
  } catch (e) {
    console.error("[ai-customer] Errand create error:", e)
    await sendText(phone,
      "❌ Something went wrong saving your errand. Please try again or type *menu* to start over."
    )
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
    created:     "📋 Order placed",
    paid:        "💳 Payment confirmed",
    assigned:    "🏍️ Rider assigned",
    picked_up:   "📦 Package collected",
    in_progress: "🏃 Errand in progress",
    in_transit:  "🚀 On the way",
    delivered:   "✅ Delivered",
    completed:   "✅ Completed",
    cancelled:   "❌ Cancelled",
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

// ─── Post-confirmation order modification ────────────────────────────────────
// Called from handler.ts when customer is in WAITING_RIDER / TRACKING state
// and sends a message that's a modification request or "cancel".
export async function handleOrderModification(
  phone: string,
  text:  string,
  lower: string,
  _state: string,
  data:  ConversationData,
) {
  const userName = await getUserName(phone)
  const orderRef = data.orderRef ?? ""

  // ── Cancel ──────────────────────────────────────────────────────────────
  if (["cancel", "stop"].includes(lower)) {
    const order = orderRef ? await db.order.findFirst({ where: { orderRef } }) : null
    if (order && ["created", "assigned", "picked_up"].includes(order.status)) {
      await db.order.updateMany({ where: { orderRef }, data: { status: "cancelled", cancelledAt: new Date() } })
      // Notify rider if assigned
      if (data.riderPhone) {
        await sendText(data.riderPhone,
          `❌ *Order cancelled by customer*\nOrder: \`${orderRef}\`\n\nJob cancelled — no further action needed.`
        )
      }
    }
    await setState(phone, "IDLE", {})
    await sendMenu(phone, userName)
    await notifyAdmin(`❌ Customer ${phone} cancelled order ${orderRef}`)
    return
  }

  // ── Modification request — run through AI ────────────────────────────────
  // Build context so the AI knows what order is already confirmed
  const order = orderRef ? await db.order.findFirst({ where: { orderRef } }) : null
  if (!order) {
    // No order found — just route to normal AI chat
    await handleAICustomer(phone, text, lower, null, "AI_CHAT", data)
    return
  }

  const oldPickup  = JSON.parse(order.pickupJson)  as { lat: number; lng: number; address: string }
  const oldDropoff = JSON.parse(order.dropoffJson) as { lat: number; lng: number; address: string }

  // Context for AI: tell it there's a confirmed order and what the user wants to change
  const orderContext =
    `CONFIRMED ORDER ${orderRef}:\n` +
    `Pickup: ${oldPickup.address}\n` +
    `Dropoff: ${oldDropoff.address}\n` +
    `Recipient: ${order.recipientName} (${order.recipientPhone})\n` +
    `Package: ${order.packageDesc}\n` +
    `Fare: ₦${order.fareTotal.toLocaleString()}\n` +
    `Payment: ${order.paymentType}\n\n` +
    `The customer wants to MODIFY this order. Extract only the changed fields. ` +
    `For changed addresses, geocode and return new coordinates. ` +
    `Reply with action "confirm" showing old vs new values.`

  const history: AIMessage[] = [{ role: "user", content: text }]
  const result = await processAIMessage(history, orderContext)

  if (result._failed) {
    await sendText(phone, "Sorry, couldn't process that. Type *cancel* to cancel the order or describe your change again.")
    return
  }

  // Merge changed fields
  const newData = await mergeFields({ ...data, pickup: oldPickup, dropoff: oldDropoff }, result.fields)

  // ── Check modification fee: pickup changes >1km AND rider accepted >10 min ago ──
  let modFee = 0
  if (result.fields.pickupAddress && data.riderAcceptedAt) {
    const minsSinceAccept = (Date.now() - new Date(data.riderAcceptedAt as string).getTime()) / 60000
    if (minsSinceAccept > 10 && newData.pickup) {
      const km = haversineKm(oldPickup.lat, oldPickup.lng, newData.pickup.lat, newData.pickup.lng)
      if (km > 1) modFee = 300
    }
  }

  // ── Recalculate fare if locations changed ─────────────────────────────────
  const pickup  = newData.pickup  ?? oldPickup
  const dropoff = newData.dropoff ?? oldDropoff
  const newFare = calculateFare(pickup.lat, pickup.lng, dropoff.lat, dropoff.lng, {
    weightKg:     order.weightKg,
    deliveryType: order.deliveryType as any,
    fragile:      order.fragile,
  })
  const fareDiff   = newFare.totalFare + modFee - order.fareTotal
  const feeLines   = modFee > 0 ? `\n⚠️ Late pickup change fee: *₦300*` : ""
  const diffLine   = fareDiff > 0
    ? `\n💳 *Additional charge: ₦${fareDiff.toLocaleString()}*`
    : fareDiff < 0
    ? `\n💚 *Fare reduced by: ₦${Math.abs(fareDiff).toLocaleString()}*`
    : ""

  // Send confirmation of the change
  const confirmMsg =
    `✏️ *Modification request for* \`${orderRef}\`\n\n` +
    (result.fields.pickupAddress  ? `📍 New pickup: ${pickup.address.slice(0, 55)}\n`  : "") +
    (result.fields.dropoffAddress ? `🏁 New dropoff: ${dropoff.address.slice(0, 55)}\n` : "") +
    (result.fields.recipientName  ? `👤 New recipient: ${newData.recipientName}\n`      : "") +
    (result.fields.recipientPhone ? `📞 New phone: ${newData.recipientPhone}\n`         : "") +
    `\n💰 Updated fare: *₦${(newFare.totalFare + modFee).toLocaleString()}*${feeLines}${diffLine}\n\n` +
    `*Reply YES to confirm this change or NO to keep original*`

  // Store pending modification data
  await setState(phone, "AI_MODIFY_CONFIRM", {
    ...data,
    _pendingModPickup:    pickup,
    _pendingModDropoff:   dropoff,
    _pendingModFare:      newFare,
    _pendingModFee:       modFee,
    _pendingModFareDiff:  fareDiff,
    _pendingModRef:       orderRef,
    recipientName:        newData.recipientName,
    recipientPhone:       newData.recipientPhone,
  })
  await sendText(phone, confirmMsg)
}

// ─── Apply a confirmed modification ──────────────────────────────────────────
export async function applyOrderModification(phone: string, data: ConversationData) {
  const orderRef   = (data._pendingModRef  as string) ?? data.orderRef ?? ""
  const pickup     = data._pendingModPickup  as { lat: number; lng: number; address: string }
  const dropoff    = data._pendingModDropoff as { lat: number; lng: number; address: string }
  const newFare    = data._pendingModFare    as FareBreakdown
  const modFee     = (data._pendingModFee   as number) ?? 0
  const fareDiff   = (data._pendingModFareDiff as number) ?? 0

  if (!orderRef || !pickup || !dropoff || !newFare) {
    await sendText(phone, "❌ Couldn't apply the change. Please try again.")
    await setState(phone, "TRACKING", { ...data, _pendingModRef: undefined })
    return
  }

  // Update DB
  await db.order.updateMany({
    where: { orderRef },
    data: {
      pickupJson:    JSON.stringify(pickup),
      dropoffJson:   JSON.stringify(dropoff),
      fareTotal:     newFare.totalFare + modFee,
      fareJson:      JSON.stringify(newFare),
      recipientName:  data.recipientName  ?? undefined,
      recipientPhone: data.recipientPhone ?? undefined,
    },
  })

  // Notify rider of the change
  if (data.riderPhone) {
    const modLines =
      `📍 Pickup: ${pickup.address.slice(0, 50)}\n` +
      `🏁 Dropoff: ${dropoff.address.slice(0, 50)}\n` +
      `👤 Recipient: ${data.recipientName ?? "—"} · ${data.recipientPhone ?? "—"}\n` +
      `💰 New fare: ₦${(newFare.totalFare + modFee).toLocaleString()}`
    await sendText(data.riderPhone,
      `✏️ *Order modified by customer*\nOrder: \`${orderRef}\`\n\n${modLines}\n\nPlease update your route.`
    )
    // Resend location pin if pickup changed
    if (pickup.lat) {
      const { sendLocation } = await import("../services/evolution.ts")
      await sendLocation(data.riderPhone, pickup.lat, pickup.lng, "Updated Pickup", pickup.address)
    }
  }

  // Generate additional payment link if fareDiff > 0 and online payment
  const payType = (await db.order.findFirst({ where: { orderRef }, select: { paymentType: true } }))?.paymentType
  let extraPayMsg  = ""
  if (fareDiff > 0 && payType === "online") {
    const link = await createPaymentLink(
      `${phone}@whatsapp.com`,
      fareDiff,
      `${orderRef}-MOD`,
      { phone, orderRef, type: "modification" },
    )
    if (link) {
      extraPayMsg = `\n\n💳 *Extra payment required: ₦${fareDiff.toLocaleString()}*\n${link.paymentUrl}`
    }
  }

  await setState(phone, "TRACKING", {
    ...data, pickup, dropoff,
    _pendingModRef: undefined, _pendingModPickup: undefined,
    _pendingModDropoff: undefined, _pendingModFare: undefined,
  })
  await sendText(phone,
    `✅ *Order updated!*\n\n` +
    `📍 ${pickup.address.slice(0, 55)}\n` +
    `🏁 ${dropoff.address.slice(0, 55)}\n` +
    `💰 New fare: ₦${(newFare.totalFare + modFee).toLocaleString()}` +
    extraPayMsg
  )
  await notifyAdmin(`✏️ Order ${orderRef} modified by ${phone}`)
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R   = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a   = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
}

// ─── Normalize Nigerian phone numbers ────────────────────────────────────────
function normalizePhone(p: string): string {
  const digits = p.replace(/\D/g, "")
  if (digits.startsWith("234") && digits.length === 13) return digits
  if (digits.startsWith("0")   && digits.length === 11) return `234${digits.slice(1)}`
  return digits
}