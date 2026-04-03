// src/bot/states.ts
// Conversation state management via Prisma

import { PrismaClient } from "../generated/prisma/index.js"
import type { ConversationData } from "../types/index.ts"
import { env } from "../utils/env.ts"

export const db = new PrismaClient({
  datasources: { db: { url: `file:${env.DB_DIR}/liebetag.db` } },
})

export async function getState(phone: string): Promise<{ state: string; data: ConversationData; role: string }> {
  const conv = await db.conversation.findUnique({ where: { phone } })
  if (!conv) return { state: "IDLE", data: {}, role: "customer" }
  return {
    state: conv.state,
    data:  JSON.parse(conv.data) as ConversationData,
    role:  conv.role,
  }
}

export async function setState(
  phone: string, state: string,
  data: ConversationData = {},
  role?: string
) {
  await db.conversation.upsert({
    where:  { phone },
    update: { state, data: JSON.stringify(data), ...(role ? { role } : {}) },
    create: { phone, state, data: JSON.stringify(data), role: role ?? "customer" },
  })
}

export async function updateData(phone: string, patch: Partial<ConversationData>) {
  const current = await getState(phone)
  await setState(phone, current.state, { ...current.data, ...patch }, current.role)
}

export async function resetState(phone: string) {
  await setState(phone, "IDLE", {})
}

export async function getUser(phone: string) {
  return db.user.findUnique({ where: { phone } })
}

export async function upsertUser(phone: string, name = "") {
  return db.user.upsert({
    where:  { phone },
    update: { lastSeen: new Date(), ...(name ? { name } : {}) },
    create: { phone, name },
  })
}

export async function getUserName(phone: string): Promise<string> {
  const user = await db.user.findUnique({ where: { phone }, select: { name: true } })
  return user?.name ?? ""
}

export async function setUserName(phone: string, name: string) {
  await db.user.upsert({
    where:  { phone },
    update: { name },
    create: { phone, name },
  })
}

export async function touchUser(phone: string) {
  await db.user.upsert({
    where:  { phone },
    update: { lastSeen: new Date() },
    create: { phone },
  }).catch(() => {})
}
