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
  DB_DIR:           optional("DB_DIR", "/tmp"),
  DATABASE_URL:     optional("DATABASE_URL", `file:${optional("DB_DIR", "/tmp")}/liebetag.db`),

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
  CANTRACK_MDS:       optional("CANTRACK_MDS_TOKEN",  "f8989b7a2dfd4c6ab524882d308dc66f"),
  CANTRACK_SESSION:   optional("CANTRACK_SESSION",    ""),
  CANTRACK_SECKEY:    optional("CANTRACK_SECKEY",     ""),
  CANTRACK_BMAP:      optional("CANTRACK_BMAP",       ""),

  // AI
  ANTHROPIC_KEY:    optional("ANTHROPIC_API_KEY", ""),
  OPENAI_KEY:       optional("OPENAI_API_KEY", ""),

  // App
  APP_URL:          optional("APP_URL", "https://liebetaglogistics-api.onrender.com"),
  ALLOWED_ORIGINS:  optional("ALLOWED_ORIGINS", "https://liebetag.com"),

  // Operations
  ADMIN_PHONES:     optional("ADMIN_PHONES", "").split(",").filter(Boolean),
  RIDER_PHONES:     optional("RIDER_PHONES", "").split(",").filter(Boolean),
  RIDER_DEVICES:    optional("RIDER_DEVICES", ""),
}
