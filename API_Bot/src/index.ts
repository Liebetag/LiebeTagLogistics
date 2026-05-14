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
import { checkProximityNotifications } from "./services/proximity.ts"
import { renderTrackingPage } from "./utils/tracking-page.ts"
import {
  approveAllocationRequest,
  getRiderPhoneLocation,
  listAllocationRequests,
  rejectAllocationRequest,
  unassignBike,
} from "./services/rider-ops.ts"
import { requestPortalOtp, verifyPortalOtp, verifyPortalToken } from "./services/portal-auth.ts"
import { createAdmin, ensureSuperAdmin, listAdmins, loginAdmin, verifyAdminToken } from "./services/admin-auth.ts"
import type { GPSLocation } from "./types/index.ts"

const app = new Hono()

// ─── WebSocket setup ──────────────────────────────────────────────────────────
const { upgradeWebSocket, websocket } = createBunWebSocket()
const wsClients = new Set<{ send: (data: string) => void }>()

// Register cantrack broadcast → WebSocket push + proximity notifications
registerBroadcast((locations: GPSLocation[]) => {
  // Push to dashboard WebSocket clients
  if (wsClients.size > 0) {
    const msg = JSON.stringify({ type: "trackers", data: locations })
    for (const client of wsClients) {
      try { client.send(msg) } catch {}
    }
  }
  // Proximity alerts (fire-and-forget)
  checkProximityNotifications(locations).catch(e => console.error("[proximity]", e))
})

// ─── CORS ─────────────────────────────────────────────────────────────────────
app.use("*", cors({
  origin: env.ALLOWED_ORIGINS === "*" ? "*" : env.ALLOWED_ORIGINS.split(","),
  allowMethods: ["GET","POST","PUT","DELETE","OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization", "X-API-Key", "X-Admin-Phone"],
}))

// ─── Auth middleware ───────────────────────────────────────────────────────────
const requireApiKey = async (c: any, next: Function) => {
  const key = c.req.header("X-API-Key") || c.req.header("Authorization")?.replace("Bearer ","")
  if (!env.API_KEY || key === env.API_KEY) return next()
  return c.json({ error: "Unauthorized" }, 401)
}

const requireAdminAuth = async (c: any, next: Function) => {
  const token = c.req.header("Authorization")?.replace("Bearer ", "") ?? ""
  const admin = await verifyAdminToken(token)
  if (admin) {
    ;(c as any).admin = admin
    return next()
  }

  const key = c.req.header("X-API-Key")
  if (env.API_KEY && key === env.API_KEY) {
    ;(c as any).admin = { id: "api-key", phone: "", name: "API Key", role: "super_admin", permissions: { all: true } }
    return next()
  }

  return c.json({ error: "Unauthorized" }, 401)
}

const requireSuperAdmin = async (c: any, next: Function) => {
  const admin = (c as any).admin
  if (admin?.role === "super_admin" || admin?.permissions?.all) return next()
  return c.json({ error: "Super admin access required" }, 403)
}

const requirePortalAuth = async (c: any, next: Function) => {
  const token = c.req.header("Authorization")?.replace("Bearer ", "") ?? ""
  const phone = verifyPortalToken(token)
  if (!phone) return c.json({ error: "Unauthorized" }, 401)
  ;(c as any).portalPhone = phone
  return next()
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
    gpsLive:        cached.filter(t => t.status !== "offline").length,
    gpsPolling:     cantrack.isPolling(),
    gpsLastOk:      cantrack.lastPollSuccess(),
  })
})

app.post("/portal/auth/request-otp", async c => {
  try {
    const body = await c.req.json() as { phone?: string }
    const phone = await requestPortalOtp(body.phone ?? "")
    return c.json({ ok: true, phone })
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message ?? "Could not send OTP" }, 400)
  }
})

app.post("/portal/auth/verify-otp", async c => {
  try {
    const body = await c.req.json() as { phone?: string; code?: string }
    const token = await verifyPortalOtp(body.phone ?? "", body.code ?? "")
    return c.json({ ok: true, token })
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message ?? "Could not verify OTP" }, 400)
  }
})

app.get("/portal/me", requirePortalAuth, async c => {
  const phone = (c as any).portalPhone as string
  const [user, orders, errands] = await Promise.all([
    db.user.findUnique({ where: { phone } }),
    db.order.findMany({
      where: { OR: [{ senderPhone: phone }, { recipientPhone: phone }] },
      orderBy: { createdAt: "desc" },
      take: 25,
    }),
    db.errand.findMany({
      where: { clientPhone: phone },
      orderBy: { createdAt: "desc" },
      take: 25,
    }),
  ])
  return c.json({ user, orders, errands })
})

app.post("/portal/chat", requirePortalAuth, async c => {
  const phone = (c as any).portalPhone as string
  const body = await c.req.json() as { message?: string; location?: { lat: number; lng: number; address?: string } }
  const message = String(body.message ?? "").trim()
  if (!message) return c.json({ ok: false, error: "message required" }, 400)
  await handleMessage(phone, message, body.location as any)
  const conv = await db.conversation.findUnique({ where: { phone } })
  return c.json({ ok: true, state: conv?.state ?? "IDLE" })
})

app.post("/admin/auth/login", async c => {
  try {
    const body = await c.req.json() as { phone?: string; password?: string }
    const result = await loginAdmin(body.phone ?? "", body.password ?? "")
    return c.json({ ok: true, ...result })
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message ?? "Could not sign in" }, 401)
  }
})

app.get("/admin/me", requireAdminAuth, async c => {
  await ensureSuperAdmin()
  return c.json({ admin: (c as any).admin })
})

app.get("/admin/users", requireAdminAuth, requireSuperAdmin, async c => {
  return c.json({ admins: await listAdmins() })
})

app.post("/admin/users", requireAdminAuth, requireSuperAdmin, async c => {
  try {
    const body = await c.req.json() as { phone?: string; name?: string; password?: string; role?: any; permissions?: Record<string, boolean> }
    const admin = (c as any).admin
    const created = await createAdmin({
      phone: body.phone ?? "",
      name: body.name ?? "",
      password: body.password ?? "",
      role: body.role ?? "operations",
      permissions: body.permissions ?? {},
      createdBy: admin.phone || admin.id,
    })
    return c.json({ ok: true, admin: created })
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message ?? "Could not create admin" }, 400)
  }
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
app.get("/trackers/live", requireAdminAuth, async c => {
  // Serve from cache (background poller keeps it warm)
  const cached = cantrack.getAllCached()
  if (cached.length > 0) return c.json({ count: cached.length, trackers: cached })
  // Cold start: do a live fetch
  const locs = await cantrack.fetchAll()
  return c.json({ count: locs.length, trackers: locs })
})

app.get("/location/:deviceId", requireAdminAuth, async c => {
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
app.post("/admin/cantrack/session", requireAdminAuth, async c => {
  const { session, seckey, bmap } = await c.req.json() as Record<string, string>
  if (!session) return c.json({ error: "session required" }, 400)
  cantrack.updateCookies(session, seckey, bmap)
  // Trigger an immediate poll to verify
  const locs = await cantrack.fetchAll()
  return c.json({ ok: true, trackersFound: locs.length })
})

app.get("/admin/overview", requireAdminAuth, async c => {
  const [orders, errands, riders, customers, allocationRequests] = await Promise.all([
    db.order.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
    db.errand.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
    db.rider.findMany({ orderBy: { createdAt: "desc" } }),
    db.user.findMany({ where: { role: "customer" }, orderBy: { lastSeen: "desc" }, take: 50 }),
    listAllocationRequests("pending"),
  ])
  const trackers = cantrack.getAllCached().length ? cantrack.getAllCached() : await cantrack.fetchAll()
  const bikes = Object.entries(TRACKERS).map(([deviceId, meta]) => {
    const rider = riders.find(r => r.deviceId === deviceId)
    const tracker = trackers.find(t => t.deviceId === deviceId)
    return { deviceId, ...meta, riderPhone: rider?.phone ?? "", riderName: rider?.name ?? "", tracker }
  })
  return c.json({ orders, errands, riders, customers, allocationRequests, bikes })
})

app.get("/admin/allocation-requests", requireAdminAuth, async c => {
  const status = c.req.query("status") ?? ""
  const requests = await listAllocationRequests(status)
  return c.json({ count: requests.length, requests })
})

app.post("/admin/allocation-requests/:id/approve", requireAdminAuth, async c => {
  const id = c.req.param("id")
  const reviewedBy = c.req.header("X-Admin-Phone") ?? "admin"
  const result = await approveAllocationRequest(id, reviewedBy)
  if (!result) return c.json({ error: "Allocation request not found" }, 404)
  return c.json({ ok: true, request: result })
})

app.post("/admin/allocation-requests/:id/reject", requireAdminAuth, async c => {
  const id = c.req.param("id")
  const body = await c.req.json().catch(() => ({})) as { note?: string }
  const reviewedBy = c.req.header("X-Admin-Phone") ?? "admin"
  await rejectAllocationRequest(id, reviewedBy, body.note ?? "")
  return c.json({ ok: true })
})

// ─── Orders ───────────────────────────────────────────────────────────────────
app.get("/orders/search", requireAdminAuth, async c => {
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

app.get("/orders/:ref", requireAdminAuth, async c => {
  const ref   = c.req.param("ref")
  const order = await db.order.findFirst({
    where: { OR: [{ orderRef: ref }, { orderNumber: ref }] }
  })
  if (!order) return c.json({ error: "Not found" }, 404)
  return c.json(order)
})

app.get("/customers/search", requireAdminAuth, async c => {
  const q = c.req.query("q") ?? ""
  const customers = await db.user.findMany({
    where: {
      role: "customer",
      OR: [
        { phone: { contains: q } },
        { name: { contains: q } },
      ],
    },
    orderBy: { lastSeen: "desc" },
    take: 100,
  })
  return c.json({ count: customers.length, customers })
})

// ─── Errands ──────────────────────────────────────────────────────────────────
app.get("/errands/search", requireAdminAuth, async c => {
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
app.get("/riders", requireAdminAuth, async c => {
  const riders = await db.rider.findMany({ orderBy: { createdAt: "desc" } })
  return c.json({ count: riders.length, riders })
})

app.get("/riders/:phone/balance", requireAdminAuth, async c => {
  const { phone } = c.req.param()
  const rider     = await db.rider.findUnique({ where: { phone } })
  if (!rider) return c.json({ error: "Rider not found" }, 404)
  const entries = await db.ledgerEntry.findMany({ where: { riderPhone: phone }, orderBy: { createdAt: "desc" }, take: 20 })
  return c.json({ ...rider, recentTrips: entries })
})

app.post("/riders/:phone/unassign-bike", requireAdminAuth, async c => {
  const { phone } = c.req.param()
  await unassignBike(phone)
  return c.json({ ok: true })
})

// ─── Public tracking page ─────────────────────────────────────────────────────
app.get("/track/:ref", async c => {
  const ref = c.req.param("ref").toUpperCase()

  // Try order first, then errand
  const order  = await db.order.findFirst({
    where: { OR: [{ orderRef: ref }, { orderNumber: ref }] },
  })
  const errand = !order ? await db.errand.findFirst({
    where: { OR: [{ errandRef: ref }, { errandNumber: ref }] },
  }) : null

  const record = order ?? errand
  if (!record) {
    return c.html(`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width">
      <title>Not Found</title>
      <style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;background:#f1f5f9}</style>
      </head><body><div><h2>❓ Order not found</h2><p style="color:#64748b;margin-top:8px">Check the tracking number and try again.</p>
      <p style="margin-top:16px;font-size:13px;color:#94a3b8">Liebe Tag Logistics</p></div></body></html>`, 404)
  }

  // Inject live GPS if rider device is known
  let riderLat: number | undefined, riderLng: number | undefined, riderSpeed: number | undefined
  const riderPhone = (record as any).riderPhone
  if (riderPhone) {
    const rider = await db.rider.findUnique({ where: { phone: riderPhone }, select: { deviceId: true } })
    if (rider?.deviceId) {
      const gps = cantrack.getCache(rider.deviceId)
      if (gps && gps.latitude !== null && gps.longitude !== null) {
        riderLat   = gps.latitude
        riderLng   = gps.longitude
        riderSpeed = gps.speedKmh
      }
    }
    if (riderLat === undefined || riderLng === undefined) {
      const phoneGps = await getRiderPhoneLocation(riderPhone)
      if (phoneGps) {
        riderLat = phoneGps.latitude
        riderLng = phoneGps.longitude
        riderSpeed = 0
      }
    }
  }

  const html = renderTrackingPage({ ...(record as any), riderLat, riderLng, riderSpeed })
  return c.html(html)
})

// ─── Pickup photo endpoint ─────────────────────────────────────────────────────
app.get("/order/:ref/photo", async c => {
  const ref = c.req.param("ref").toUpperCase()
  const order = await db.order.findFirst({
    where: { OR: [{ orderRef: ref }, { orderNumber: ref }] },
    select: { pickupPhotoId: true },
  })
  if (!order?.pickupPhotoId) return c.text("No photo available", 404)

  const buf = await getMediaBase64(order.pickupPhotoId)
  if (!buf) return c.text("Photo unavailable", 503)

  c.header("Content-Type", "image/jpeg")
  c.header("Content-Disposition", `inline; filename="${ref}-pickup-photo.jpg"`)
  c.header("Cache-Control", "public, max-age=86400")
  return c.body(buf as unknown as ReadableStream)
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
