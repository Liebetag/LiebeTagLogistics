# Liebe Tag Logistics API v4

WhatsApp bot + GPS tracking + delivery management platform for Abuja, Nigeria.
Built with **Bun · Hono · Prisma · TypeScript · Claude AI**.

<!-- LAST_UPDATED: 2026-04-04 v2 -->

---

## Overview

Liebe Tag Logistics is a WhatsApp-first delivery and errand service operating in Abuja, Nigeria. This API powers:

- **Customer bot** — fully conversational AI (Claude Haiku) that extracts booking details from natural language in a single message
- **Rider bot** — job dispatch, pickup confirmation, photo verification, delivery queue management
- **Admin dashboard** — live GPS map via WebSocket, order search, rider balances
- **Public tracking pages** — mobile-friendly per-order HTML with live rider location, pickup photo, and timeline
- **Proximity alerts** — auto-notifies customer and recipient when rider is ≤1.5 km from dropoff

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | [Bun](https://bun.sh) |
| HTTP Framework | [Hono](https://hono.dev) |
| Database | [Turso](https://turso.tech) (libSQL cloud SQLite) via Prisma + `@prisma/adapter-libsql` |
| WhatsApp | [Evolution API v2](https://evolution-api.com) |
| AI | Claude Haiku (`claude-haiku-4-5-20251001`) via Anthropic SDK |
| Voice | Groq Whisper (`whisper-large-v3-turbo`) |
| Payments | [Paystack](https://paystack.com) |
| GPS | Cantrack portal (`cantrackportal.com`) — cookie-authenticated polling |
| Geocoding | Nominatim (OpenStreetMap) + Abuja landmark database |
| Maps | OpenStreetMap embed iframe (no API key required) |

---

## Project Structure

```
src/
├── index.ts                 # Hono server, routes, WebSocket, startup
├── bot/
│   ├── handler.ts           # Main message router (customer + rider)
│   ├── ai-customer.ts       # AI-driven customer conversation (Claude)
│   ├── rider.ts             # Rider state machine
│   ├── states.ts            # Prisma DB client + conversation state helpers
│   └── onboarding.ts        # New user registration flow
├── flows/
│   ├── dispatch.ts          # Rider dispatch (delivery + errand)
│   └── delivery.ts          # Legacy delivery state handlers (post-booking)
├── services/
│   ├── ai.ts                # Claude API wrapper + system prompt
│   ├── evolution.ts         # WhatsApp send/receive/media helpers
│   ├── paystack.ts          # Payment link generation + webhook verification
│   ├── cantrack.ts          # GPS tracker polling + cache + WebSocket broadcast
│   ├── proximity.ts         # Proximity alerts (≤1.5km from dropoff)
│   └── nlp.ts               # Intent helpers + Groq/OpenAI voice transcription
├── pricing/
│   └── index.ts             # Fare calculation + haversine distance
├── geocoding/
│   └── index.ts             # Nominatim geocoder + Abuja geo-fence + landmarks
├── types/
│   └── index.ts             # Shared TypeScript types
└── utils/
    ├── env.ts               # Validated environment variables
    ├── migrate.ts           # Turso schema migration runner
    └── tracking-page.ts     # Server-rendered HTML tracking page
```

---

## Local Development

```bash
# 1. Install Bun
curl -fsSL https://bun.sh/install | bash

# 2. Install dependencies
bun install

# 3. Configure environment
cp .env.example .env
# Fill in all values (see Environment Variables below)

# 4. Run database migrations
bun run migrate      # or: bun src/utils/migrate.ts

# 5. Start dev server
bun dev              # hot-reload via --watch
```

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `PORT` | HTTP server port (default `8000`) |
| `TURSO_DATABASE_URL` | Turso libSQL cloud URL (`libsql://...`) — or `DATABASE_URL` for local SQLite |
| `TURSO_AUTH_TOKEN` | Turso auth token |
| `ANTHROPIC_API_KEY` | **Required for AI bot** — Anthropic API key (Claude Haiku). Also accepted as `ANTHROPIC_KEY`. |
| `EVOLUTION_API_URL` | Evolution API base URL |
| `EVOLUTION_API_KEY` | Evolution API global key |
| `EVOLUTION_INSTANCE` | Evolution API instance name (default `liebe-tag`) |
| `GROQ_API_KEY` | Groq API key for primary voice transcription (`whisper-large-v3-turbo`) |
| `OPENAI_API_KEY` | Optional for non-voice AI utilities; voice transcription uses Groq only |
| `PAYSTACK_SECRET_KEY` | Paystack secret key |
| `PAYSTACK_PUBLIC_KEY` | Paystack public key |
| `CANTRACK_SCHOOL_ID` | Cantrack school/account ID |
| `CANTRACK_MDS_TOKEN` | Cantrack MDS authentication token |
| `CANTRACK_SESSION` | Cantrack ASP.NET session cookie |
| `CANTRACK_SECKEY` | Cantrack seckey cookie |
| `CANTRACK_BMAP` | Cantrack bmap cookie |
| `RIDER_PHONES` | Comma-separated rider WhatsApp numbers (`234...`) |
| `RIDER_DEVICES` | `phone:deviceId` pairs for GPS tracking, comma-separated |
| `ADMIN_PHONES` | Comma-separated admin WhatsApp numbers |
| `BOOTSTRAP_API_KEY` | Bearer token for protected REST endpoints |
| `APP_URL` | Public base URL (e.g. `https://liebetaglogistics-api.onrender.com`) |
| `ALLOWED_ORIGINS` | Comma-separated CORS allowed origins |

---

## API Endpoints

### Public

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Health check — active orders, GPS status |
| `POST` | `/webhook/whatsapp` | Evolution API message webhook |
| `POST` | `/payments/webhook` | Paystack charge webhook |
| `GET` | `/track/:ref` | Public order/errand tracking page (HTML) |
| `GET` | `/order/:ref/photo` | Pickup photo (JPEG, cached 24h) |

### Protected (require `X-API-Key` header)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/trackers/live` | All GPS tracker locations (JSON) |
| `GET` | `/location/:deviceId` | Single tracker location |
| `GET` | `/ws/trackers?key=` | WebSocket — live GPS push every 30s |
| `POST` | `/admin/cantrack/session` | Refresh Cantrack session cookies |
| `GET` | `/orders/search?q=` | Search orders by ref/phone |
| `GET` | `/orders/:ref` | Single order by ref or number |
| `GET` | `/errands/search?q=` | Search errands |
| `GET` | `/riders` | All riders |
| `GET` | `/riders/:phone/balance` | Rider balance + recent trips |

---

## Bot Flows

### Customer Bot (AI-driven)

The customer bot uses Claude Haiku to understand natural language. A single message like:

> *"Send a small package from Wuse 2 market to my sister in Gwarinpa, her name is Fatima Usman, 08012345678, it's documents, not fragile, NORMAL delivery, pay with card"*

…extracts all 10 required fields at once. The bot only asks for what's still missing.

**States:**
- `NEW` → onboarding (name + phone collection)
- `AI_CHAT` → conversational extraction loop
- `AI_CONFIRM` → user confirms booking summary
- `AWAIT_PAYMENT` → Paystack link sent, waiting for webhook
- `WAITING_RIDER` → dispatching to available riders
- `TRACKING` → order in progress, can request live location

**Intents handled:**
| Intent | Action |
|--------|--------|
| `delivery` | Book a delivery |
| `errand` | Book an errand (shopping, bank, pharmacy…) |
| `quote` | Price estimate only |
| `track` | Check order status by ref |
| `cancel` | Cancel pending order |
| `update_profile` | Change display name |
| `greeting` | Welcome message |
| `faq` | General questions |

**History suggestions:** The bot remembers the last 10 orders and pre-fills recipient name and phone when a familiar address or name is mentioned.

### Rider Bot

| Command | Description |
|---------|-------------|
| `delivery` / `queue` | Show active order + pending queue |
| `accept` | Accept dispatched job |
| `decline` | Decline job |
| `arrived` | Mark arrived at pickup |
| `[order number]` | Confirm pickup + trigger photo prompt |
| *(photo upload)* | Mandatory pickup photo — cannot be skipped |
| `delivered [code]` | Confirm delivery with customer code |
| `balance` | Show earnings and recent trips |

---

## Pricing

### Delivery
| Condition | Rate |
|-----------|------|
| Base (first 10 km) | ₦2,000 |
| Extra distance | ₦200/km |
| PRIORITY (+2–4hr) | +₦1,500 |
| Fragile handling | +₦500 |
| Weight 2–5 kg | +₦500 |
| Weight 5–10 kg | +₦1,000 |
| Weight >10 kg | +₦2,000 |

### Errand
| Condition | Rate |
|-----------|------|
| Base (first 5 km) | ₦1,500 |
| Urgent/rush | +₦1,000 |

---

## GPS Tracking

Cantrack GPS trackers are polled every 30 seconds. Live data is:
1. **Cached** in memory for instant REST responses
2. **Broadcast** via WebSocket to admin dashboard clients
3. **Checked** against active orders for proximity alerts (≤1.5 km from dropoff)
4. **Embedded** in the public tracking page (OpenStreetMap iframe, auto-refresh every 30s)

Session cookies are refreshed automatically on login. If login fails, the `CANTRACK_SESSION` env var is used as fallback.

---

## Proximity Alerts

When a rider's GPS position comes within **1.5 km** of the delivery dropoff:
- **Sender** receives: "Your rider is ~N min away from the drop-off"
- **Recipient** receives: "Get ready — your package is almost here"

Each order is only alerted once (deduplicated in memory). The alert fires only after the package has been physically picked up (status = `picked_up`).

---

## Tracking Page

Every order and errand gets a public tracking URL:

```
https://your-domain.com/track/LT-XXXXXXXX
```

The page shows:
- Current status with colour-coded indicator
- Live rider location on OpenStreetMap (when GPS available)
- Pickup photo uploaded by rider
- Full order details (addresses, package, fare)
- Event timeline (placed → paid → assigned → picked up → delivered)
- Print / Save as PDF button

---

## Deployment (Render)

1. Create **Web Service** → connect GitHub repo
2. Set **Root Directory** to `API_Bot/`
3. **Build command:** `npm install -g bun && bun install && bunx prisma generate`
4. **Start command:** `bun src/index.ts`
5. Add **Disk** (for SQLite fallback): mount `/data`, 1 GB
6. Add all environment variables from the table above
7. Set **Evolution API webhook** → `https://your-app.onrender.com/webhook/whatsapp`
8. Enable event: `MESSAGES_UPSERT`

---

## Database

Prisma schema targets Turso (libSQL). Key models:

| Model | Purpose |
|-------|---------|
| `User` | Customer profiles (phone, name, state, data) |
| `Order` | Delivery bookings |
| `Errand` | Errand bookings |
| `Rider` | Rider profiles + device IDs + balance |
| `LedgerEntry` | Per-trip earnings log |

Migrations run automatically on startup via `runMigrations()` in `src/utils/migrate.ts`.

---

## Recent Changes

| Date | Change |
|------|--------|
| 2026-05-09 | Fix TypeScript build errors |
| 2026-05-09 | Fix WhatsApp PDF document delivery |
| 2026-05-09 | Add rider location and admin allocation flow |
| 2026-05-09 | Fix Cantrack GPS polling |
| 2026-05-09 | feat: use Groq first for voice transcription |
| 2026-04-09 | feat: PDF shipping label/receipt, photo OCR pickup confirm, cantrack fix |
| 2026-04-04 | fix: fare display, paystack webhook, cash payment fallback |
| 2026-04-04 | fix: remove WAITING_RIDER from LEGACY_DELIVERY_STATES |
| 2026-04-04 | fix: stop AI latching onto stale/history addresses as dropoff |
| 2026-04-04 | fix: resolve WAITING_RIDER lockout and Cantrack re-login loop |
---

*Liebe Tag Logistics · info@liebetag.com · +234 811 870 7226*
