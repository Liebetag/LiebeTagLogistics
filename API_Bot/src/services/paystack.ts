// src/services/paystack.ts
import { createHmac } from "node:crypto"
import { env } from "../utils/env.ts"

const BASE    = "https://api.paystack.co"
const headers = () => ({
  "Authorization": `Bearer ${env.PAYSTACK_SECRET}`,
  "Content-Type":  "application/json",
})

export async function createPaymentLink(
  email: string, amountNaira: number, reference: string,
  metadata: Record<string, unknown> = {},
  callbackUrl = ""
): Promise<{ paymentUrl: string; reference: string } | null> {
  try {
    const r = await fetch(`${BASE}/transaction/initialize`, {
      method:  "POST",
      headers: headers(),
      body: JSON.stringify({
        email,
        amount:    amountNaira * 100,  // kobo
        reference,
        metadata,
        callback_url: callbackUrl || `${env.APP_URL}/payments/verify/${reference}`,
      }),
    })
    const d = await r.json() as { status: boolean; data?: { authorization_url: string } }
    if (d.status && d.data) return { paymentUrl: d.data.authorization_url, reference }
    return null
  } catch { return null }
}

export async function verifyTransaction(reference: string) {
  try {
    const r = await fetch(`${BASE}/transaction/verify/${reference}`, { headers: headers() })
    return r.json() as Promise<{ status: boolean; data?: { status: string; metadata?: Record<string, unknown> } }>
  } catch { return null }
}

export function verifyWebhook(payload: string, signature: string): boolean {
  const expected = createHmac("sha512", env.PAYSTACK_SECRET)
    .update(payload)
    .digest("hex")
  return expected === signature
}

export async function createTransferRecipient(
  name: string, accountNumber: string, bankCode: string
) {
  try {
    const r = await fetch(`${BASE}/transferrecipient`, {
      method: "POST", headers: headers(),
      body: JSON.stringify({ type: "nuban", name, account_number: accountNumber, bank_code: bankCode, currency: "NGN" }),
    })
    const d = await r.json() as { status: boolean; data?: { recipient_code: string } }
    return d.status ? d.data?.recipient_code : null
  } catch { return null }
}

export async function initiateTransfer(amount: number, recipientCode: string, reason: string) {
  try {
    const r = await fetch(`${BASE}/transfer`, {
      method: "POST", headers: headers(),
      body: JSON.stringify({ source: "balance", amount: amount * 100, recipient: recipientCode, reason }),
    })
    return r.json()
  } catch { return null }
}
