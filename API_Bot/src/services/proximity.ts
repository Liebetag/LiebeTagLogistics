// src/services/proximity.ts
// Proximity notifications — alert customer + recipient when rider is ~5 min away

import { sendText } from "./evolution.ts"
import { db } from "../bot/states.ts"
import { haversineKm } from "../pricing/index.ts"
import type { GPSLocation } from "../types/index.ts"
import { env } from "../utils/env.ts"

const ALERT_KM   = 1.5   // ~5 min at 18 km/h bike speed
const notified   = new Set<string>()  // ref → prevent duplicate alerts

export async function checkProximityNotifications(locations: GPSLocation[]) {
  if (!locations.length) return

  try {
    // Fetch all orders that have been picked up but not yet delivered
    const activeOrders = await db.order.findMany({
      where: { status: { in: ["assigned", "picked_up"] } },
    })

    for (const order of activeOrders) {
      if (order.status !== "picked_up") continue  // only notify after pickup confirmed
      if (!order.riderPhone) continue

      const key = `${order.orderRef}-near`
      if (notified.has(key)) continue  // already sent

      // Look up this rider's GPS device
      const rider = await db.rider.findUnique({
        where:  { phone: order.riderPhone },
        select: { deviceId: true },
      })
      if (!rider?.deviceId) continue

      const gps = locations.find(l => l.deviceId === rider.deviceId)
      if (!gps) continue

      // Parse dropoff
      let dropLat = 0, dropLng = 0, dropAddr = ""
      try {
        const d = JSON.parse(order.dropoffJson) as { lat?: number; lng?: number; address?: string }
        dropLat = d.lat ?? 0
        dropLng = d.lng ?? 0
        dropAddr = d.address ?? ""
      } catch {}
      if (!dropLat || !dropLng) continue

      const dist = haversineKm(gps.latitude, gps.longitude, dropLat, dropLng)
      if (dist > ALERT_KM) continue

      notified.add(key)
      const riderName = (await db.user.findUnique({ where: { phone: order.riderPhone } }))?.name ?? "Your rider"
      const etaMins   = Math.max(1, Math.round((dist / 18) * 60))

      // Notify sender
      if (order.senderPhone) {
        await sendText(order.senderPhone,
          `🏍️ *Almost there!*\n\n` +
          `Order: \`${order.orderRef}\`\n` +
          `*${riderName}* is ~${etaMins} min from the drop-off.\n\n` +
          `Notifying recipient now...\n` +
          `🔗 Track: ${env.APP_URL}/track/${order.orderRef}`
        ).catch(() => {})
      }

      // Notify recipient
      if (order.recipientPhone) {
        await sendText(order.recipientPhone,
          `🏍️ *Get ready — package almost here!*\n\n` +
          `Order: \`${order.orderRef}\`\n` +
          `From: *${order.senderName}*\n\n` +
          `*${riderName}* is ~${etaMins} min away.\n` +
          `Please be available to receive your package.\n\n` +
          `🔗 Track: ${env.APP_URL}/track/${order.orderRef}`
        ).catch(() => {})
      }

      console.log(`[proximity] ✅ Notified ${order.orderRef} — rider ${dist.toFixed(2)}km from dropoff`)
    }

    // Clean up delivered orders from cache
    const done = await db.order.findMany({
      where: { status: { in: ["delivered", "cancelled"] } },
      select: { orderRef: true },
    })
    for (const d of done) notified.delete(`${d.orderRef}-near`)

  } catch (e) {
    console.error("[proximity] error:", e)
  }
}
