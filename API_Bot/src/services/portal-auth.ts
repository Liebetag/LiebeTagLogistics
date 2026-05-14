import { createHmac, randomInt, timingSafeEqual } from "crypto"
import { db } from "../bot/states.ts"
import { sendText } from "./evolution.ts"
import { env } from "../utils/env.ts"

const OTP_TTL_MS = 10 * 60 * 1000
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000

function base64url(input: string) {
  return Buffer.from(input).toString("base64url")
}

function sign(value: string) {
  return createHmac("sha256", env.JWT_SECRET).update(value).digest("base64url")
}

export function normalizePortalPhone(input: string) {
  let phone = String(input || "").replace(/\D/g, "")
  if (phone.startsWith("0")) phone = `234${phone.slice(1)}`
  if (phone.length === 10) phone = `234${phone}`
  return phone
}

export async function requestPortalOtp(rawPhone: string) {
  const phone = normalizePortalPhone(rawPhone)
  if (!/^234\d{10}$/.test(phone)) {
    throw new Error("Enter a valid Nigerian WhatsApp number.")
  }

  const code = String(randomInt(100000, 999999))
  const codeHash = sign(`${phone}:${code}`)
  const expiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString()

  await db.$executeRawUnsafe(
    `INSERT INTO portal_otps (phone, codeHash, expiresAt, consumed, createdAt)
     VALUES (?, ?, ?, 0, CURRENT_TIMESTAMP)
     ON CONFLICT(phone) DO UPDATE SET
      codeHash=excluded.codeHash,
      expiresAt=excluded.expiresAt,
      consumed=0,
      createdAt=CURRENT_TIMESTAMP`,
    phone,
    codeHash,
    expiresAt,
  )

  await db.user.upsert({
    where: { phone },
    update: { lastSeen: new Date() },
    create: { phone, role: "customer" },
  }).catch(() => {})

  const sent = await sendText(phone, `Your Liebe Tag web login code is *${code}*.\n\nIt expires in 10 minutes.`)
  if (!sent) {
    throw new Error("Could not send WhatsApp code. Check the WhatsApp service connection and try again.")
  }
  return phone
}

export async function verifyPortalOtp(rawPhone: string, rawCode: string) {
  const phone = normalizePortalPhone(rawPhone)
  const code = String(rawCode || "").replace(/\D/g, "")
  const rows = await db.$queryRawUnsafe<Array<{ codeHash: string; expiresAt: string; consumed: number }>>(
    `SELECT codeHash, expiresAt, consumed FROM portal_otps WHERE phone = ? LIMIT 1`,
    phone,
  )
  const row = rows[0]
  if (!row || row.consumed || Date.parse(row.expiresAt) < Date.now()) {
    throw new Error("Code expired. Request a new WhatsApp code.")
  }

  const expected = Buffer.from(row.codeHash)
  const actual = Buffer.from(sign(`${phone}:${code}`))
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new Error("Incorrect code.")
  }

  await db.$executeRawUnsafe(
    `UPDATE portal_otps SET consumed = 1 WHERE phone = ?`,
    phone,
  )

  return createPortalToken(phone)
}

export function createPortalToken(phone: string) {
  const payload = base64url(JSON.stringify({ phone, exp: Date.now() + TOKEN_TTL_MS }))
  return `${payload}.${sign(payload)}`
}

export function verifyPortalToken(token: string) {
  const [payload, signature] = String(token || "").split(".")
  if (!payload || !signature || sign(payload) !== signature) return null
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { phone?: string; exp?: number }
    if (!data.phone || !data.exp || data.exp < Date.now()) return null
    return data.phone
  } catch {
    return null
  }
}
