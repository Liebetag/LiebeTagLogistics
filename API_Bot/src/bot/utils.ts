// src/bot/utils.ts
// Shared bot helpers

import { sendText } from "../services/evolution.ts"
import { getUserName } from "./states.ts"
import { env } from "../utils/env.ts"

export function genTrackingRef(): string {
  return `LT-WA${crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`
}

export function genOrderNumber(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "")
  const rand = Math.floor(Math.random() * 90000000) + 10000000
  return `${date}${rand}`
}

export function genErrandRef(): string {
  return `ER-WA${crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`
}

export function genDeliveryCode(): string {
  return String(Math.floor(Math.random() * 9000) + 1000)
}

export function gmapsLink(lat: number, lng: number, label = ""): string {
  const l = label ? `&label=${encodeURIComponent(label)}` : ""
  return `https://maps.google.com/?q=${lat},${lng}${l}`
}

export function backHint(): string {
  return "_Type_ *back* _to correct the previous step · *cancel* to start over_"
}

export function deliveryQuote(): string {
  const quotes = [
    "🌟 _Every delivery is a promise kept._",
    "🚀 _Speed is our promise, care is our standard._",
    "💛 _Connecting people, one delivery at a time._",
    "🏍️ _Your trust drives us forward._",
    "🙏 _We don't just deliver packages — we deliver reliability._",
    "✨ _Fast today, faster tomorrow._",
    "💪 _Built on Abuja roads, trusted by Abuja people._",
    "🤝 _Because your packages matter to us as much as they do to you._",
  ]
  return quotes[Math.floor(Math.random() * quotes.length)]!
}

export async function notifyAdmin(msg: string) {
  for (const phone of env.ADMIN_PHONES) {
    await sendText(phone, `🔔 *ADMIN*\n\n${msg}`)
  }
}

export async function sendMenu(phone: string, name = "") {
  const displayName = name || await getUserName(phone)
  const greeting    = displayName ? `👋 *Hi ${displayName}!*\n\n` : "👋 *Welcome to Liebe Tag Logistics!* 🏍️\n\n"

  await sendText(phone,
    `${greeting}` +
    `Fast, reliable delivery and errands across Abuja 🏍️\n\n` +
    `1. 📦 New Delivery\n` +
    `2. 🏃 Book an Errand\n` +
    `3. 🔍 Track an order\n` +
    `4. 💰 Get a price quote\n` +
    `5. ❓ FAQ & Support\n\n` +
    `_Reply 1–5_\n` +
    `_Type_ *back* _at any step to correct a mistake_\n` +
    `_Type_ *cancel* _to start over_`
  )
}

export const ITEM_LIST_MSG = `*What are you sending?*\nSelect all that apply — separate with commas.\n\n` +
  `1. Documents\n2. Electronics\n3. Clothing\n4. Food\n5. Medicine\n6. Household items\n7. Other\n\n` +
  `_Example: reply_ *1, 3* _for Documents and Clothing_\n_Or type the name e.g._ *electronics*`

export const WEIGHT_LIST = `*How heavy is your {item}?*\n\n` +
  `1. Under 1 kg\n2. 1–2 kg\n3. 2–5 kg\n4. 5–10 kg\n5. Over 10 kg\n\n` +
  `_Or type the weight e.g._ *2* _or_ *2kg* _or_ *1.5*`

export const ITEMS: Record<string, string> = {
  "1": "Documents", "2": "Electronics", "3": "Clothing",
  "4": "Food", "5": "Medicine", "6": "Household items", "7": "Other",
  "documents": "Documents", "electronics": "Electronics",
  "clothing": "Clothing", "food": "Food", "medicine": "Medicine",
  "household": "Household items", "other": "Other",
}

export const NEEDS_NAME = new Set(["Electronics", "Household items", "Other"])

export function parseItems(text: string): string[] {
  const lower  = text.toLowerCase().trim()
  const nums   = lower.split(/[,\s]+/).map(p => p.trim()).filter(Boolean)
  const result = new Set<string>()

  for (const n of nums) {
    if (ITEMS[n]) result.add(ITEMS[n]!)
  }
  if (result.size) return [...result]

  // Text match
  for (const [key, val] of Object.entries(ITEMS)) {
    if (!/^\d+$/.test(key) && lower.includes(key)) result.add(val)
  }
  return [...result]
}

export function parseWeight(text: string): number | null {
  const t = text.trim().toLowerCase()

  // Named options
  const optMap: Record<string, number> = { "w_0": 0.5, "w_1": 1.5, "w_3": 3.5, "w_7": 7.5, "w_15": 12 }
  if (optMap[t] !== undefined) return optMap[t]!

  // Explicit kg value: 2kg, 2.5kg, 1.5
  const kgMatch = t.match(/^(\d+(?:\.\d+)?)\s*kg?$/)
  if (kgMatch) return parseFloat(kgMatch[1]!)

  // Decimal without unit
  const decMatch = t.match(/^(\d+\.\d+)$/)
  if (decMatch) return parseFloat(decMatch[1]!)

  // List selection 1-5 (no unit)
  const listMap: Record<string, number> = { "1": 0.5, "2": 1.5, "3": 3.5, "4": 7.5, "5": 12 }
  if (t in listMap) return listMap[t]!

  return null
}
