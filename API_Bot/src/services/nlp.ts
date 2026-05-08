// src/services/nlp.ts
// Claude-powered NLP for smart conversation

import Anthropic from "@anthropic-ai/sdk"
import { env } from "../utils/env.ts"

const client = env.ANTHROPIC_KEY ? new Anthropic({ apiKey: env.ANTHROPIC_KEY }) : null

const SYSTEM = `You are a smart WhatsApp assistant for LIEBE TAG LOGISTICS, a fast delivery and errand service in Abuja, Nigeria.

Company info:
- Services: Bike delivery + errand runners across Abuja FCT and nearby areas
- Delivery areas: All FCT LGAs (Wuse, Garki, Maitama, Gwarinpa, Kubwa, Gwagwalada, Kuje, Kwali, Bwari, Abaji, Asokoro, Jabi) + Suleja, Maraba, Nyanya, Karu
- Delivery pricing: Base ₦2,000 (first 10km), ₦200/km after. Priority +₦1,500. Fragile +₦500.
- Errand pricing: Base ₦1,500 (first 5km / 30 mins). Rush (within 1hr) +₦1,000.
- Hours: Mon-Sat 8am-8pm WAT
- Support: +234 811 870 7226 | info@liebetag.com

When user sends a GREETING (hi, hello, good morning, good evening, etc) WITHOUT a delivery request:
- Respond warmly by name, ask what they'd like
- Keep to 1-2 sentences

When user describes a DELIVERY REQUEST:
Return ONLY this JSON (no other text):
{"intent":"delivery","pickup":"address or null","dropoff":"address or null","item":"item description or null","weight":"weight string or null","fragile":true/false/null,"urgent":true/false}

When user describes an ERRAND REQUEST:
Return ONLY this JSON:
{"intent":"errand","location":"where to go or null","task":"what to do","errandType":"SHOPPING|BANK|PHARMACY|FOOD_PICKUP|DOCUMENT|COLLECTION|OTHER","deadline":"time if mentioned or null","needsMoney":true/false}

When user asks a QUESTION about the service:
Answer clearly in 1-3 sentences. End with an action they can take.

When user asks about THEIR ORDERS:
Return ONLY: {"intent":"track","query":"what they want to know"}

NEVER include backend URLs. NEVER make up policies. Keep replies under 4 sentences.`

export interface Intent {
  intent:    "delivery" | "errand" | "track" | "faq" | "greeting"
  message?:  string
  // delivery
  pickup?:   string | null
  dropoff?:  string | null
  item?:     string | null
  weight?:   string | null
  fragile?:  boolean | null
  urgent?:   boolean
  // errand
  location?:   string | null
  task?:       string
  errandType?: string
  deadline?:   string | null
  needsMoney?: boolean
  // track
  query?: string
}

export async function parseIntent(text: string, userName = ""): Promise<Intent> {
  if (!client) return { intent: "faq", message: fallback(text) }

  try {
    const nameCtx = userName ? `The user's name is ${userName}. ` : ""
    const resp = await client.messages.create({
      model:      "claude-haiku-4-5-20251001",
      max_tokens: 500,
      system:     nameCtx + SYSTEM,
      messages:   [{ role: "user", content: text }],
    })
    const content = resp.content[0].type === "text" ? resp.content[0].text.trim() : ""

    // Try JSON parse
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]) as Intent
      } catch {}
    }

    return { intent: "faq", message: content }
  } catch (e) {
    console.error("[nlp] Claude error:", e)
    return { intent: "faq", message: fallback(text) }
  }
}

export function isGreeting(text: string): boolean {
  const lower = text.toLowerCase().trim()
  const greetings = ["hi", "hello", "hey", "good morning", "good afternoon", "good evening",
    "good night", "howdy", "morning", "evening", "afternoon", "hy", "hii", "yo", "start"]
  return greetings.some(g => lower === g || lower.startsWith(g + " ") || lower.startsWith(g + ","))
}

export function isDeliveryIntent(text: string): boolean {
  const lower = text.toLowerCase()
  const keywords = ["send", "deliver", "pickup", "pick up", "dispatch", "carry", "take", "bring",
    "drop", "from", "to", "address", "package", "parcel", "item", "goods", "document"]
  return keywords.filter(k => lower.includes(k)).length >= 2
}

export function isErrandIntent(text: string): boolean {
  const lower = text.toLowerCase()
  const keywords = ["errand", "run", "buy", "purchase", "get me", "go to", "collect", "pick up for me",
    "shopping", "bank", "atm", "pharmacy", "drug", "chemist", "form", "submit", "queue"]
  return keywords.some(k => lower.includes(k))
}

export async function transcribeVoice(audioBuffer: Buffer): Promise<string> {
  if (!env.GROQ_KEY && !env.OPENAI_KEY) {
    console.warn("[nlp] No GROQ_API_KEY or OPENAI_API_KEY set; voice transcription disabled")
    return ""
  }

  const file = () => new File([audioBuffer], "voice.ogg", { type: "audio/ogg" })

  // Groq first: OpenAI-compatible Whisper endpoint, much faster and cheaper.
  if (env.GROQ_KEY) {
    try {
      const { OpenAI } = await import("openai")
      const groq = new OpenAI({
        apiKey:  env.GROQ_KEY,
        baseURL: "https://api.groq.com/openai/v1",
      })
      const resp = await groq.audio.transcriptions.create({
        file: file(),
        model: "whisper-large-v3-turbo",
        language: "en",
        response_format: "json",
      })
      const text = resp.text?.trim() ?? ""
      if (text) return text
      console.warn("[nlp] Groq transcription returned empty text; falling back to OpenAI")
    } catch (e) {
      console.error("[nlp] Groq Whisper error, falling back to OpenAI:", e)
    }
  }

  if (!env.OPENAI_KEY) return ""

  try {
    const { OpenAI } = await import("openai")
    const openai = new OpenAI({ apiKey: env.OPENAI_KEY })
    const resp   = await openai.audio.transcriptions.create({
      file: file(),
      model: "whisper-1",
      language: "en",
    })
    return resp.text.trim()
  } catch (e) {
    console.error("[nlp] Whisper error:", e)
    return ""
  }
}

function fallback(question: string): string {
  const q = question.toLowerCase()
  if (q.match(/price|cost|how much|fee|charge/))
    return "Delivery starts from ₦2,000 for the first 10km. Type *3* for an exact quote."
  if (q.match(/long|time|fast|quick|minutes|hours/))
    return "Most deliveries take 30 mins to 2 hours. Priority delivery gets the fastest rider. Type *1* to book."
  if (q.match(/where|area|location|deliver|coverage/))
    return "We cover all of Abuja FCT plus Suleja, Maraba and Nyanya. Type *1* to book."
  if (q.match(/errand|shopping|buy|bank/))
    return "Yes! We run errands too — shopping, bank runs, pharmacy pickups and more. Type *4* to book an errand."
  if (q.match(/track|rider|eta|status/))
    return "During an active delivery, type *1* to track your rider's live location."
  return "Type *menu* to see all options, or describe what you need and I'll help."
}
