// src/bot/rider.ts
// Rider-side bot handler

import { sendText, sendLocation, sendDocumentBase64 } from "../services/evolution.ts"
import { generateRiderPDF, maskOrderNumber } from "../utils/pdf.ts"
import { getState, setState, updateData, db } from "./states.ts"
import { resolveTrackerId } from "../services/cantrack.ts"
import {
  createAllocationRequest,
  ensureRiderRecord,
  saveRiderPhoneLocation,
  setRiderOffline,
  setRiderOnline,
} from "../services/rider-ops.ts"
import { notifyAdmin, genDeliveryCode, gmapsLink, deliveryQuote, backHint } from "./utils.ts"
import { RIDER_PCT, waitingCharge } from "../pricing/index.ts"
import type { ConversationData, PendingJob, CurrentOrder } from "../types/index.ts"
import { env } from "../utils/env.ts"

export async function handleRider(
  phone: string, text: string, lower: string,
  location: { lat: number; lng: number; live?: boolean } | null,
  state: string, data: ConversationData
) {
  if (location) {
    await saveRiderPhoneLocation(phone, location.lat, location.lng, Boolean(location.live))
    await sendText(phone,
      `Location received. You are online for dispatch.\n\n` +
      `Bike GPS will still be used first when your assigned Cantrack bike is live.\n` +
      `Type *offline* when you stop work.`
    )
    return
  }

  if (["online", "go online", "start work", "available"].includes(lower)) {
    const rider = await setRiderOnline(phone)
    await setState(phone, "RIDER_IDLE", { ...data, deviceId: rider.deviceId || data.deviceId, queue: data.queue ?? [] }, "rider")
    await sendText(phone,
      `You are online.\n\n` +
      (rider.deviceId
        ? `Assigned bike: ${rider.deviceId.slice(0, 12)}...\nCantrack GPS will be used for live tracking.`
        : `No bike assigned yet. Type *assign LT01* or share your WhatsApp live location while waiting for admin approval.`) +
      `\n\nType *offline* to stop receiving jobs.`
    )
    return
  }

  if (["offline", "go offline", "stop work", "unavailable"].includes(lower)) {
    await setRiderOffline(phone)
    await sendText(phone, "You are offline. Location sharing and dispatch for your phone are paused.")
    return
  }

  // GPS device allocation request. Admin approval makes the bike assignment permanent.
  if (lower.startsWith("mydevice ") || lower.startsWith("assign ") || lower.startsWith("bike ")) {
    const raw = text.replace(/^(mydevice|assign|bike)\s+/i, "").trim()
    const deviceId = resolveTrackerId(raw)
    if (!deviceId) {
      await sendText(phone, "I couldn't match that bike. Try *assign LT01*, *assign LT02*, *assign LT03*, *assign LT04*, or *assign LT05*.")
      return
    }
    const user = await db.user.findUnique({ where: { phone }, select: { name: true } }).catch(() => null)
    const riderName = user?.name ?? ""
    const requestId = await createAllocationRequest(phone, deviceId, riderName)
    await ensureRiderRecord(phone, riderName)
    await sendText(phone,
      `Bike allocation request sent to admin.\n\n` +
      `Bike: *${raw.toUpperCase()}*\nRequest: \`${requestId.slice(0, 8)}\`\n\n` +
      `You can type *online* now, but this bike becomes your permanent tracker only after admin approval.`
    )
    await notifyAdmin(`Bike allocation request\nRider: ${phone}\nBike: ${raw.toUpperCase()}\nAdmin should approve from the dashboard.`)
    return
  }

  // GPS device registration
  if (lower.startsWith("mydevice ")) {
    const deviceId = text.split(" ", 2)[1]?.trim() ?? ""
    await setState(phone, "RIDER_IDLE", { ...data, deviceId, queue: data.queue ?? [] }, "rider")
    await sendText(phone,
      `✅ *GPS tracker linked!*\nDevice: \`${deviceId.slice(0, 12)}…\`\n\n` +
      `You'll receive delivery requests.\n\n*Commands:*\n• *1* or *status* — current jobs\n` +
      `• *2* or *queue* — delivery bag\n• *arrive* or *here* — arrived at pickup\n` +
      `• *pickup* — confirm package collected\n• *delivered* — mark delivered\n• *cash* — cash payment\n• *MYDEVICE <id>* — relink`
    )
    return
  }

  // Accept job
  if (["yes", "y", "accept", "1", "ok", "sure"].includes(lower) && data.pendingJobs?.length) {
    const pending = data.pendingJobs as PendingJob[]
    if (pending.length === 1) {
      await riderAccept(phone, pending[0]!, data)
      await updateData(phone, { pendingJobs: [], pendingMode: null })
    } else {
      let msg = "📋 *Which job do you want to accept?*\n\n"
      pending.slice(0, 10).forEach((job, i) => {
        const emoji = job.orderType === "errand" ? "🏃" : "🚲"
        msg += `${i+1}. ${emoji} ${job.pickupAddress.slice(0,40)}\n   🏁 ${job.dropoffAddress.slice(0,40)}\n   💰 ₦${job.fareTotal.toLocaleString()}\n\n`
      })
      msg += "_Reply with the number to accept, or_ *no* _to decline all_"
      await updateData(phone, { pendingMode: "select" })
      await sendText(phone, msg)
    }
    return
  }

  // Select job from list
  if (data.pendingMode === "select" && /^\d+$/.test(lower)) {
    const pending = (data.pendingJobs ?? []) as PendingJob[]
    const idx     = parseInt(lower) - 1
    if (idx >= 0 && idx < pending.length) {
      await updateData(phone, { pendingJobs: [], pendingMode: null })
      await riderAccept(phone, pending[idx]!, data)
    } else {
      await sendText(phone, `❓ Reply with a number between 1 and ${pending.length}`)
    }
    return
  }

  // Decline
  if (["no", "n", "decline", "pass", "2"].includes(lower) && data.pendingJobs?.length) {
    const pending     = (data.pendingJobs ?? []) as PendingJob[]
    const declinedJob = pending[0]
    await updateData(phone, { pendingJobs: [], pendingMode: null })
    await sendText(phone, "✅ Declined. You'll receive the next available job.")

    // Check if ALL riders have now declined this specific job
    if (declinedJob?.customerPhone) {
      const jobRef = declinedJob.orderRef ?? declinedJob.errandRef ?? ""
      let anyStillPending = false
      for (const rp of env.RIDER_PHONES) {
        if (rp === phone) continue
        const rs       = await getState(rp)
        const rPending = (rs.data.pendingJobs ?? []) as PendingJob[]
        if (rPending.some(j => (j.orderRef ?? j.errandRef) === jobRef)) {
          anyStillPending = true
          break
        }
      }
      if (!anyStillPending) {
        // All riders declined — notify customer
        await sendText(declinedJob.customerPhone,
          `⚠️ *All riders are currently busy*\n\n` +
          `We couldn't assign a rider for your order right now.\n\n` +
          `Your options:\n` +
          `• Type *schedule* to reschedule for a later time\n` +
          `• Type *cancel* to cancel this order\n\n` +
          `_We'll keep looking and notify you if a rider becomes free_`
        )
        // Update order status in DB
        if (jobRef.startsWith("LT-") || jobRef.startsWith("ER-")) {
          const table = jobRef.startsWith("ER-") ? "errand" : "order"
          if (table === "order") {
            await db.order.updateMany({ where: { orderRef: jobRef }, data: { status: "created" } })
          }
        }
        await notifyAdmin(`⚠️ All riders declined job ${jobRef} for ${declinedJob.customerPhone}`)
      }
    }
    return
  }

  // Arrived at pickup
  if (["arrive", "arrived", "here", "at pickup", "at location", "i am here"].includes(lower)) {
    await handleArrival(phone, data, state)
    return
  }

  // Arrival selection (multiple items)
  if (data._arriveMode && /^\d+$/.test(lower)) {
    const queue = data.queue as CurrentOrder[]
    const idx   = parseInt(lower) - 1
    if (idx >= 0 && idx < queue.length) {
      await confirmArrival(phone, queue[idx]!, data)
    } else {
      await sendText(phone, `❓ Reply 1 to ${queue.length}`)
    }
    return
  }

  // Pickup confirmation
  if (["pickup", "picked_up", "picked up", "collected", "got it"].includes(lower)) {
    const current  = data.currentOrder as CurrentOrder | undefined
    const orderRef = current?.orderRef ?? data.orderRef ?? ""
    // Look up the order number from DB so we can show the masked version
    let maskedNum = "XXXXXXXXXXXXXXXX"
    if (orderRef) {
      const dbOrder = await db.order.findFirst({ where: { orderRef }, select: { orderNumber: true } })
      if (dbOrder?.orderNumber) maskedNum = maskOrderNumber(dbOrder.orderNumber)
    }
    await setState(phone, "RIDER_AWAITING_PICKUP_CONFIRM", data, "rider")
    await sendText(phone,
      `📦 *Confirm pickup${orderRef ? ` for \`${orderRef}\`` : ""}*\n\n` +
      `Order number on label: \`${maskedNum}\`\n\n` +
      `You can confirm by:\n` +
      `• Typing the *last 5 digits* of the order number\n` +
      `• Typing the *full 16-digit* number\n` +
      `• 📷 *Sending a photo* of the shipping label\n\n` +
      `_Type_ *cancel* _if there is a problem_`
    )
    return
  }

  // Order number entry for pickup (text-based: full 16 digits OR last 5)
  if (state === "RIDER_AWAITING_PICKUP_CONFIRM") {
    const digits = text.replace(/\D/g, "")
    if (digits.length === 5 || digits.length === 16) {
      const order = await db.order.findFirst({
        where: digits.length === 16
          ? { orderNumber: digits }
          : { orderNumber: { endsWith: digits } },
      })
      if (!order) {
        await sendText(phone,
          `❌ *No order found for:* \`${digits}\`\n\nCheck the shipping label carefully.\n\n` +
          `• Type the last *5 digits* from the label\n• Or send a 📷 *photo* of the label\n\n` +
          `_Type_ *cancel* _if there is a problem_`
        )
        return
      }
      const current     = data.currentOrder as CurrentOrder | undefined
      const expectedRef = current?.orderRef ?? data.orderRef ?? ""
      if (expectedRef && order.orderRef.toUpperCase() !== expectedRef.toUpperCase()) {
        await sendText(phone,
          `⚠️ *Wrong package!*\n\nThat number belongs to order \`${order.orderRef}\`, not your assigned \`${expectedRef}\`.\n\n` +
          `_Type_ *cancel* _if there is a problem_`
        )
        return
      }
      await confirmPickupReady(phone, data, order.orderNumber)
    } else if (digits.length > 0) {
      await sendText(phone,
        `❓ Type the *last 5 digits* of the order number from the label, or send a 📷 *photo* of the label.\n\n` +
        `_Type_ *cancel* _if there is a problem_`
      )
    }
    // Zero digits = text message (not a number) — handled by photo path or ignored
    return
  }

  if (state === "RIDER_AWAITING_PICKUP_PHOTO") {
    // Photo is mandatory — no skip allowed
    await sendText(phone,
      `📷 *Photo is required.*\n\nPlease send a photo of the package before proceeding.\n\n` +
      `_Tap 📎 → Camera or Gallery_`
    )
    return
  }

  // Cash payment
  if (["cash_payment", "cash", "cash payment", "customer paid cash"].includes(lower)) {
    await handleCashPayment(phone, data)
    return
  }

  // Delivery code entry
  if (state === "RIDER_AWAIT_CODE" || data.awaitingDeliveryCode) {
    const code = text.replace(/\D/g, "").slice(0, 4)
    if (code.length === 4) {
      if (code === data.deliveryCode) {
        await sendText(phone, "✅ Code verified! Completing delivery...")
        await completeDelivery(phone, data)
      } else {
        // Check if code belongs to different item in queue
        const queue = (data.queue ?? []) as CurrentOrder[]
        const match = queue.find(q => q.deliveryCode === code)
        if (match) {
          await sendText(phone,
            `⚠️ *Wrong item selected!*\n\nThat code belongs to order \`${match.orderRef}\`\n` +
            `📍 ${match.dropoffAddress.slice(0, 45)}\n\nAre you delivering this one?\nType *yes* to switch.`
          )
        } else {
          await sendText(phone,
            `❌ *Wrong code* — \`${code}\` is incorrect.\n\nAsk the receiver to check their WhatsApp and try again.\n\n_Type_ *cancel_ _if there's a problem_`
          )
        }
      }
    } else {
      await sendText(phone, `❓ Type the *4-digit code* shown on the receiver's WhatsApp.\n\n_Type_ *cancel* _if there's a problem_`)
    }
    return
  }

  // Delivery item selection
  if (data.deliverSelectionMode && /^\d+$/.test(lower)) {
    const queue = (data.queue ?? data._queueForDelivery ?? []) as CurrentOrder[]
    const idx   = parseInt(lower) - 1
    if (idx >= 0 && idx < queue.length) {
      const selected = queue[idx]!
      await updateData(phone, { currentOrder: selected, deliverSelectionMode: false })
      await riderMarkDelivered(phone, { ...data, currentOrder: selected, deliverSelectionMode: false })
    } else {
      await sendText(phone, `❓ Reply with a number 1 to ${queue.length}`)
    }
    return
  }

  // Mark delivered
  if (["delivered", "done", "deliver", "complete", "dropoff done"].includes(lower)) {
    await riderMarkDelivered(phone, data)
    return
  }

  // Status
  if (false && ["1", "status", "my status", "earnings"].includes(lower)) {
    const queue   = (data.queue ?? []) as CurrentOrder[]
    const current = data.currentOrder as CurrentOrder | undefined
    await sendText(phone,
      `🏍️ *Rider Status*\n\nState: \`${state}\`\nDevice: \`${(data.deviceId ?? "Not linked").slice(0, 16)}\`\n` +
      `Items in bag: *${queue.length}*\n` +
      (current?.orderRef ? `Delivering: \`${current?.orderRef}\`\n` : "") +
      `\n*Commands:*\n• *queue* — delivery bag\n• *pickup* — confirm collection\n• *delivered* — mark delivered\n• *arrive* — I'm at pickup`
    )
    return
  }

  if (["1", "status", "my status", "earnings"].includes(lower)) {
    const queue = (data.queue ?? []) as CurrentOrder[]
    const current = data.currentOrder as CurrentOrder | undefined
    const rider = await db.rider.findUnique({ where: { phone } }).catch(() => null)
    await sendText(phone,
      `Rider Status\n\nState: \`${state}\`\nOnline: *${rider?.isActive ? "yes" : "no"}*\nBike: \`${(rider?.deviceId || data.deviceId || "Not assigned").slice(0, 16)}\`\n` +
      `Items in bag: *${queue.length}*\n` +
      (current?.orderRef ? `Delivering: \`${current?.orderRef}\`\n` : "") +
      `\nCommands:\n- *online* / *offline*\n- *queue* - delivery bag\n- *pickup* - confirm collection\n- *delivered* - mark delivered\n- *arrive* - I'm at pickup`
    )
    return
  }

  // Queue
  if (["2", "queue", "bag", "delivery bag"].includes(lower)) {
    await showQueue(phone, data)
    return
  }

  // Default rider menu
  await sendText(phone,
    `🏍️ *Rider menu*\n\n1. My status & earnings\n2. Delivery bag\n\nOr type a command:\n` +
    `• *arrive* / *here* — at pickup location\n• *pickup* — confirm collection\n• *delivered* — mark delivered\n` +
    `• *cash* — cash payment\n• *MYDEVICE <id>* — link GPS tracker`
  )
}

async function riderAccept(phone: string, job: PendingJob, data: ConversationData) {
  const customerPhone = job.customerPhone
  const orderRef      = job.orderRef ?? job.errandRef ?? ""

  const custConv = await getState(customerPhone)
  const custData = custConv.data

  if (!["WAITING_RIDER", "TRACKING", "AWAIT_PAYMENT", "ERRAND_WAITING_RUNNER"].includes(custConv.state)) {
    await sendText(phone, "⚠️ This job is no longer available.")
    return
  }

  const pickup  = custData.pickup ?? custData.errandLocation
  const dropoff = custData.dropoff ?? custData.errandReturnLocation

  const pickupNav  = pickup?.lat  ? `\n🗺️ ${gmapsLink(pickup.lat,  pickup.lng,  "Pickup")}` : ""
  const dropoffNav = dropoff?.lat ? `\n🗺️ ${gmapsLink(dropoff.lat, dropoff.lng, "Dropoff")}` : ""

  const fare      = custData.fare
  const errandFare = custData.errandFare
  const riderCut  = fare ? fare.riderEarnings : (errandFare?.riderCut ?? 0)
  const commission = fare ? fare.companyCommission : (errandFare?.commission ?? 0)
  const total     = fare?.totalFare ?? errandFare?.totalFee ?? 0
  const payType   = custData.paymentType ?? "online"
  const isPaid    = custConv.state === "WAITING_RIDER"
  const riderRecord = await db.rider.findUnique({ where: { phone }, select: { deviceId: true } }).catch(() => null)
  const deviceId = riderRecord?.deviceId || data.deviceId

  const senderName = custData.senderName ?? (await db.user.findUnique({ where: { phone: customerPhone } }))?.name ?? "Sender"
  const recipName  = custData.recipientName ?? ""
  const recipPhone = custData.recipientPhone ?? ""

  const currentOrder: CurrentOrder = {
    orderRef:       orderRef,
    customerPhone,
    dropoffAddress: dropoff?.address ?? "",
    dropoffLat:     dropoff?.lat,
    dropoffLng:     dropoff?.lng,
    recipientPhone: recipPhone,
    recipientName:  recipName,
    packageDesc:    custData.packageDesc ?? custData.taskDescription ?? "Package",
    fareTotal:      total,
    paymentType:    payType,
    orderType:      job.orderType,
  }

  await setState(phone, "RIDER_ON_JOB", {
    ...data, assignmentId: undefined, deviceId,
    customerPhone, orderRef,
    fareTotal: total, paymentType: payType,
    paymentConfirmed: isPaid,
    recipientName: recipName, recipientPhone: recipPhone,
    currentOrder, queue: data.queue ?? [],
  }, "rider")

  await setState(customerPhone, "TRACKING", {
    ...custData, deviceId, riderPhone: phone, orderRef,
    riderAcceptedAt: new Date().toISOString(),   // used for modification fee timing
  })

  const payLine = payType === "cash"
    ? `💵 *CASH TRIP*\nCollect *₦${total.toLocaleString()}* from customer\nNet: ₦${riderCut.toLocaleString()}`
    : isPaid
    ? `💳 Payment: *CONFIRMED* ✅\nEarnings: *₦${riderCut.toLocaleString()}*`
    : `⏳ *Waiting for payment...*\nYou'll be notified when confirmed.\nType *cash* if customer pays cash.`

  // Notify customer with rider info
  const riderName = (await db.user.findUnique({ where: { phone } }))?.name ?? "Your rider"
  await sendText(customerPhone,
    `🏍️ *Rider found!*\n\nOrder: \`${orderRef}\`\nRider: *${riderName}* · 📞 +${phone}\n\n` +
    `Type *1* to track your rider's live location.\n` +
    `🔗 View order: ${env.APP_URL}/track/${orderRef}`
  )

  // Notify receiver too
  if (recipPhone) {
    await sendText(recipPhone,
      `🏍️ *Update on your delivery!*\n\nOrder: \`${orderRef}\`\nRider assigned: *${riderName}* · 📞 +${phone}\n\nYour package is being collected now.`
    )
  }

  // Send pickup location pin to rider
  if (pickup?.lat) {
    await sendLocation(phone, pickup.lat, pickup.lng, "Pickup point", pickup.address)
  }

  await sendText(phone,
    `✅ *Job accepted!*\n\nOrder: \`${orderRef}\`\n` +
    `📍 Pickup: ${pickup?.address ?? "?"}${pickupNav}\n` +
    `🏁 Drop-off: ${dropoff?.address ?? "?"}${dropoffNav}\n` +
    `📦 ${currentOrder.packageDesc}\n` +
    `👤 Sender: *${senderName}*\n` +
    `👤 Receiver: *${recipName}* · 📞 ${recipPhone}\n\n` +
    `${payLine}\n\n📍 Pickup location sent above.\n\n` +
    `Type *arrive* or *here* when you reach the pickup.\nType *pickup* when you have the package.`
  )

  await notifyAdmin(`✅ Rider accepted\nOrder: ${orderRef}\nRider: ${phone} → Customer: ${customerPhone}\nPayment: ${payType} - ${isPaid ? "confirmed" : "pending"}`)

  // Send rider receipt PDF (fire-and-forget)
  const dbOrder = await db.order.findFirst({ where: { orderRef } })
  if (dbOrder) {
    generateRiderPDF({
      orderRef,
      orderNumber:    dbOrder.orderNumber,
      senderName:     custData.senderName ?? "",
      senderPhone:    customerPhone,
      recipientName:  recipName,
      recipientPhone: recipPhone,
      pickupAddress:  pickup?.address  ?? "",
      dropoffAddress: dropoff?.address ?? "",
      packageDesc:    currentOrder.packageDesc,
      weightKg:       dbOrder.weightKg,
      fragile:        dbOrder.fragile,
      deliveryType:   dbOrder.deliveryType,
      fareTotal:      total,
      riderEarnings:  riderCut,
      commission,
      paymentType:    payType,
      paymentStatus:  isPaid ? "confirmed" : "pending",
      createdAt:      dbOrder.createdAt,
    })
      .then(b64 => sendDocumentBase64(
        phone, b64, "application/pdf",
        `LT-RiderCopy-${orderRef}.pdf`,
        `🏍️ Your job receipt for ${orderRef}`
      ))
      .catch(e => console.error("[pdf] Rider PDF error:", e))
  }
}

async function handleArrival(phone: string, data: ConversationData, state: string) {
  const queue   = (data.queue ?? []) as CurrentOrder[]
  const current = data.currentOrder as CurrentOrder | undefined

  if (queue.length > 1 && !current?.orderRef) {
    let msg = "📍 *Which pickup location have you arrived at?*\n\n"
    queue.slice(0, 10).forEach((item, i) => {
      msg += `${i+1}. \`${item.orderRef}\` — ${item.dropoffAddress.slice(0, 40)}\n`
    })
    await updateData(phone, { _arriveMode: true })
    await sendText(phone, msg + "\n_Reply with the number_")
  } else {
    const order = current ?? queue[0]
    if (order) await confirmArrival(phone, order, data)
    else await sendText(phone, "❓ No active order found. Type *queue* to see your delivery bag.")
  }
}

async function confirmArrival(phone: string, order: CurrentOrder, data: ConversationData) {
  const arriveTime = new Date().toLocaleTimeString("en-NG", { timeZone: "Africa/Lagos" }) + " WAT"

  if (order.customerPhone) {
    await sendText(order.customerPhone,
      `🏍️ *Your rider has arrived at pickup!*\n\nOrder: \`${order.orderRef}\`\nArrived: *${arriveTime}*\n\n` +
      `Please be ready — a waiting charge of ₦100 applies after 10 minutes.`
    )
  }

  await updateData(phone, {
    _arriveMode:    false,
    arriveTime,
    arriveEpoch:    Date.now() / 1000,
    arriveOrderRef: order.orderRef,
    currentOrder:   order,
  })

  await sendText(phone,
    `✅ *Arrival confirmed!* ${arriveTime}\n\nOrder: \`${order.orderRef}\`\nCustomer notified.\n\n` +
    `⏰ Waiting charge: ₦100 per 10 minutes.\n\nType *pickup* when you have the package.`
  )
  await notifyAdmin(`📍 Rider arrived\nRider: ${phone} | Order: ${order.orderRef} | ${arriveTime}`)
}

// Shared step: order number verified — prompt for photo
async function confirmPickupReady(phone: string, data: ConversationData, orderNumber: string) {
  await updateData(phone, { pickupOrderNumber: orderNumber })
  await setState(phone, "RIDER_AWAITING_PICKUP_PHOTO", { ...data, pickupOrderNumber: orderNumber }, "rider")
  await sendText(phone,
    `✅ *Order confirmed:* \`${orderNumber}\`\n\n` +
    `📷 *Now send a photo of the package.*\n\n` +
    `_Tap 📎 → Camera or Gallery_\n\n⚠️ _Photo is required to proceed_`
  )
}

async function confirmPickupByOrderNumber(phone: string, data: ConversationData, orderNumber: string) {
  const current   = data.currentOrder as CurrentOrder | undefined
  const orderRef  = current?.orderRef ?? data.orderRef ?? ""
  const arrivalEpoch = data.arriveEpoch ?? 0
  const wCharge   = arrivalEpoch > 0 ? waitingCharge(arrivalEpoch) : 0

  await db.order.updateMany({ where: { orderRef }, data: { status: "picked_up", pickedUpAt: new Date() } })
  await setState(phone, "RIDER_ON_JOB", data, "rider")

  const pickupTime = new Date().toLocaleTimeString("en-NG", { timeZone: "Africa/Lagos" }) + " WAT"

  if (current?.customerPhone) {
    let msg = `📦 *Package collected!*\n\nOrder: \`${orderRef}\`\n${pickupTime}\n\n` +
              `Your rider is heading to the drop-off.\n\nType *1* to track.`
    if (wCharge > 0) msg += `\n\n⏰ Waiting charge: ₦${wCharge.toLocaleString()} added.`
    await sendText(current.customerPhone, msg)
  }

  await sendText(phone,
    `✅ *Pickup confirmed!* ${pickupTime}\n\nOrder: \`${orderRef}\`\n` +
    (wCharge > 0 ? `⏰ Waiting charge: ₦${wCharge.toLocaleString()}\n` : "") +
    `\nHead to the drop-off location.\nType *delivered* when done.`
  )
}

async function riderMarkDelivered(phone: string, data: ConversationData) {
  const queue   = (data.queue ?? []) as CurrentOrder[]
  const current = data.currentOrder as CurrentOrder | undefined

  if (queue.length > 1 && !current?.orderRef) {
    let msg = "📦 *Which item are you delivering right now?*\n\n"
    queue.slice(0, 10).forEach((item, i) => {
      msg += `${i+1}. \`${item.orderRef}\`\n   📍 ${item.dropoffAddress.slice(0, 40)}\n\n`
    })
    msg += "_Reply with the number_\n\n_Type_ *cancel* _if there is a problem_"
    await updateData(phone, { deliverSelectionMode: true, _queueForDelivery: queue })
    await sendText(phone, msg)
    return
  }

  const order = current ?? queue[0]
  if (!order?.orderRef) {
    await sendText(phone, "❓ No active delivery. Type *queue* to see your delivery bag.")
    return
  }

  // Generate delivery code and send to both parties
  const code = genDeliveryCode()
  await updateData(phone, { deliveryCode: code, awaitingDeliveryCode: true })
  await setState(phone, "RIDER_AWAIT_CODE", { ...data, deliveryCode: code, awaitingDeliveryCode: true }, "rider")

  if (order.recipientPhone) {
    await sendText(order.recipientPhone,
      `🏍️ *Your rider has arrived!*\n\nOrder: \`${order.orderRef}\`\n\n` +
      `Give this code to the rider:\n\n🔐 *${code}*\n\n_Do not share until you have your package._`
    )
  }
  if (order.customerPhone) {
    await sendText(order.customerPhone,
      `🏍️ *Rider has arrived at drop-off!*\n\nOrder: \`${order.orderRef}\`\n` +
      `Delivery code sent to receiver.\n\nIf receiver is unreachable, the code is: *${code}*`
    )
  }

  await sendText(phone,
    `📦 *Almost done!*\n\nOrder: \`${order.orderRef}\`\n\n` +
    `Codes sent to sender and receiver.\n\nAsk receiver for their *4-digit code:*\n\n` +
    `_Type_ *cancel* _if there is a delivery problem_`
  )
}

async function completeDelivery(phone: string, data: ConversationData) {
  const current        = data.currentOrder as CurrentOrder | undefined
  const orderRef       = current?.orderRef ?? data.orderRef ?? ""
  const customerPhone  = current?.customerPhone ?? ""
  const receiverPhone  = current?.recipientPhone ?? ""
  const fareTotal      = current?.fareTotal ?? 0
  const paymentType    = current?.paymentType ?? "online"
  const riderCut       = Math.round(fareTotal * RIDER_PCT)
  const deliveryTime   = new Date().toLocaleTimeString("en-NG", { timeZone: "Africa/Lagos" }) + " WAT, " +
                         new Date().toLocaleDateString("en-NG", { timeZone: "Africa/Lagos" })
  const quote          = deliveryQuote()

  await db.order.updateMany({ where: { orderRef }, data: { status: "delivered", deliveredAt: new Date(), riderPhone: phone } })

  if (fareTotal && paymentType !== "cash") {
    await db.ledgerEntry.create({ data: {
      riderPhone: phone, orderRef, amount: fareTotal,
      commission: fareTotal - riderCut, earnings: riderCut, paymentType,
    }}).catch(() => {})
  }

  // Notify sender
  if (customerPhone) {
    const senderName = (await db.user.findUnique({ where: { phone: customerPhone } }))?.name ?? "there"
    await sendText(customerPhone,
      `✅ *Package delivered!*\n\nHi ${senderName}! Order \`${orderRef}\` delivered.\n` +
      `Delivered at: *${deliveryTime}*\n\n` +
      `🔗 View receipt: ${env.APP_URL}/track/${orderRef}\n\n` +
      `${quote}\n\nThank you for choosing *Liebe Tag Logistics* 🙏\nType *1* to send another package.`
    )
    const { resetState } = await import("./states.ts")
    await resetState(customerPhone)
  }

  // Notify receiver
  if (receiverPhone) {
    const recvName = (await db.user.findUnique({ where: { phone: receiverPhone } }))?.name ?? "there"
    await sendText(receiverPhone,
      `✅ *Package delivered!*\n\nHi ${recvName}! Order \`${orderRef}\` delivered.\n` +
      `Delivered at: *${deliveryTime}*\n\n` +
      `🔗 Track & receipt: ${env.APP_URL}/track/${orderRef}\n\n` +
      `${quote}\n\nNeed to send something? Reply *hi*!\n— Liebe Tag Logistics`
    )
  }

  await notifyAdmin(`✅ Delivered\nRider: ${phone} | Order: ${orderRef}\nFare: ₦${fareTotal.toLocaleString()} | ${deliveryTime}`)

  // Send rider receipt
  try {
    await sendText(phone,
      `✅ *Delivery complete!*\n\nOrder: \`${orderRef}\`\nEarnings: *₦${riderCut.toLocaleString()}*\nDelivered: ${deliveryTime}\n\n` +
      `🔗 Job receipt: ${env.APP_URL}/track/${orderRef}\n\n${quote}`
    )
  } catch {}

  // Remove from queue and notify next customer
  const allQueue = ((data.queue ?? []) as CurrentOrder[]).filter(q => q.orderRef !== orderRef)
  const fresh    = await import("./states.ts").then(m => m.getState(phone))

  // Notify the next customer in queue that they are up next
  if (allQueue.length > 0) {
    const next = allQueue[0]!
    if (next.customerPhone) {
      await sendText(next.customerPhone,
        `🏍️ *Your delivery is next!*\n\nOrder: \`${next.orderRef}\`\n\n` +
        `Your rider has finished a previous delivery and is now heading to your pickup.\n` +
        `Expect collection soon — please be ready.\n\n` +
        `🔗 Track: ${env.APP_URL}/track/${next.orderRef}`
      ).catch(() => {})
    }
  }

  if (allQueue.length) {
    await setState(phone, "RIDER_COLLECTING", {
      ...fresh.data, queue: allQueue, currentOrder: allQueue[0],
      deliveryCode: "", awaitingDeliveryCode: false, deliverSelectionMode: false,
    }, "rider")
    await sendText(phone, `🎒 *${allQueue.length} item(s)* still to deliver.\nType *queue* to view or select next.`)
  } else {
    const rider = await db.rider.findUnique({ where: { phone }, select: { deviceId: true } }).catch(() => null)
    await setState(phone, "RIDER_IDLE", { deviceId: rider?.deviceId || data.deviceId }, "rider")
    await sendText(phone, `🎉 *All deliveries complete!*\n\nEarnings: ₦${riderCut.toLocaleString()} added.\nType *status* to see your balance.`)
  }
}

async function handleCashPayment(phone: string, data: ConversationData) {
  const current   = data.currentOrder as CurrentOrder | undefined
  const orderRef  = current?.orderRef ?? ""
  const fareTotal = current?.fareTotal ?? 0
  const riderCut  = Math.round(fareTotal * RIDER_PCT)

  if (fareTotal) {
    await db.ledgerEntry.create({ data: {
      riderPhone: phone, orderRef, amount: fareTotal,
      commission: fareTotal - riderCut, earnings: riderCut, paymentType: "cash",
    }}).catch(() => {})
  }

  await sendText(phone,
    `💵 *Cash payment recorded*\n\nOrder: \`${orderRef}\`\nAmount: ₦${fareTotal.toLocaleString()}\n` +
    `Your earnings: ₦${riderCut.toLocaleString()}\n\nType *pickup* when you have the package.`
  )
}

async function showQueue(phone: string, data: ConversationData) {
  const queue   = (data.queue ?? []) as CurrentOrder[]
  const current = data.currentOrder as CurrentOrder | undefined

  // Build a unified list: currentOrder first, then queue items (de-duped)
  const allItems: CurrentOrder[] = []
  if (current?.orderRef) allItems.push(current)
  for (const q of queue) {
    if (!allItems.some(x => x.orderRef === q.orderRef)) allItems.push(q)
  }

  if (!allItems.length) {
    await sendText(phone, "🎒 Your delivery bag is empty.\n\nWaiting for new orders.")
    return
  }

  let msg = `🎒 *Delivery Bag (${allItems.length} item${allItems.length !== 1 ? "s" : ""})*\n\n`
  allItems.forEach((item, i) => {
    const isActive = item.orderRef === current?.orderRef
    const tag      = isActive ? " ← *Active*" : ""
    const type     = item.orderType === "errand" ? "🏃" : "📦"
    msg += `${i + 1}. ${type} \`${item.orderRef}\`${tag}\n   📍 ${item.dropoffAddress.slice(0, 40)}\n   💰 ₦${item.fareTotal.toLocaleString()}\n\n`
  })
  msg += "_Type the number to set as active delivery_"
  await sendText(phone, msg)
}
