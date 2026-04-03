// src/flows/dispatch.ts
// Rider dispatch — notify all riders of new delivery or errand

import { sendText, sendLocation } from "../services/evolution.ts"
import { getState, updateData } from "../bot/states.ts"
import { gmapsLink, notifyAdmin } from "../bot/utils.ts"
import type { ConversationData, FareBreakdown, ErrandFare, PendingJob } from "../types/index.ts"
import { env } from "../utils/env.ts"

const DTYPE_EMOJI: Record<string, string> = {
  PRIORITY: "⚡", SCHEDULED: "🗓️", NORMAL: "🚲",
}

export async function dispatchAllRiders(
  customerPhone: string, orderRef: string, data: ConversationData,
  fare: FareBreakdown, pickup: { lat: number; lng: number; address: string },
  dropoff: { lat: number; lng: number; address: string },
  paymentType: "online" | "cash",
  senderName = "Sender"
) {
  const dtype      = data.deliveryType ?? "NORMAL"
  const pEmoji     = DTYPE_EMOJI[dtype] ?? "🚲"
  const riderCut   = fare.riderEarnings
  const commission = fare.companyCommission

  const pickupNav  = pickup.lat ? `\n🗺️ ${gmapsLink(pickup.lat, pickup.lng, "Pickup")}` : ""
  const dropoffNav = dropoff.lat ? `\n🗺️ ${gmapsLink(dropoff.lat, dropoff.lng, "Dropoff")}` : ""

  const paymentLine = paymentType === "cash"
    ? `💵 *CASH TRIP*\nCollect *₦${fare.totalFare.toLocaleString()}* from customer\n` +
      `₦${commission.toLocaleString()} commission → Saturday settlement\nYour net: ₦${riderCut.toLocaleString()}`
    : `💳 Payment: *${paymentType === "online" ? "AWAITING — you'll be unblocked when paid" : "CONFIRMED"} ✅*\n` +
      `Your earnings: *₦${riderCut.toLocaleString()}*`

  const msg = (
    `🚨 *NEW DELIVERY — ${orderRef}*\n\n` +
    `${pEmoji} *${dtype}*${paymentType === "online" ? " · ⏳ Awaiting payment" : ""}\n\n` +
    `📍 Pickup: ${pickup.address.slice(0, 50)}${pickupNav}\n` +
    `🏁 Drop-off: ${dropoff.address.slice(0, 50)}${dropoffNav}\n` +
    `📦 ${data.packageDesc ?? "Package"} · ${data.weightKg ?? 0}kg` +
    `${data.fragile ? "  ⚠️ fragile" : ""}\n` +
    `👤 Sender: *${senderName}*\n` +
    `👤 Receiver: ${data.recipientName ?? "—"} · 📞 ${data.recipientPhone ?? "—"}\n\n` +
    `${paymentLine}\n\n` +
    `*Do you want to accept this job?*\n\n1. Yes — accept\n2. No — decline`
  )

  const jobSummary: PendingJob = {
    customerPhone: customerPhone,
    orderRef,
    pickupAddress:  pickup.address,
    dropoffAddress: dropoff.address,
    deliveryType:   dtype,
    fareTotal:      fare.totalFare,
    paymentType,
    paymentPending: paymentType === "online",
    orderType:      "delivery",
  }

  for (const riderPhone of env.RIDER_PHONES) {
    const rState  = await getState(riderPhone)
    const pending = (rState.data.pendingJobs ?? []) as PendingJob[]
    await updateData(riderPhone, { pendingJobs: [...pending, jobSummary], pendingMode: null })
    await sendText(riderPhone, msg)
  }
}

export async function dispatchAllRidersErrand(
  clientPhone: string, errandRef: string,
  data: ConversationData, fare: ErrandFare
) {
  const etype = data.errandType ?? "OTHER"
  const loc   = data.errandLocation!
  const locNav = loc ? `\n🗺️ ${gmapsLink(loc.lat, loc.lng, "Errand location")}` : ""

  const msg = (
    `🏃 *NEW ERRAND — ${errandRef}*\n\n` +
    `📍 Location: ${loc?.address.slice(0, 50)}${locNav}\n` +
    `📋 Task: ${(data.taskDescription ?? "").slice(0, 100)}\n` +
    (data.errandDeadline ? `🕐 Deadline: ${data.errandDeadline}\n` : "") +
    (data.runnerNeedsCash ? `💵 Client will give you ₦${(data.cashProvided ?? 0).toLocaleString()} for items\n` : "") +
    `\n💰 Your fee: *₦${fare.riderCut.toLocaleString()}*\n\n` +
    `*Do you want this errand?*\n\n1. Yes — accept\n2. No — decline`
  )

  const jobSummary: PendingJob = {
    customerPhone: clientPhone,
    errandRef,
    pickupAddress:  loc?.address ?? "",
    dropoffAddress: "",
    deliveryType:   "NORMAL",
    fareTotal:      fare.totalFee,
    paymentType:    data.errandFare ? "online" : "cash",
    orderType:      "errand",
  }

  for (const riderPhone of env.RIDER_PHONES) {
    const rState  = await getState(riderPhone)
    const pending = (rState.data.pendingJobs ?? []) as PendingJob[]
    await updateData(riderPhone, { pendingJobs: [...pending, jobSummary], pendingMode: null })
    await sendText(riderPhone, msg)
  }
}
