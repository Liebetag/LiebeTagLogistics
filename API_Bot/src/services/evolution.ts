// src/services/evolution.ts
// EvolutionAPI v2 — WhatsApp message sending

import { env } from "../utils/env.ts"

const BASE = env.EVOLUTION_URL
const KEY  = env.EVOLUTION_KEY
const INST = env.EVOLUTION_INST

const headers = () => ({
  "Content-Type": "application/json",
  "apikey": KEY,
})

async function post(path: string, body: unknown) {
  try {
    const r = await fetch(`${BASE}${path}`, {
      method:  "POST",
      headers: headers(),
      body:    JSON.stringify(body),
    })
    if (!r.ok) {
      console.error(`[evolution] ${path} → ${r.status}:`, await r.text().catch(() => ""))
    }
    return r.ok
  } catch (e) {
    console.error(`[evolution] ${path} error:`, e)
    return false
  }
}

export async function sendText(phone: string, text: string) {
  return post(`/message/sendText/${INST}`, { number: phone, text })
}

export async function sendLocation(
  phone: string, lat: number, lng: number,
  name = "Location", address = ""
) {
  return post(`/message/sendLocation/${INST}`, {
    number: phone,
    name, address,
    latitude:  lat,
    longitude: lng,
  })
}

export async function sendDocument(
  phone: string, url: string, filename: string, caption = ""
) {
  return post(`/message/sendMedia/${INST}`, {
    number:   phone,
    mediatype: "document",
    media:    url,
    fileName: filename,
    caption,
  })
}

export async function sendImage(
  phone: string, url: string, caption = ""
) {
  return post(`/message/sendMedia/${INST}`, {
    number:    phone,
    mediatype: "image",
    media:     url,
    caption,
  })
}

export async function getMediaBase64(messageId: string): Promise<Buffer | null> {
  try {
    const r = await fetch(
      `${BASE}/chat/getBase64FromMediaMessage/${INST}`,
      {
        method:  "POST",
        headers: headers(),
        body: JSON.stringify({
          message: { key: { id: messageId } },
          convertToMp4: false,
        }),
      }
    )
    if (!r.ok) return null
    const data = await r.json() as { base64?: string }
    if (data.base64) return Buffer.from(data.base64, "base64")
    return null
  } catch {
    return null
  }
}
