import { createHmac, randomBytes, randomUUID, timingSafeEqual, pbkdf2Sync } from "crypto"
import { db } from "../bot/states.ts"
import { env } from "../utils/env.ts"
import { normalizePortalPhone } from "./portal-auth.ts"

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000
const ITERATIONS = 120_000

export type AdminUser = {
  id: string
  phone: string
  name: string
  role: "super_admin" | "admin" | "operations" | "viewer"
  permissions: Record<string, boolean>
  status: "active" | "disabled"
  createdAt: string
  createdBy: string
  lastLoginAt?: string | null
}

function sign(value: string) {
  return createHmac("sha256", env.JWT_SECRET).update(value).digest("base64url")
}

function hashPassword(password: string, salt = randomBytes(16).toString("base64url")) {
  const hash = pbkdf2Sync(password, salt, ITERATIONS, 32, "sha256").toString("base64url")
  return `${ITERATIONS}:${salt}:${hash}`
}

function verifyPassword(password: string, stored: string) {
  const [iterations, salt, hash] = stored.split(":")
  if (!iterations || !salt || !hash) return false
  const actual = pbkdf2Sync(password, salt, Number(iterations), 32, "sha256").toString("base64url")
  const expected = Buffer.from(hash)
  const candidate = Buffer.from(actual)
  return expected.length === candidate.length && timingSafeEqual(expected, candidate)
}

function createToken(admin: AdminUser) {
  const payload = Buffer.from(JSON.stringify({
    sub: admin.id,
    phone: admin.phone,
    role: admin.role,
    exp: Date.now() + TOKEN_TTL_MS,
  })).toString("base64url")
  return `${payload}.${sign(payload)}`
}

function parseAdmin(row: any): AdminUser {
  return {
    id: row.id,
    phone: row.phone,
    name: row.name,
    role: row.role,
    permissions: JSON.parse(row.permissions || "{}"),
    status: row.status,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    lastLoginAt: row.lastLoginAt,
  }
}

async function findAdminByPhone(phone: string) {
  const rows = await db.$queryRawUnsafe<any[]>(
    `SELECT * FROM admin_users WHERE phone = ? LIMIT 1`,
    phone,
  )
  return rows[0] ?? null
}

async function findAdminById(id: string) {
  const rows = await db.$queryRawUnsafe<any[]>(
    `SELECT * FROM admin_users WHERE id = ? LIMIT 1`,
    id,
  )
  return rows[0] ?? null
}

export async function ensureSuperAdmin() {
  if (!env.SUPER_ADMIN_PHONE || !env.SUPER_ADMIN_PASSWORD) return null
  const phone = normalizePortalPhone(env.SUPER_ADMIN_PHONE)
  const existing = await findAdminByPhone(phone)
  if (existing) return parseAdmin(existing)

  const id = randomUUID()
  await db.$executeRawUnsafe(
    `INSERT INTO admin_users (id, phone, name, role, passwordHash, permissions, status, createdBy)
     VALUES (?, ?, ?, 'super_admin', ?, ?, 'active', 'system')`,
    id,
    phone,
    env.SUPER_ADMIN_NAME,
    hashPassword(env.SUPER_ADMIN_PASSWORD),
    JSON.stringify({ all: true }),
  )
  return parseAdmin(await findAdminById(id))
}

export async function loginAdmin(rawPhone: string, password: string) {
  const phone = normalizePortalPhone(rawPhone)
  await ensureSuperAdmin()
  const row = await findAdminByPhone(phone)
  if (!row || row.status !== "active" || !verifyPassword(password, row.passwordHash)) {
    throw new Error("Invalid admin phone or password.")
  }
  await db.$executeRawUnsafe(`UPDATE admin_users SET lastLoginAt = CURRENT_TIMESTAMP WHERE id = ?`, row.id)
  const admin = parseAdmin({ ...row, lastLoginAt: new Date().toISOString() })
  return { token: createToken(admin), admin }
}

export async function verifyAdminToken(token: string) {
  const [payload, signature] = String(token || "").split(".")
  if (!payload || !signature || sign(payload) !== signature) return null
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub?: string; exp?: number }
    if (!data.sub || !data.exp || data.exp < Date.now()) return null
    const row = await findAdminById(data.sub)
    if (!row || row.status !== "active") return null
    return parseAdmin(row)
  } catch {
    return null
  }
}

export async function listAdmins() {
  await ensureSuperAdmin()
  const rows = await db.$queryRawUnsafe<any[]>(
    `SELECT id, phone, name, role, permissions, status, createdAt, createdBy, lastLoginAt
     FROM admin_users ORDER BY createdAt DESC`,
  )
  return rows.map(parseAdmin)
}

export async function createAdmin(input: {
  phone: string
  name: string
  password: string
  role: AdminUser["role"]
  permissions: Record<string, boolean>
  createdBy: string
}) {
  const phone = normalizePortalPhone(input.phone)
  if (!/^234\d{10}$/.test(phone)) throw new Error("Enter a valid Nigerian WhatsApp number.")
  if (input.password.length < 8) throw new Error("Password must be at least 8 characters.")
  if (input.role === "super_admin") throw new Error("Create super admins from environment settings only.")

  const id = randomUUID()
  await db.$executeRawUnsafe(
    `INSERT INTO admin_users (id, phone, name, role, passwordHash, permissions, status, createdBy)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`,
    id,
    phone,
    input.name.trim(),
    input.role,
    hashPassword(input.password),
    JSON.stringify(input.permissions ?? {}),
    input.createdBy,
  )
  return parseAdmin(await findAdminById(id))
}
