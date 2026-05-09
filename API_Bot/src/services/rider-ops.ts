import { randomUUID } from "crypto"
import { db } from "../bot/states.ts"
import { TRACKERS } from "./cantrack.ts"
import { env } from "../utils/env.ts"

type RiderLocationRow = {
  riderPhone: string
  lat: number
  lng: number
  accuracy: number | null
  source: string
  sharedLive: number
  updatedAt: string
}

type AllocationRequestRow = {
  id: string
  riderPhone: string
  riderName: string
  deviceId: string
  deviceLabel: string
  status: string
  requestedAt: string
  reviewedAt: string | null
  reviewedBy: string | null
  note: string
}

export async function ensureRiderRecord(phone: string, name = "") {
  await db.user.upsert({
    where: { phone },
    update: { role: "rider", lastSeen: new Date(), ...(name ? { name } : {}) },
    create: { phone, name, role: "rider" },
  }).catch(() => {})

  return db.rider.upsert({
    where: { phone },
    update: { ...(name ? { name } : {}) },
    create: { phone, name, isActive: false },
  })
}

export async function setRiderOnline(phone: string) {
  const rider = await ensureRiderRecord(phone)
  await db.rider.update({ where: { phone }, data: { isActive: true } })
  return rider
}

export async function setRiderOffline(phone: string) {
  const rider = await ensureRiderRecord(phone)
  await db.rider.update({ where: { phone }, data: { isActive: false } })
  return rider
}

export async function saveRiderPhoneLocation(
  phone: string,
  lat: number,
  lng: number,
  sharedLive = false,
  accuracy?: number,
) {
  await ensureRiderRecord(phone)
  await db.rider.update({ where: { phone }, data: { isActive: true } })
  await db.$executeRawUnsafe(
    `INSERT INTO rider_locations
      (riderPhone, lat, lng, accuracy, source, sharedLive, updatedAt)
     VALUES (?, ?, ?, ?, 'whatsapp', ?, CURRENT_TIMESTAMP)
     ON CONFLICT(riderPhone) DO UPDATE SET
      lat=excluded.lat,
      lng=excluded.lng,
      accuracy=excluded.accuracy,
      source=excluded.source,
      sharedLive=excluded.sharedLive,
      updatedAt=CURRENT_TIMESTAMP`,
    phone,
    lat,
    lng,
    accuracy ?? null,
    sharedLive ? 1 : 0,
  )
}

export async function getRiderPhoneLocation(phone: string) {
  const rows = await db.$queryRawUnsafe<RiderLocationRow[]>(
    `SELECT * FROM rider_locations WHERE riderPhone = ? LIMIT 1`,
    phone,
  )
  const row = rows[0]
  if (!row) return null
  return {
    riderPhone: row.riderPhone,
    latitude: Number(row.lat),
    longitude: Number(row.lng),
    accuracy: row.accuracy === null ? null : Number(row.accuracy),
    source: row.source,
    sharedLive: Boolean(row.sharedLive),
    updatedAt: row.updatedAt,
  }
}

export async function createAllocationRequest(phone: string, deviceId: string, riderName = "") {
  await ensureRiderRecord(phone, riderName)
  const tracker = TRACKERS[deviceId]
  const id = randomUUID()
  await db.$executeRawUnsafe(
    `INSERT INTO bike_allocation_requests
      (id, riderPhone, riderName, deviceId, deviceLabel, status, requestedAt, note)
     VALUES (?, ?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP, '')`,
    id,
    phone,
    riderName,
    deviceId,
    tracker?.label ?? deviceId.slice(0, 12),
  )
  return id
}

export async function listAllocationRequests(status = "") {
  const where = status ? `WHERE status = ?` : ""
  const args = status ? [status] : []
  return db.$queryRawUnsafe<AllocationRequestRow[]>(
    `SELECT * FROM bike_allocation_requests ${where} ORDER BY requestedAt DESC`,
    ...args,
  )
}

export async function approveAllocationRequest(id: string, reviewedBy = "") {
  const rows = await db.$queryRawUnsafe<AllocationRequestRow[]>(
    `SELECT * FROM bike_allocation_requests WHERE id = ? LIMIT 1`,
    id,
  )
  const req = rows[0]
  if (!req) return null
  if (req.status !== "pending") return req

  await ensureRiderRecord(req.riderPhone, req.riderName)
  await db.rider.update({
    where: { phone: req.riderPhone },
    data: { deviceId: req.deviceId, name: req.riderName || undefined, isActive: true },
  })
  await db.user.update({
    where: { phone: req.riderPhone },
    data: { role: "rider", ...(req.riderName ? { name: req.riderName } : {}) },
  }).catch(() => {})
  await db.$executeRawUnsafe(
    `UPDATE bike_allocation_requests
     SET status='approved', reviewedAt=CURRENT_TIMESTAMP, reviewedBy=?
     WHERE id = ?`,
    reviewedBy,
    id,
  )
  return { ...req, status: "approved" }
}

export async function rejectAllocationRequest(id: string, reviewedBy = "", note = "") {
  await db.$executeRawUnsafe(
    `UPDATE bike_allocation_requests
     SET status='rejected', reviewedAt=CURRENT_TIMESTAMP, reviewedBy=?, note=?
     WHERE id = ?`,
    reviewedBy,
    note,
    id,
  )
}

export async function unassignBike(phone: string) {
  await ensureRiderRecord(phone)
  await db.rider.update({ where: { phone }, data: { deviceId: "", isActive: false } })
}

export async function listDispatchRiderPhones() {
  const rows = await db.rider.findMany({
    where: { isActive: true },
    select: { phone: true },
    orderBy: { createdAt: "asc" },
  })
  const phones = new Set<string>(rows.map(r => r.phone))
  for (const phone of env.RIDER_PHONES) {
    const rider = await db.rider.findUnique({ where: { phone }, select: { isActive: true } }).catch(() => null)
    if (!rider) phones.add(phone)
    else if (rider.isActive) phones.add(phone)
  }
  return [...phones]
}

export async function isKnownRider(phone: string) {
  if (env.RIDER_PHONES.includes(phone)) return true
  const rider = await db.rider.findUnique({ where: { phone }, select: { phone: true } })
  return Boolean(rider)
}
