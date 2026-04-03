// src/services/cantrack.ts
// Cantrack GPS tracker integration — background polling + WebSocket broadcast

import { env } from "../utils/env.ts"
import type { GPSLocation } from "../types/index.ts"

const BASE      = "https://www.cantrackportal.com"
const SCHOOL_ID = env.CANTRACK_SCHOOL_ID
const CUST_ID   = env.CANTRACK_CUST_ID
const MDS       = env.CANTRACK_MDS  // 9267b5563a484d69b75e1aa1d637ab9f

// All 5 trackers — device ID → metadata
export const TRACKERS: Record<string, { label: string; imei: string; sim: string }> = {
  "ec86025d2be54efb96634bd437c56e23": { label: "LT01-TT200583", imei: "868720065061578", sim: "09111848135" },
  "791b7b56bacf4b84a8ff4e7a9c82309a": { label: "LT02-TT201376", imei: "868720065056750", sim: "09111848128" },
  "320cee40e50c441cb3b0e72b11c5692e": { label: "LT03-TT201390", imei: "868720065063178", sim: "09111848126" },
  "f59bbda3b8104ec5b4cafaf740e6e3ce": { label: "LT04-TT201631", imei: "868720065061412", sim: "09111848127" },
  "c35c83a5e069496a80b0e1d3f1878062": { label: "LT05-TT202356", imei: "868720065056487", sim: "09111848129" },
}

// WebSocket broadcast subscribers — registered by index.ts
type BroadcastFn = (locations: GPSLocation[]) => void
let _broadcast: BroadcastFn | null = null
export function registerBroadcast(fn: BroadcastFn) { _broadcast = fn }

class CantrackClient {
  private sessionCookie = env.CANTRACK_SESSION
  private seckeyCookie  = env.CANTRACK_SECKEY
  private bmapCookie    = env.CANTRACK_BMAP
  private liveCache     = new Map<string, GPSLocation>()
  private pollingTimer: ReturnType<typeof setInterval> | null = null
  private lastPollOk    = false

  // ─── Session cookies (can be refreshed via API) ───────────────────────────
  updateCookies(session: string, seckey = "", bmap = "") {
    this.sessionCookie = session
    if (seckey) this.seckeyCookie = seckey
    if (bmap)   this.bmapCookie   = bmap
    console.log("[cantrack] 🔄 Session cookies updated manually")
  }

  private cookies() {
    const parts: string[] = [
      `ASP.NET_SessionId=${this.sessionCookie}`,
      "domainIndex=0",
    ]
    if (this.seckeyCookie) parts.push(`SECKEY_ABVK=${this.seckeyCookie}`)
    if (this.bmapCookie)   parts.push(`BMAP_SECKEY=${this.bmapCookie}`)
    return parts.join("; ")
  }

  private headers() {
    return {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
      "Accept":     "text/javascript, application/javascript, */*; q=0.01",
      "X-Requested-With": "XMLHttpRequest",
      "Referer":    `${BASE}/user/tracking.html?mds=${MDS}&school_id=${SCHOOL_ID}&custid=${CUST_ID}&mapType=GOOGLE`,
      "Cookie":     this.cookies(),
    }
  }

  private isSessionExpired(text: string) {
    const t = text.trim().toLowerCase()
    return t.includes("loginouts") || t.includes("window.location") ||
           t.startsWith("<!doctype") || t.startsWith("<html") ||
           t.includes("login.aspx") || t.length < 10
  }

  // ─── Login via username + password (form POST) ───────────────────────────
  async login(): Promise<boolean> {
    try {
      const user = env.CANTRACK_USER || "LIEBE TAG LOGISTICS"
      const pass = env.CANTRACK_PASS || "123456"

      // Step 1 — GET login page to obtain initial session cookie
      const getResp = await fetch(`${BASE}/`, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
          "Accept":     "text/html,application/xhtml+xml,*/*;q=0.8",
        },
        redirect: "follow",
      })
      const getRaw = [
        getResp.headers.get("set-cookie") ?? "",
        ...(getResp.headers.getSetCookie?.() ?? []),
      ].join(";")
      const initSession = getRaw.match(/ASP\.NET_SessionId=([^;,\s]+)/)?.[1] ?? this.sessionCookie

      // Step 2 — POST credentials
      const form = new URLSearchParams({
        "loginformBase_username": user,
        "loginformBase_password": pass,
        "loginformBase_remember": "false",
        "formName":               "loginformBase",
      })

      const postResp = await fetch(`${BASE}/Skins/DefaultIndex/login.aspx`, {
        method:   "POST",
        headers: {
          "User-Agent":   "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
          "Content-Type": "application/x-www-form-urlencoded",
          "Referer":      `${BASE}/`,
          "Cookie":       `ASP.NET_SessionId=${initSession}`,
        },
        body:     form.toString(),
        redirect: "follow",
      })

      const all = [
        postResp.headers.get("set-cookie") ?? "",
        ...(postResp.headers.getSetCookie?.() ?? []),
      ].join(";")

      const session = all.match(/ASP\.NET_SessionId=([^;,\s]+)/)?.[1] ?? initSession
      const seckey  = all.match(/SECKEY_ABVK=([^;,\s]+)/)?.[1]
      const bmap    = all.match(/BMAP_SECKEY=([^;,\s]+)/)?.[1]

      if (session) {
        this.sessionCookie = session
        console.log(`[cantrack] ✅ Login OK — session: ${session.slice(0, 8)}…`)
      }
      if (seckey) { this.seckeyCookie = seckey; console.log("[cantrack] ✅ SECKEY obtained") }
      if (bmap)   { this.bmapCookie   = bmap;   console.log("[cantrack] ✅ BMAP obtained") }

      // Verify: if SECKEY set, login succeeded
      if (seckey) return true

      // Fallback: try MDS token URL approach
      const ts  = Date.now()
      const url = new URL(`${BASE}/user/index.aspx`)
      url.searchParams.set("login_id",  SCHOOL_ID)
      url.searchParams.set("mds",       MDS)
      url.searchParams.set("father_id", SCHOOL_ID)
      url.searchParams.set("isDealer",  "false")
      url.searchParams.set("r",         String(ts))

      const mdsResp = await fetch(url.toString(), {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
          "Cookie":     `ASP.NET_SessionId=${session}; domainIndex=0`,
        },
        redirect: "follow",
      })
      const mdsAll = [
        mdsResp.headers.get("set-cookie") ?? "",
        ...(mdsResp.headers.getSetCookie?.() ?? []),
      ].join(";")
      const mdsSeckey = mdsAll.match(/SECKEY_ABVK=([^;,\s]+)/)?.[1]
      const mdsBmap   = mdsAll.match(/BMAP_SECKEY=([^;,\s]+)/)?.[1]
      if (mdsSeckey) this.seckeyCookie = mdsSeckey
      if (mdsBmap)   this.bmapCookie   = mdsBmap

      return !!this.sessionCookie
    } catch (e) {
      console.error("[cantrack] Login error:", e)
      return false
    }
  }

  // ─── Parse plain JSON response from getUserAndGPSInfoUtcByIds ────────────
  // key mapping: 0=sys_time, 1=lng, 2=lat, 5=datetime, 7=speed, 9=heading, 10=user_id
  private parseResponse(text: string): Record<string, unknown> {
    if (this.isSessionExpired(text)) return {}
    try   { return JSON.parse(text) }
    catch { return {} }
  }

  private parseRecord(rec: unknown[]): GPSLocation | null {
    if (!Array.isArray(rec) || rec.length < 11) return null
    const lng = parseFloat(String(rec[1] ?? "0"))
    const lat = parseFloat(String(rec[2] ?? "0"))
    if (!lat && !lng) return null

    const uid     = String(rec[10] ?? "")
    const tracker = TRACKERS[uid]
    const tsRaw   = parseInt(String(rec[5] ?? "0"))

    return {
      deviceId:  uid,
      latitude:  lat,
      longitude: lng,
      speedKmh:  parseFloat(String(rec[7] ?? "0")),
      heading:   parseFloat(String(rec[9] ?? "0")),
      timestamp: tsRaw ? new Date(tsRaw).toISOString() : new Date().toISOString(),
      label:     tracker?.label ?? uid.slice(0, 8),
    }
  }

  // ─── Fetch all trackers ───────────────────────────────────────────────────
  private buildUrl(user_ids: string) {
    const url = new URL(`${BASE}/TrackService.aspx`)
    url.searchParams.set("method",    "getUserAndGPSInfoUtcByIds")
    url.searchParams.set("school_id", SCHOOL_ID)
    url.searchParams.set("custid",    CUST_ID)
    url.searchParams.set("user_ids",  user_ids)
    url.searchParams.set("mapType",   "GOOGLE")
    url.searchParams.set("option",    "en")
    url.searchParams.set("Selected",  "device")
    url.searchParams.set("currentid", CUST_ID)
    url.searchParams.set("update",    "1")
    url.searchParams.set("mds",       MDS)
    return url
  }

  // ─── Fetch all trackers ───────────────────────────────────────────────────
  async fetchAll(): Promise<GPSLocation[]> {
    const url = this.buildUrl(Object.keys(TRACKERS).join(","))

    const attempt = async () => {
      const r = await fetch(url.toString(), { headers: this.headers() })
      return r.text()
    }

    let text = await attempt()

    if (this.isSessionExpired(text)) {
      console.warn("[cantrack] Session expired — re-logging in…")
      const ok = await this.login()
      if (ok) text = await attempt()
      else {
        this.lastPollOk = false
        return [...this.liveCache.values()]
      }
    }

    const data    = this.parseResponse(text)
    const records = (data.records as unknown[][]) ?? []
    const results: GPSLocation[] = []

    for (const rec of records) {
      const loc = this.parseRecord(rec)
      if (loc) {
        this.liveCache.set(loc.deviceId, loc)
        results.push(loc)
      }
    }

    if (results.length > 0) {
      this.lastPollOk = true
      console.log(`[cantrack] 📡 Poll OK — ${results.length} tracker(s) live`)
      _broadcast?.(results)
    } else {
      console.warn("[cantrack] ⚠️  Poll returned 0 locations (auth ok but no data)")
    }

    return results
  }

  // ─── Fetch single tracker (uses cache if background poll is running) ───────
  async fetchOne(deviceId: string): Promise<GPSLocation | null> {
    const cached = this.liveCache.get(deviceId)
    if (cached && this.lastPollOk) return cached

    const url = this.buildUrl(deviceId)

    const attempt = async () => {
      const r = await fetch(url.toString(), { headers: this.headers() })
      return r.text()
    }

    let text = await attempt()
    if (this.isSessionExpired(text)) {
      await this.login()
      text = await attempt()
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

    return this.liveCache.get(deviceId) ?? null
  }

  // ─── Background polling ───────────────────────────────────────────────────
  startPolling(intervalMs = 30_000) {
    if (this.pollingTimer) return
    console.log(`[cantrack] 🔄 Starting background poll every ${intervalMs / 1000}s`)
    // First fetch immediately
    this.fetchAll().catch(e => console.error("[cantrack] Initial poll error:", e))
    this.pollingTimer = setInterval(() => {
      this.fetchAll().catch(e => console.error("[cantrack] Poll error:", e))
    }, intervalMs)
  }

  stopPolling() {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer)
      this.pollingTimer = null
      console.log("[cantrack] ⏹  Polling stopped")
    }
  }

  // ─── Cache accessors ──────────────────────────────────────────────────────
  getCache(deviceId: string): GPSLocation | null {
    return this.liveCache.get(deviceId) ?? null
  }

  getAllCached(): GPSLocation[] {
    return [...this.liveCache.values()]
  }

  isPolling() { return !!this.pollingTimer }
  lastPollSuccess() { return this.lastPollOk }
}

export const cantrack = new CantrackClient()
