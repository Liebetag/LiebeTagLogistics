// src/utils/env.ts
// Type-safe environment variable access

const required = (key: string): string => {
  const val = process.env[key] || Bun.env[key]
  if (!val) throw new Error(`Missing required env var: ${key}`)
  return val
}

const optional = (key: string, fallback = ""): string =>
  process.env[key] || Bun.env[key] || fallback

export const env = {
  PORT:             optional("PORT", "8000"),
  DATABASE_URL:     optional("DATABASE_URL", "file:./dev.db"),
  TURSO_DATABASE_URL: optional("TURSO_DATABASE_URL", ""),
  TURSO_AUTH_TOKEN: optional("TURSO_AUTH_TOKEN", ""),

  // Auth
  API_KEY:          optional("BOOTSTRAP_API_KEY", ""),
  JWT_SECRET:       optional("JWT_SECRET", "secret"),

  // WhatsApp
  EVOLUTION_URL:    optional("EVOLUTION_API_URL", "").replace(/\/$/, ""),
  EVOLUTION_KEY:    optional("EVOLUTION_API_KEY", ""),
  EVOLUTION_INST:   optional("EVOLUTION_INSTANCE", "liebe-tag"),

  // Paystack
  PAYSTACK_SECRET:  optional("PAYSTACK_SECRET_KEY", ""),
  PAYSTACK_PUBLIC:  optional("PAYSTACK_PUBLIC_KEY", ""),

  // Cantrack GPS
  CANTRACK_SCHOOL_ID: optional("CANTRACK_SCHOOL_ID", "a0882f1c-821f-4852-bccd-4ef7a3e69b08"),
  CANTRACK_CUST_ID:   optional("CANTRACK_CUST_ID",   "a0882f1c-821f-4852-bccd-4ef7a3e69b08"),
  CANTRACK_MDS:       optional("CANTRACK_MDS_TOKEN",  "9267b5563a484d69b75e1aa1d637ab9f"),
  CANTRACK_SESSION:   optional("CANTRACK_SESSION",    ""),
  CANTRACK_SECKEY:    optional("CANTRACK_SECKEY",     ""),
  CANTRACK_BMAP:      optional("CANTRACK_BMAP",       ""),
  CANTRACK_USER:      optional("CANTRACK_USER",       "LIEBE TAG LOGISTICS"),
  CANTRACK_PASS:      optional("CANTRACK_PASS",       "123456"),

  // AI — accept both ANTHROPIC_API_KEY and ANTHROPIC_KEY so either name works in Render
  ANTHROPIC_KEY:    optional("ANTHROPIC_API_KEY", "") || optional("ANTHROPIC_KEY", ""),
  OPENAI_KEY:       optional("OPENAI_API_KEY", "") || optional("OPENAI_KEY", ""),
  // Groq — used for voice transcription (free, very fast Whisper-large-v3-turbo)
  GROQ_KEY:         optional("GROQ_API_KEY", "") || optional("GROQ_KEY", ""),

  // App
  APP_URL:          optional("APP_URL", "https://liebetaglogistics-api.onrender.com"),
  ALLOWED_ORIGINS:  optional("ALLOWED_ORIGINS", "https://liebetag.com"),

  // Operations
  ADMIN_PHONES:     optional("ADMIN_PHONES", "").split(",").filter(Boolean),
  RIDER_PHONES:     optional("RIDER_PHONES", "").split(",").filter(Boolean),
  RIDER_DEVICES:    optional("RIDER_DEVICES", ""),
}

// Startup warnings for critical keys
if (!env.ANTHROPIC_KEY) {
  console.warn("⚠️  WARNING: ANTHROPIC_API_KEY is not set. All AI features will fail with 'Sorry, I had a moment there.'")
}
if (!env.EVOLUTION_KEY) {
  console.warn("⚠️  WARNING: EVOLUTION_API_KEY is not set. WhatsApp messages cannot be sent.")
}
if (!env.PAYSTACK_SECRET) {
  console.warn("⚠️  WARNING: PAYSTACK_SECRET_KEY is not set. Payment links will fail.")
}
if (!env.GROQ_KEY) {
  console.warn("⚠️  WARNING: GROQ_API_KEY is not set. Voice notes cannot be transcribed.")
}
