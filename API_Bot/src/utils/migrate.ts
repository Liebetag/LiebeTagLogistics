// src/utils/migrate.ts
// Auto-create all tables in Turso on startup (idempotent — uses IF NOT EXISTS)

import { createClient } from "@libsql/client"
import { env } from "./env.ts"

const TABLES = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, phone TEXT UNIQUE NOT NULL, name TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'customer', joinedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    lastSeen DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, orderCount INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY, phone TEXT UNIQUE NOT NULL, state TEXT NOT NULL DEFAULT 'IDLE',
    data TEXT NOT NULL DEFAULT '{}', role TEXT NOT NULL DEFAULT 'customer',
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY, orderRef TEXT UNIQUE NOT NULL, orderNumber TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'created', senderPhone TEXT NOT NULL DEFAULT '',
    senderName TEXT NOT NULL DEFAULT '', recipientPhone TEXT NOT NULL DEFAULT '',
    recipientName TEXT NOT NULL DEFAULT '', riderPhone TEXT NOT NULL DEFAULT '',
    pickupJson TEXT NOT NULL DEFAULT '{}', dropoffJson TEXT NOT NULL DEFAULT '{}',
    packageDesc TEXT NOT NULL DEFAULT '', weightKg REAL NOT NULL DEFAULT 0,
    fragile INTEGER NOT NULL DEFAULT 0, itemsJson TEXT NOT NULL DEFAULT '[]',
    deliveryType TEXT NOT NULL DEFAULT 'NORMAL', scheduledTime TEXT,
    fareTotal INTEGER NOT NULL DEFAULT 0, fareJson TEXT NOT NULL DEFAULT '{}',
    paymentType TEXT NOT NULL DEFAULT 'online', paymentStatus TEXT NOT NULL DEFAULT 'pending',
    paystackRef TEXT, deliveryCode TEXT NOT NULL DEFAULT '',
    deliveryCodeUsed INTEGER NOT NULL DEFAULT 0, pickupPhotoId TEXT NOT NULL DEFAULT '',
    pickupPhotoTime TEXT NOT NULL DEFAULT '', arrivalTime TEXT, arrivalEpoch REAL,
    waitingCharge INTEGER NOT NULL DEFAULT 0, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    paidAt DATETIME, assignedAt DATETIME, pickedUpAt DATETIME,
    deliveredAt DATETIME, cancelledAt DATETIME, extraJson TEXT NOT NULL DEFAULT '{}'
  )`,
  `CREATE TABLE IF NOT EXISTS errands (
    id TEXT PRIMARY KEY, errandRef TEXT UNIQUE NOT NULL, errandNumber TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'created', errandType TEXT NOT NULL DEFAULT 'OTHER',
    clientPhone TEXT NOT NULL DEFAULT '', clientName TEXT NOT NULL DEFAULT '',
    riderPhone TEXT NOT NULL DEFAULT '', locationJson TEXT NOT NULL DEFAULT '{}',
    returnJson TEXT NOT NULL DEFAULT '{}', taskDescription TEXT NOT NULL DEFAULT '',
    shoppingList TEXT NOT NULL DEFAULT '[]', deadline TEXT,
    errandFee INTEGER NOT NULL DEFAULT 0, itemCost INTEGER NOT NULL DEFAULT 0,
    totalCharge INTEGER NOT NULL DEFAULT 0, paymentType TEXT NOT NULL DEFAULT 'online',
    paymentStatus TEXT NOT NULL DEFAULT 'pending', paystackRef TEXT,
    runnerNeedsCash INTEGER NOT NULL DEFAULT 0, cashProvided INTEGER NOT NULL DEFAULT 0,
    proofPhotos TEXT NOT NULL DEFAULT '[]', receiptPhotoId TEXT NOT NULL DEFAULT '',
    deliveryCode TEXT NOT NULL DEFAULT '', createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    paidAt DATETIME, assignedAt DATETIME, startedAt DATETIME,
    completedAt DATETIME, cancelledAt DATETIME, extraJson TEXT NOT NULL DEFAULT '{}'
  )`,
  `CREATE TABLE IF NOT EXISTS riders (
    id TEXT PRIMARY KEY, phone TEXT UNIQUE NOT NULL, name TEXT NOT NULL DEFAULT '',
    deviceId TEXT NOT NULL DEFAULT '', bankAccount TEXT NOT NULL DEFAULT '',
    bankCode TEXT NOT NULL DEFAULT '', bankName TEXT NOT NULL DEFAULT '',
    recipientCode TEXT NOT NULL DEFAULT '', balance INTEGER NOT NULL DEFAULT 0,
    totalEarned INTEGER NOT NULL DEFAULT 0, isActive INTEGER NOT NULL DEFAULT 1,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS ledger_entries (
    id TEXT PRIMARY KEY, riderPhone TEXT NOT NULL, orderRef TEXT NOT NULL,
    amount INTEGER NOT NULL, commission INTEGER NOT NULL, earnings INTEGER NOT NULL,
    paymentType TEXT NOT NULL, settledAt DATETIME,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS settlements (
    id TEXT PRIMARY KEY, riderPhone TEXT NOT NULL, amount INTEGER NOT NULL,
    weekEnding TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
    paystackRef TEXT, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS assignments (
    id TEXT PRIMARY KEY, deviceId TEXT NOT NULL, orderRef TEXT NOT NULL,
    pickupLat REAL NOT NULL, pickupLng REAL NOT NULL, destLat REAL, destLng REAL,
    status TEXT NOT NULL DEFAULT 'active',
    startedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, endedAt DATETIME
  )`,
  `CREATE TABLE IF NOT EXISTS rider_locations (
    riderPhone TEXT PRIMARY KEY, lat REAL NOT NULL, lng REAL NOT NULL,
    accuracy REAL, source TEXT NOT NULL DEFAULT 'whatsapp',
    sharedLive INTEGER NOT NULL DEFAULT 0,
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS bike_allocation_requests (
    id TEXT PRIMARY KEY, riderPhone TEXT NOT NULL, riderName TEXT NOT NULL DEFAULT '',
    deviceId TEXT NOT NULL, deviceLabel TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    requestedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewedAt DATETIME, reviewedBy TEXT, note TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS portal_otps (
    phone TEXT PRIMARY KEY,
    codeHash TEXT NOT NULL,
    expiresAt DATETIME NOT NULL,
    consumed INTEGER NOT NULL DEFAULT 0,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS admin_users (
    id TEXT PRIMARY KEY,
    phone TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'admin',
    passwordHash TEXT NOT NULL,
    permissions TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'active',
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    createdBy TEXT NOT NULL DEFAULT '',
    lastLoginAt DATETIME
  )`,
]

export async function runMigrations() {
  const client = createClient({
    url:       env.TURSO_DATABASE_URL || env.DATABASE_URL,
    authToken: env.TURSO_AUTH_TOKEN,
  })
  for (const sql of TABLES) {
    await client.execute(sql)
  }
  console.log("✅ Database tables ready")
}
