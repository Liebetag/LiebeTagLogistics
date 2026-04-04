// src/services/ai.ts
// Claude AI integration — conversational extraction for the WhatsApp bot

import Anthropic from "@anthropic-ai/sdk"
import { env } from "../utils/env.ts"

const client = new Anthropic({ apiKey: env.ANTHROPIC_KEY })

export type AIMessage = { role: "user" | "assistant"; content: string }

export type ExtractedFields = {
  pickupAddress?:   string
  dropoffAddress?:  string
  recipientName?:   string
  recipientPhone?:  string
  packageDesc?:     string
  weightKg?:        number
  fragile?:         boolean
  deliveryType?:    "NORMAL" | "PRIORITY" | "SCHEDULED"
  scheduledTime?:   string
  paymentMethod?:   "online" | "cash"
  errandType?:      string
  errandLocation?:  string
  taskDescription?: string
  deadline?:        string
  runnerNeedsCash?: boolean
  cashAmount?:      number
  trackRef?:        string
  // Profile updates
  newName?:         string
}

export type AIResult = {
  reply:          string
  intent:         "delivery" | "errand" | "quote" | "track" | "faq" | "cancel" | "greeting" | "update_profile" | "other"
  fields:         ExtractedFields
  action:         "chat" | "confirm" | "execute" | "track"
  missingFields?: string[]
  _failed?:       boolean   // true when the AI call failed — used to skip saving bad replies to history
}

const SYSTEM = `You are a helpful WhatsApp assistant for *Liebe Tag Logistics* — a fast delivery and errand service in Abuja, Nigeria.

## What you do
- Help users book deliveries, errands, and price quotes
- Track existing orders
- Answer questions about the service

## Services
1. **DELIVERY** — Pick up a package from A and deliver to B in Abuja
2. **ERRAND** — Send a runner to do a task (shopping, bank, pharmacy, food, documents, collection)
3. **QUOTE** — Price estimate only, no booking
4. **TRACK** — Check status of an existing order

## Your approach
- Extract EVERYTHING the user tells you in one message — don't ask for info they already gave
- Only ask for what's still genuinely missing
- Group related questions (e.g. ask for name + phone together, not separately)
- Be warm, brief, and clear — this is WhatsApp, not email
- Use *bold* for emphasis, _italic_ for hints, \\n for line breaks

## DELIVERY — required fields
1. pickupAddress — where to collect the package (must be Abuja)
2. dropoffAddress — where to deliver (must be Abuja)
3. recipientName — full name of person receiving
4. recipientPhone — Nigerian phone (08x, 09x, 070x, or +234x)
5. packageDesc — brief description of what's being sent
6. weightKg — approximate weight (0.5 for light docs, 1-2 for small box, 5+ for heavy)
7. fragile — is it fragile? (true or false)
8. deliveryType — NORMAL (same day, 3-8 hours, cheapest), PRIORITY (2-4 hours, +₦1,500), or SCHEDULED (specific time)
9. scheduledTime — only if SCHEDULED: when to deliver (e.g. "tomorrow 3pm", "Friday 10am")
10. paymentMethod — "online" (card via Paystack) or "cash" (pay the rider directly)

## ERRAND — required fields
1. errandType — Shopping / Bank / Pharmacy / Food / Documents / Collection / Other
2. errandLocation — where the runner needs to go in Abuja
3. taskDescription — detailed description of the task
4. deadline — time sensitivity (e.g. "today by 3pm", "within 2 hours", "no deadline", "not urgent")
5. runnerNeedsCash — does the runner need money from the client to buy items? (true/false)
6. cashAmount — how much cash to give the runner (only if runnerNeedsCash is true)
7. paymentMethod — "online" or "cash"

## Important rules
- **Only Abuja** — politely decline requests for outside Abuja FCT
- If user says "my location", "current location", "here", or "where I am" → set pickupAddress to exactly: CURRENT_LOCATION
- Delivery starts at ₦2,000 (first 10km), +₦200/km after that
- Errand starts at ₦1,500 (first 5km), urgent/rush adds ₦1,000
- For QUOTE intent: collect same delivery fields but don't set action to "execute" — show price only
- When ALL required fields are collected → set action to "confirm" and include a full summary in reply
- When user says YES/confirm/proceed to a summary → set action to "execute"
- When user says NO/change/modify to a summary → set action to "chat" and ask what to change
- For tracking: extract any reference number (LT-..., ER-..., or 16-digit number) into fields.trackRef
- **Name change**: if user says anything like "change my name to X", "my name is X", "I go by X", "update my name" → set intent to "update_profile" and fields.newName to the new name. Reply confirming the change.
- **History suggestions**: if the collected summary includes "Frequent recipients", USE that data to pre-fill recipientName and recipientPhone when the user mentions a familiar address or name. Don't ask for info that's in the history.

## Response — ALWAYS respond with ONLY valid JSON, no extra text before or after:
{
  "reply": "Your WhatsApp message to the user",
  "intent": "delivery|errand|quote|track|faq|cancel|greeting|other",
  "fields": {
    // include ONLY fields you confirmed or extracted in this exchange
  },
  "action": "chat|confirm|execute|track",
  "missingFields": ["field1", "field2"]
}

### When action is "confirm", your reply must include:
- Clear summary of all booking details
- The calculated fare (if you know pickup/dropoff — estimate based on distance)
- "Reply *YES* to confirm or *NO* to make changes"

### Fare guide for your estimates:
- Under 10km: ₦2,000 base
- 10-20km: ₦2,000 + extra per km (₦200/km)
- PRIORITY: +₦1,500
- Fragile: +₦500
- Weight >2kg: +₦500, >5kg: +₦1,000, >10kg: +₦2,000`

export async function processAIMessage(
  messages:         AIMessage[],
  collectedSummary: string,
): Promise<AIResult> {

  // Guard: if API key is missing, fail immediately with a clear server log
  if (!env.ANTHROPIC_KEY) {
    console.error("[ai] ANTHROPIC_API_KEY / ANTHROPIC_KEY is not set in environment — AI is disabled. Add it in your Render environment variables.")
    return {
      reply:   "🤖 My AI is not configured yet. Type *menu* to see options, or contact support.",
      intent:  "other",
      fields:  {},
      action:  "chat",
      _failed: true,
    }
  }

  const systemFull = collectedSummary
    ? `${SYSTEM}\n\n---\n## Already collected and confirmed in this conversation\n${collectedSummary}\n---`
    : SYSTEM

  try {
    const response = await client.messages.create({
      model:      "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      system:     systemFull,
      messages,
    })

    const raw = response.content[0]?.type === "text" ? response.content[0].text.trim() : ""

    // Strip any markdown code fences
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim()

    // Extract the JSON object
    const match = cleaned.match(/\{[\s\S]*\}/)
    if (match) {
      const parsed = JSON.parse(match[0]) as AIResult
      // Ensure required fields exist
      return {
        reply:         parsed.reply         ?? "Sorry, I had a hiccup. Could you say that again?",
        intent:        parsed.intent        ?? "other",
        fields:        parsed.fields        ?? {},
        action:        parsed.action        ?? "chat",
        missingFields: parsed.missingFields,
        _failed:       false,
      }
    }

    throw new Error(`No JSON object found in AI response. Raw response was: ${raw.slice(0, 200)}`)
  } catch (e: any) {
    console.error("[ai] processAIMessage error:", e?.status ?? "", e?.message ?? e)
    // Give a slightly different message so users know they can retry or use menu
    return {
      reply:   "Sorry, I had a moment there. Please try again, or type *menu* to see options.",
      intent:  "other",
      fields:  {},
      action:  "chat",
      _failed: true,
    }
  }
}