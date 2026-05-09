// src/services/cantrack.ts
// Cantrack GPS tracker integration: dynamic login + background polling + WebSocket broadcast

import { env } from "../utils/env.ts"
import type { GPSLocation } from "../types/index.ts"

const BASE      = "https://www.cantrackportal.com"
const SCHOOL_ID = env.CANTRACK_SCHOOL_ID
const CUST_ID   = env.CANTRACK_CUST_ID

// All 5 trackers: device ID -> metadata
export const TRACKERS: Record<string, { label: string; imei: string; sim: string }> = {
  "ec86025d2be54efb96634bd437c56e23": { label: "LT01-STEPHEN", imei: "868720065061578", sim: "09111848135" },
  "791b7b56bacf4b84a8ff4e7a9c82309a": { label: "LT02-KINGSLEY PAUL", imei: "868720065056750", sim: "09111848128" },
  "320cee40e50c441cb3b0e72b11c5692e": { label: "LT03-KINGSLEY EMEKA", imei: "868720065063178", sim: "09111848126" },
  "f59bbda3b8104ec5b4cafaf740e6e3ce": { label: "LT04-TITUS", imei: "868720065061412", sim: "09111848127" },
  "c35c83a5e069496a80b0e1d3f1878062": { label: "LT05-ALEXANDER", imei: "868720065056487", sim: "09111848129" },
}

type BroadcastFn = (locations: GPSLocation[]) => void
let _broadcast: BroadcastFn | null = null
export function registerBroadcast(fn: BroadcastFn) { _broadcast = fn }

class CantrackClient {
  private cookiesByName = new Map<string, string>()
  private liveCache     = new Map<string, GPSLocation>()
  private pollingTimer: ReturnType<typeof setInterval> | null = null
  private lastPollOk    = false
  private lastLoginAt   = 0
  private mds           = env.CANTRACK_MDS

  constructor() {
    if (env.CANTRACK_SESSION) this.cookiesByName.set("ASP.NET_SessionId", env.CANTRACK_SESSION)
    if (env.CANTRACK_SECKEY)  this.cookiesByName.set("SECKEY_ABVK", env.CANTRACK_SECKEY)
    if (env.CANTRACK_BMAP)    this.cookiesByName.set("BMAP_SECKEY", env.CANTRACK_BMAP)
  }

  updateCookies(session: string, seckey = "", bmap = "") {
    this.cookiesByName.set("ASP.NET_SessionId", session)
    if (seckey) this.cookiesByName.set("SECKEY_ABVK", seckey)
    if (bmap)   this.cookiesByName.set("BMAP_SECKEY", bmap)
    console.log("[cantrack] Session cookies updated manually")
  }

  private cookies() {
    const parts = [...this.cookiesByName.entries()].map(([name, value]) => `${name}=${value}`)
    parts.push("domainIndex=0")
    return parts.join("; ")
  }

  private storeCookies(headers: Headers) {
    const h = headers as Headers & { getSetCookie?: () => string[] }
    const rawCookies = [
      headers.get("set-cookie") ?? "",
      ...(h.getSetCookie?.() ?? []),
    ].filter(Boolean)

    for (const raw of rawCookies) {
      const parts = raw.split(/,(?=[^ ;]+=)/).map(part => part.trim()).filter(Boolean)
      for (const part of parts) {
        const [nameValue] = part.split(";")
        const separator = nameValue.indexOf("=")
        if (separator > 0) {
          this.cookiesByName.set(nameValue.slice(0, separator), nameValue.slice(separator + 1))
        }
      }
    }
  }

  private absoluteUrl(path: string) {
    return path.startsWith("http") ? path : `${BASE}${path}`
  }

  private extractLocationHref(text: string) {
    const match = text.match(/(?:window\.)?location\.href\s*=\s*["']([^"']+)/i)
    return match?.[1] ?? ""
  }

  private isSessionExpired(text: string) {
    const t = text.trim().toLowerCase()
    const expired =
      t.includes("loginouts") ||
      t.includes("logout.aspx") ||
      t.startsWith("<!doctype") ||
      t.startsWith("<html")

    if (expired) {
      console.warn("[cantrack] Session-expired response detected. Preview:", text.slice(0, 120).replace(/\s+/g, " "))
    }
    return expired
  }

  private async request(path: string, options: {
    method?: string
    headers?: Record<string, string>
    body?: string
    referer?: string
  } = {}) {
    const response = await fetch(this.absoluteUrl(path), {
      method: options.method ?? "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
        "Referer": options.referer ?? `${BASE}/Skins/DefaultIndex/`,
        "Cookie": this.cookies(),
        ...(options.headers ?? {}),
      },
      body: options.body,
      redirect: "manual",
    })

    this.storeCookies(response.headers)
    return {
      response,
      text: await response.text(),
    }
  }

  async login(): Promise<boolean> {
    try {
      const user = env.CANTRACK_USER || "LIEBE TAG LOGISTICS"
      const pass = env.CANTRACK_PASS || "123456"

      this.cookiesByName.clear()
      this.mds = env.CANTRACK_MDS

      await this.request("/Skins/DefaultIndex/", {
        headers: { "Accept": "text/html,application/xhtml+xml,*/*;q=0.8" },
      })

      const form = new URLSearchParams({
        userName: user,
        pwd: pass,
        monitor: "0",
        loginType: "ENTERPRISE",
        url: "",
        rand: "",
        language: "en",
        timeZone: "1",
      })

      const login = await this.request("/LoginByUser.aspx?method=loginSystem", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      })

      const sendRedirectPath = this.extractLocationHref(login.text)
      if (!sendRedirectPath) {
        console.warn("[cantrack] Login did not return sendRedirect URL")
        return false
      }

      const redirect = await this.request(sendRedirectPath, {
        referer: `${BASE}/LoginByUser.aspx?method=loginSystem`,
      })

      const indexPath = this.extractLocationHref(redirect.text)
      if (!indexPath) {
        console.warn("[cantrack] sendRedirect did not return user index URL")
        return false
      }

      const indexUrl = new URL(this.absoluteUrl(indexPath))
      const freshMds = indexUrl.searchParams.get("mds")
      if (freshMds) this.mds = freshMds

      await this.request(indexPath, {
        referer: this.absoluteUrl(sendRedirectPath),
      })

      this.lastLoginAt = Date.now()
      console.log(`[cantrack] Login OK - fresh MDS:${freshMds ? "yes" : "NO"}`)
      return true
    } catch (e) {
      console.error("[cantrack] Login error:", e)
      return false
    }
  }

  private headers() {
    return {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
      "Accept": "text/javascript, application/javascript, */*; q=0.01",
      "X-Requested-With": "XMLHttpRequest",
      "Referer": `${BASE}/user/tracking.html?mds=${this.mds}&school_id=${SCHOOL_ID}&custid=${CUST_ID}&mapType=GOOGLE`,
      "Cookie": this.cookies(),
    }
  }

  private buildUrl(userIds: string) {
    const url = new URL(`${BASE}/TrackService.aspx`)
    url.searchParams.set("method", "getUserAndGPSInfoUtcByIds")
    url.searchParams.set("school_id", SCHOOL_ID)
    url.searchParams.set("custid", CUST_ID)
    url.searchParams.set("user_ids", userIds)
    url.searchParams.set("mapType", "GOOGLE")
    url.searchParams.set("option", "en")
    url.searchParams.set("Selected", "device")
    url.searchParams.set("currentid", CUST_ID)
    url.searchParams.set("update", "1")
    url.searchParams.set("mds", this.mds)
    return url
  }

  private parseResponse(text: string): Record<string, unknown> {
    if (this.isSessionExpired(text)) return {}
    try { return JSON.parse(text) }
    catch {
      console.warn("[cantrack] Invalid JSON response preview:", text.slice(0, 200).replace(/\s+/g, " "))
      return {}
    }
  }

  private parseRecord(rec: unknown[]): GPSLocation | null {
    if (!Array.isArray(rec) || rec.length < 11) return null
    const lng = parseFloat(String(rec[1] ?? "0"))
    const lat = parseFloat(String(rec[2] ?? "0"))
    if (!lat && !lng) return null

    const uid = String(rec[10] ?? "")
    const tracker = TRACKERS[uid]
    const tsRaw = parseInt(String(rec[5] ?? "0"))

    return {
      deviceId: uid,
      latitude: lat,
      longitude: lng,
      speedKmh: parseFloat(String(rec[7] ?? "0")),
      heading: parseFloat(String(rec[9] ?? "0")),
      timestamp: tsRaw ? new Date(tsRaw).toISOString() : new Date().toISOString(),
      label: tracker?.label ?? uid.slice(0, 8),
      status: "online",
    }
  }

  private offlineLocation(deviceId: string): GPSLocation {
    const tracker = TRACKERS[deviceId]
    return {
      deviceId,
      latitude: null,
      longitude: null,
      speedKmh: 0,
      heading: 0,
      timestamp: "",
      label: tracker?.label ?? deviceId.slice(0, 8),
      status: "offline",
    }
  }

  private async fetchText(userIds: string) {
    const url = this.buildUrl(userIds)
    const response = await fetch(url.toString(), { headers: this.headers() })
    this.storeCookies(response.headers)
    return response.text()
  }

  async fetchAll(): Promise<GPSLocation[]> {
    let text = await this.fetchText(Object.keys(TRACKERS).join(","))

    if (this.isSessionExpired(text)) {
      const now = Date.now()
      const cooldown = 90_000
      if (now - this.lastLoginAt < cooldown) {
        console.warn(`[cantrack] Session expired but last login was ${Math.round((now - this.lastLoginAt) / 1000)}s ago - using cache`)
        return this.getAllCached()
      }

      console.warn("[cantrack] Session expired - re-logging in")
      this.lastLoginAt = now
      const ok = await this.login()
      if (!ok) {
        this.lastPollOk = false
        return this.getAllCached()
      }
      text = await this.fetchText(Object.keys(TRACKERS).join(","))
    }

    const data = this.parseResponse(text)
    const records = (data.records as unknown[][]) ?? []
    const online = new Map<string, GPSLocation>()

    for (const rec of records) {
      const loc = this.parseRecord(rec)
      if (loc) online.set(loc.deviceId, loc)
    }

    const results = Object.keys(TRACKERS).map(deviceId =>
      online.get(deviceId) ?? this.offlineLocation(deviceId)
    )

    this.liveCache.clear()
    for (const loc of results) this.liveCache.set(loc.deviceId, loc)

    const liveCount = results.filter(loc => loc.status !== "offline").length
    this.lastPollOk = liveCount > 0
    if (liveCount > 0) {
      console.log(`[cantrack] Poll OK - ${liveCount}/${results.length} tracker(s) live`)
      _broadcast?.(results)
    } else {
      console.warn("[cantrack] Poll returned 0 live trackers. Response preview:", text.slice(0, 200).replace(/\s+/g, " "))
    }

    return results
  }

  async fetchOne(deviceId: string): Promise<GPSLocation | null> {
    const cached = this.liveCache.get(deviceId)
    if (cached && this.lastPollOk) return cached

    let text = await this.fetchText(deviceId)
    if (this.isSessionExpired(text)) {
      await this.login()
      text = await this.fetchText(deviceId)
    }

    const data = this.parseResponse(text)
    const recs = (data.records as unknown[][]) ?? []
    for (const rec of recs) {
      const loc = this.parseRecord(rec)
      if (loc) {
        this.liveCache.set(loc.deviceId, loc)
        return loc
      }
    }

    if (TRACKERS[deviceId]) {
      const offline = this.offlineLocation(deviceId)
      this.liveCache.set(deviceId, offline)
      return offline
    }

    return null
  }

  startPolling(intervalMs = 30_000) {
    if (this.pollingTimer) return
    console.log(`[cantrack] Starting background poll every ${intervalMs / 1000}s`)
    this.fetchAll().catch(e => console.error("[cantrack] Initial poll error:", e))
    this.pollingTimer = setInterval(() => {
      this.fetchAll().catch(e => console.error("[cantrack] Poll error:", e))
    }, intervalMs)
  }

  stopPolling() {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer)
      this.pollingTimer = null
      console.log("[cantrack] Polling stopped")
    }
  }

  getCache(deviceId: string): GPSLocation | null {
    const loc = this.liveCache.get(deviceId)
    return loc?.status === "offline" ? null : loc ?? null
  }

  getAllCached(): GPSLocation[] {
    return [...this.liveCache.values()]
  }

  isPolling() { return !!this.pollingTimer }
  lastPollSuccess() { return this.lastPollOk }
}

export const cantrack = new CantrackClient()
