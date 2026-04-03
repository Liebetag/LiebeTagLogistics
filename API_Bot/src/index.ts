// src/index.ts
// Liebe Tag Logistics API v4 — Bun + Hono + Prisma

import { Hono } from "hono"
import { cors } from "hono/cors"
import { createBunWebSocket } from "hono/bun"
import { env } from "./utils/env.ts"
import { db } from "./bot/states.ts"
import { handleMessage } from "./bot/handler.ts"
import { cantrack, TRACKERS, registerBroadcast } from "./services/cantrack.ts"
import { getMediaBase64 } from "./services/evolution.ts"
import type { GPSLocation } from "./types/index.ts"

const app = new Hono()

// ─── WebSocket setup ──────────────────────────────────────────────────────────
const { upgradeWebSocket, websocket } = createBunWebSocket()
const wsClients = new Set<{ send: (data: string) => void }>()

// Register cantrack broadcast → push to all connected dashboard clients
registerBroadcast((locations: GPSLocation[]) => {
  if (wsClients.size === 0) return
  const msg = JSON.stringify({ type: "trackers", data: locations })
  for (const client of wsClients) {
    try { client.send(msg) } catch {}
  }
})

// ─── CORS ─────────────────────────────────────────────────────────────────────
app.use("*", cors({
  origin:  env.ALLOWED_ORIGINS.split(","),
  methods: ["GET","POST","PUT","DELETE","OPTIONS"],
}))

// ─── Auth middleware ───────────────────────────────────────────────────────────
const requireApiKey = async (c: any, next: Function) => {
  const key = c.req.header("X-API-Key") || c.req.header("Authorization")?.replace("Bearer ","")
  if (!env.API_KEY || key === env.API_KEY) return next()
  return c.json({ error: "Unauthorized" }, 401)
}

// ─── Health ───────────────────────────────────────────────────────────────────
app.get("/", async c => {
  const cached = cantrack.getAllCached()
  const order  = await db.order.count({ where: { status: { in: ["assigned","picked_up","in_transit"] } } })
  return c.json({
    status:         "ok",
    service:        "Liebe Tag Logistics API v4 (TypeScript/Bun)",
    activeOrders:   order,
    gpsTrackers:    Object.keys(TRACKERS).length,
    gpsLive:        cached.length,
    gpsPolling:     cantrack.isPolling(),
    gpsLastOk:      cantrack.lastPollSuccess(),
  })
})

// ─── WhatsApp Webhook ─────────────────────────────────────────────────────────
app.post("/webhook/whatsapp", async c => {
  try {
    const payload  = await c.req.json() as Record<string, any>
    const event    = payload.event as string
    if (!["messages.upsert","MESSAGES_UPSERT","messages.update"].includes(event))
      return c.json({ status: "ignored", event })

    const data     = payload.data ?? {}
    const key      = data.key ?? {}
    if (key.fromMe) return c.json({ status: "ignored", reason: "outgoing" })

    const remoteJid = key.remoteJid ?? ""
    if (remoteJid.endsWith("@g.us")) return c.json({ status: "ignored", reason: "group" })
    const phone = remoteJid.replace("@s.whatsapp.net", "").replace("+", "")

    const msgContent = data.message ?? {}
    let   text       = ""
    let   location: { lat: number; lng: number; live?: boolean } | null = null
    let   voiceBuffer: Buffer | undefined
    let   photoId: string | undefined

    if (msgContent.conversation)                   text = msgContent.conversation
    else if (msgContent.extendedTextMessage?.text) text = msgContent.extendedTextMessage.text
    else if (msgContent.buttonsResponseMessage)    text = msgContent.buttonsResponseMessage.selectedButtonId ?? ""
    else if (msgContent.listResponseMessage)       text = msgContent.listResponseMessage.singleSelectReply?.selectedRowId ?? ""

    if (msgContent.locationMessage) {
      location = { lat: msgContent.locationMessage.degreesLatitude, lng: msgContent.locationMessage.degreesLongitude, live: false }
    } else if (msgContent.liveLocationMessage) {
      location = { lat: msgContent.liveLocationMessage.degreesLatitude, lng: msgContent.liveLocationMessage.degreesLongitude, live: true }
    }

    if (msgContent.imageMessage) photoId = key.id

    if (msgContent.audioMessage && !text) {
      const buf = await getMediaBase64(key.id ?? "")
      if (buf) voiceBuffer = buf
      else await import("./services/evolution.ts").then(m =>
        m.sendText(phone, "🎤 Couldn't load your voice note. Please type your message.")
      )
    }

    if (!text && !location && !voiceBuffer && !photoId)
      return c.json({ status: "ignored", reason: "no content" })

    await handleMessage(phone, text, location as any, voiceBuffer, photoId)
    return c.json({ status: "ok" })
  } catch (e: any) {
    console.error("[webhook]", e)
    return c.json({ status: "error", detail: e?.message }, 500)
  }
})

// ─── Paystack Webhook ─────────────────────────────────────────────────────────
app.post("/payments/webhook", async c => {
  const rawBody = await c.req.text()
  const sig     = c.req.header("x-paystack-signature") ?? ""
  const { verifyWebhook } = await import("./services/paystack.ts")
  if (!verifyWebhook(rawBody, sig)) return c.json({ error: "Invalid signature" }, 400)

  const payload = JSON.parse(rawBody) as { event: string; data: Record<string, any> }
  const txData  = payload.data

  if (payload.event === "charge.success") {
    const ref   = txData.reference as string
    const meta  = txData.metadata as Record<string, any>
    const phone = meta?.phone as string
    if (phone) {
      const { setState, getState } = await import("./bot/states.ts")
      const conv = await getState(phone)
      if (conv.state === "AWAIT_PAYMENT") {
        await db.order.updateMany({ where: { orderRef: ref }, data: { status: "paid", paidAt: new Date(), paymentStatus: "confirmed" } })
        const { sendText } = await import("./services/evolution.ts")
        await sendText(phone, `✅ *Payment confirmed!*\n\nOrder: \`${ref}\`\nAmount: ₦${((txData.amount ?? 0) / 100).toLocaleString()}\n\n🔍 Finding your rider...`)
        const { dispatchAllRiders } = await import("./flows/dispatch.ts")
        const d    = conv.data
        const fare = d.fare!
        await setState(phone, "WAITING_RIDER", d)
        await dispatchAllRiders(phone, ref, d, fare, d.pickup!, d.dropoff!, "online", d.senderName ?? "")
      }
    }
  }
  return c.json({ status: "ok" })
})

// ─── GPS — REST ───────────────────────────────────────────────────────────────
app.get("/trackers/live", requireApiKey, async c => {
  // Serve from cache (background poller keeps it warm)
  const cached = cantrack.getAllCached()
  if (cached.length > 0) return c.json({ count: cached.length, trackers: cached })
  // Cold start: do a live fetch
  const locs = await cantrack.fetchAll()
  return c.json({ count: locs.length, trackers: locs })
})

app.get("/location/:deviceId", requireApiKey, async c => {
  const { deviceId } = c.req.param()
  const loc = await cantrack.fetchOne(deviceId)
  if (!loc) return c.json({ error: "No location available", deviceId }, 404)
  return c.json(loc)
})

// ─── GPS — WebSocket (dashboard live map) ─────────────────────────────────────
app.get("/ws/trackers", upgradeWebSocket(c => {
  const key = c.req.query("key") ?? c.req.header("X-API-Key") ?? ""
  return {
    onOpen(evt, ws) {
      if (env.API_KEY && key !== env.API_KEY) {
        ws.close(4401, "Unauthorized")
        return
      }
      wsClients.add(ws as any)
      // Send current cache immediately on connect
      const cached = cantrack.getAllCached()
      if (cached.length > 0) {
        ws.send(JSON.stringify({ type: "trackers", data: cached }))
      }
      console.log(`[ws] Dashboard connected — ${wsClients.size} client(s)`)
    },
    onClose() {
      wsClients.delete(this as any)
      console.log(`[ws] Dashboard disconnected — ${wsClients.size} client(s)`)
    },
    onError(evt, ws) {
      wsClients.delete(ws as any)
    },
  }
}))

// ─── Admin — refresh Cantrack session cookies ─────────────────────────────────
app.post("/admin/cantrack/session", requireApiKey, async c => {
  const { session, seckey, bmap } = await c.req.json() as Record<string, string>
  if (!session) return c.json({ error: "session required" }, 400)
  cantrack.updateCookies(session, seckey, bmap)
  // Trigger an immediate poll to verify
  const locs = await cantrack.fetchAll()
  return c.json({ ok: true, trackersFound: locs.length })
})

// ─── Orders ───────────────────────────────────────────────────────────────────
app.get("/orders/search", requireApiKey, async c => {
  const q      = c.req.query("q") ?? ""
  const limit  = parseInt(c.req.query("limit") ?? "20")
  const orders = await db.order.findMany({
    where: { OR: [
      { orderRef:      { contains: q } },
      { orderNumber:   { contains: q } },
      { senderPhone:   { contains: q } },
      { recipientPhone:{ contains: q } },
    ]},
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 100),
  })
  return c.json({ count: orders.length, orders })
})

app.get("/orders/:ref", requireApiKey, async c => {
  const ref   = c.req.param("ref")
  const order = await db.order.findFirst({
    where: { OR: [{ orderRef: ref }, { orderNumber: ref }] }
  })
  if (!order) return c.json({ error: "Not found" }, 404)
  return c.json(order)
})

// ─── Errands ──────────────────────────────────────────────────────────────────
app.get("/errands/search", requireApiKey, async c => {
  const q       = c.req.query("q") ?? ""
  const errands = await db.errand.findMany({
    where: { OR: [
      { errandRef:    { contains: q } },
      { errandNumber: { contains: q } },
      { clientPhone:  { contains: q } },
    ]},
    orderBy: { createdAt: "desc" },
    take: 20,
  })
  return c.json({ count: errands.length, errands })
})

// ─── Riders ───────────────────────────────────────────────────────────────────
app.get("/riders", requireApiKey, async c => {
  const riders = await db.rider.findMany({ orderBy: { createdAt: "desc" } })
  return c.json({ count: riders.length, riders })
})

app.get("/riders/:phone/balance", requireApiKey, async c => {
  const { phone } = c.req.param()
  const rider     = await db.rider.findUnique({ where: { phone } })
  if (!rider) return c.json({ error: "Rider not found" }, 404)
  const entries = await db.ledgerEntry.findMany({ where: { riderPhone: phone }, orderBy: { createdAt: "desc" }, take: 20 })
  return c.json({ ...rider, recentTrips: entries })
})

// ─── Startup ──────────────────────────────────────────────────────────────────
async function main() {
  // Create all DB tables in Turso if they don't exist
  const { runMigrations } = await import("./utils/migrate.ts")
  await runMigrations()

  // Login to Cantrack then start background polling every 30s
  const loginOk = await cantrack.login()
  if (loginOk) console.log("✅ Cantrack GPS login OK")
  else          console.warn("⚠️  Cantrack login failed — using env session cookie fallback")
  cantrack.startPolling(30_000)

  const port = parseInt(env.PORT)
  console.log(`🚀 Liebe Tag Logistics API v4 running on port ${port}`)
  console.log(`   Riders: ${env.RIDER_PHONES.length} | Admins: ${env.ADMIN_PHONES.length}`)

  return Bun.serve({ fetch: app.fetch, port, websocket })
}

main().catch(console.error)
