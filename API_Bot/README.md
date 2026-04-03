# Liebe Tag Logistics API v4

WhatsApp bot + GPS tracking + delivery + errands platform.
Built with **Bun + Hono + Prisma + TypeScript**.

## Stack
- **Runtime:** Bun (fastest Node-compatible runtime)
- **Framework:** Hono (lightweight, type-safe)
- **Database:** Prisma ORM + SQLite (persistent on Render Disk)
- **WhatsApp:** EvolutionAPI v2
- **GPS:** Cantrack portal (token-based auth)
- **AI:** Claude Haiku (NLP + FAQ) + Whisper (voice notes)
- **Payments:** Paystack

## Local Setup

```bash
# Install Bun
curl -fsSL https://bun.sh/install | bash

# Install deps
bun install

# Copy env
cp .env.example .env
# Fill in all values in .env

# Setup DB
bun db:push

# Run
bun dev
```

## Render Deployment

1. Create new Web Service → connect GitHub repo
2. Set Root Directory to the folder containing this README
3. Build: `npm install -g bun && bun install && bunx prisma generate && bunx prisma db push`
4. Start: `bun src/index.ts`
5. Add Disk: mount path `/data`, size 1GB
6. Add all environment variables from `.env.example`
7. Deploy

## EvolutionAPI Webhook

Set webhook URL to:
```
https://your-app.onrender.com/webhook/whatsapp
```

Enable: `MESSAGES_UPSERT`

## Services

| Endpoint | Description |
|----------|-------------|
| `GET /` | Health check + GPS status |
| `POST /webhook/whatsapp` | WhatsApp message receiver |
| `POST /payments/webhook` | Paystack payment events |
| `GET /trackers/live` | All 5 GPS tracker locations |
| `GET /location/:deviceId` | Single tracker location |
| `GET /orders/search?q=` | Search orders |
| `GET /orders/:ref` | Single order |
| `GET /errands/search?q=` | Search errands |
| `GET /riders` | All riders |
| `GET /riders/:phone/balance` | Rider balance |

## Bot Features

**Customer:**
- Smart NLP — "Send a package from Wuse 2 to Asokoro" just works
- Voice note support via Whisper
- Delivery booking with per-item weight + fragility
- **Errand booking** — shopping, bank runs, pharmacy, document submission, collection
- Scheduled delivery with ₦200 discount (4+ hours ahead)
- Address suggestions + Abuja geo-fence
- Real-time GPS tracking via location pin
- Delivery confirmation code system

**Rider:**
- Accept/decline jobs
- Arrival notification to sender
- Order number + photo verification at pickup
- Delivery code authentication
- Multi-item queue management
- Earnings tracking

**Errands:**
- 7 errand types: Shopping, Bank, Pharmacy, Food Pickup, Documents, Collection, Other
- Task description + deadline
- Item cost advance tracking
- Proof photo requirement
