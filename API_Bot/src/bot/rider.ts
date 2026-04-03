// src/bot/rider.ts
// Rider-side bot handler

import { sendText, sendLocation } from "../services/evolution.ts"
import { getState, setState, updateData, db } from "./states.ts"
import { cantrack } from "../services/cantrack.ts"
import { notifyAdmin, genDeliveryCode, gmapsLink, deliveryQuote, backHint } from "./utils.ts"
import { RIDER_PCT, waitingCharge } from "../pricing/index.ts"
import type { ConversationData, PendingJob, CurrentOrder } from "../types/index.ts"
import { env } from "../utils/env.ts"

export async function handleRider(
  phone: string, text: string, lower: string,
  location: { lat: number; lng: number } | null,
  state: string, data: ConversationData
) {
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
    await updateData(phone, { pendingJobs: [], pendingMode: null })
    await sendText(phone, "✅ Declined. You'll receive the next available job.")
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
    if (orderRef) {
      await setState(phone, "RIDER_AWAITING_PICKUP_CONFIRM", data, "rider")
      await sendText(phone,
        `📦 *Confirm pickup for order* \`${orderRef}\`\n\n` +
        `Type the *16-digit order number* from the shipping label:\n\n` +
        `_Example: 20260321XXXXXXXX_\n\nAfter confirming, send a *photo* of the package.\n\n` +
        `_Type_ *cancel* _if there is a problem_`
      )
    } else {
      await setState(phone, "RIDER_AWAITING_PICKUP_CONFIRM", data, "rider")
      await sendText(phone,
        `📦 *Confirm package pickup*\n\nType the *16-digit order number* from the shipping label:\n\n` +
        `_Example: 20260321XXXXXXXX_\n\n_Type_ *cancel* _if there is a problem_`
      )
    }
    return
  }

  // Order number entry for pickup
  if (state === "RIDER_AWAITING_PICKUP_CONFIRM") {
    const digits = text.replace(/\D/g, "")
    if (digits.length === 16) {
      const order = await db.order.findFirst({ where: { orderNumber: digits } })
      if (!order) {
        await sendText(phone,
          `❌ *Order not found:* \`${digits}\`\n\nCheck the shipping label carefully.\n\n_Type_ *cancel* _if there is a problem_`
        )
        return
      }
      const current    = data.currentOrder as CurrentOrder | undefined
      const expectedRef = current?.orderRef ?? data.orderRef ?? ""
      if (expectedRef && order.orderRef.toUpperCase() !== expectedRef.toUpperCase()) {
        await sendText(phone,
          `⚠️ *Wrong package!*\n\nOrder \`${digits}\` belongs to a different delivery.\n` +
          `Your assigned order is \`${expectedRef}\`.\n\n_Type_ *cancel_ _if there is a problem_`
        )
        return
      }
      await updateData(phone, { pickupOrderNumber: digits })
      await setState(phone, "RIDER_AWAITING_PICKUP_PHOTO", data, "rider")
      await sendText(phone,
        `✅ *Order confirmed:* \`${digits}\`\n\n📷 Now send a *photo* of the package.\n\n` +
        `_Tap 📎 → Camera or Gallery_\n\nOr type *skip* if you cannot take a photo`
      )
    } else if (["skip", "no photo"].includes(lower)) {
      await confirmPickupByOrderNumber(phone, data, data.pickupOrderNumber ?? "")
    } else {
      await sendText(phone,
        `❓ Type the *16-digit order number* from the label.\n_Looks like: 20260321XXXXXXXX_\n\n_Type_ *cancel* _if there is a problem_`
      )
    }
    return
  }

  if (state === "RIDER_AWAITING_PICKUP_PHOTO") {
    if (["skip", "no photo", "no camera"].includes(lower)) {
      await confirmPickupByOrderNumber(phone, data, data.pickupOrderNumber ?? "")
    } else {
      await sendText(phone, "📷 Please send a *photo* of the package.\n\nTap 📎 → Camera\n\nOr type *skip*")
    }
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
  if (["1", "status", "my status", "earnings"].includes(lower)) {
    const queue   = (data.queue ?? []) as CurrentOrder[]
    const current = data.currentOrder as CurrentOrder | undefined
    await sendText(phone,
      `🏍️ *Rider Status*\n\nState: \`${state}\`\nDevice: \`${(data.deviceId ?? "Not linked").slice(0, 16)}\`\n` +
      `Items in bag: *${queue.length}*\n` +
      (current?.orderRef ? `Delivering: \`${current.orderRef}\`\n` : "") +
      `\n*Commands:*\n• *queue* — delivery bag\n• *pickup* — confirm collection\n• *delivered* — mark delivered\n• *arrive* — I'm at pickup`
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
    ...data, assignmentId: null,
    customerPhone, orderRef,
    fareTotal: total, paymentType: payType,
    paymentConfirmed: isPaid,
    recipientName: recipName, recipientPhone: recipPhone,
    currentOrder, queue: data.queue ?? [],
  }, "rider")

  await setState(customerPhone, "TRACKING", {
    ...custData, deviceId: data.deviceId, riderPhone: phone, orderRef,
  })

  const payLine = payType === "cash"
    ? `💵 *CASH TRIP*\nCollect *₦${total.toLocaleString()}* from customer\nNet: ₦${riderCut.toLocaleString()}`
    : isPaid
    ? `💳 Payment: *CONFIRMED* ✅\nEarnings: *₦${riderCut.toLocaleString()}*`
    : `⏳ *Waiting for payment...*\nYou'll be notified when confirmed.\nType *cash* if customer pays cash.`

  // Notify customer with rider info
  const riderName = (await db.user.findUnique({ where: { phone } }))?.name ?? "Your rider"
  await sendText(customerPhone,
    `🏍️ *Rider found!*\n\nOrder: \`${orderRef}\`\nRider: *${riderName}*\n📞 +${phone}\n\nType *1* to track your rider.`
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
      `Delivered at: *${deliveryTime}*\n\n${quote}\n\nThank you for choosing *Liebe Tag Logistics* 🙏\nType *1* to send another package.`
    )
    const { resetState } = await import("./states.ts")
    await resetState(customerPhone)
  }

  // Notify receiver
  if (receiverPhone) {
    const recvName = (await db.user.findUnique({ where: { phone: receiverPhone } }))?.name ?? "there"
    await sendText(receiverPhone,
      `✅ *Package delivered!*\n\nHi ${recvName}! Order \`${orderRef}\` delivered.\n` +
      `Delivered at: *${deliveryTime}*\n\n${quote}\n\nNeed to send something? Reply *hi*!\n— Liebe Tag Logistics`
    )
  }

  await notifyAdmin(`✅ Delivered\nRider: ${phone} | Order: ${orderRef}\nFare: ₦${fareTotal.toLocaleString()} | ${deliveryTime}`)

  // Send rider invoice
  try {
    await sendText(phone,
      `✅ *Delivery complete!*\n\nOrder: \`${orderRef}\`\nYour earnings: *₦${riderCut.toLocaleString()}*\nDelivered: ${deliveryTime}\n\n${quote}`
    )
  } catch {}

  // Remove from queue
  const newQueue = ((data.queue ?? []) as CurrentOrder[]).filter(q => q.orderRef !== orderRef)
  const fresh    = await import("./states.ts").then(m => m.getState(phone))

  if (newQueue.length) {
    await setState(phone, "RIDER_COLLECTING", {
      ...fresh.data, queue: newQueue, currentOrder: {},
      deliveryCode: "", awaitingDeliveryCode: false, deliverSelectionMode: false,
    }, "rider")
    await sendText(phone, `🎒 *${newQueue.length} item(s)* still to deliver.\nType *queue* to select next delivery.`)
  } else {
    await setState(phone, "RIDER_IDLE", { deviceId: data.deviceId }, "rider")
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
  const queue = (data.queue ?? []) as CurrentOrder[]
  if (!queue.length) {
    await sendText(phone, "🎒 Your delivery bag is empty.\n\nWaiting for new orders.")
    return
  }
  let msg = `🎒 *Delivery Bag (${queue.length} items)*\n\n`
  queue.forEach((item, i) => {
    msg += `${i+1}. \`${item.orderRef}\`\n   📍 ${item.dropoffAddress.slice(0, 40)}\n   💰 ₦${item.fareTotal.toLocaleString()}\n\n`
  })
  msg += "_Type the number to select as current delivery_"
  await sendText(phone, msg)
}
