// src/services/cantrack.ts
// Cantrack GPS tracker integration
// Uses GET token-based login (not username/password)

import { env } from "../utils/env.ts"
import type { GPSLocation } from "../types/index.ts"

const BASE = "https://www.cantrackportal.com"
const SCHOOL_ID = env.CANTRACK_SCHOOL_ID
const CUST_ID   = env.CANTRACK_CUST_ID
const MDS       = env.CANTRACK_MDS

// All 5 trackers
export const TRACKERS: Record<string, { label: string; imei: string; sim: string }> = {
  "ec86025d2be54efb96634bd437c56e23": { label: "LT01-TT200583", imei: "868720065061578", sim: "09111848135" },
  "791b7b56bacf4b84a8ff4e7a9c82309a": { label: "LT02-TT201376", imei: "868720065056750", sim: "09111848128" },
  "320cee40e50c441cb3b0e72b11c5692e": { label: "LT03-TT201390", imei: "868720065063178", sim: "09111848126" },
  "f59bbda3b8104ec5b4cafaf740e6e3ce": { label: "LT04-TT201631", imei: "868720065061412", sim: "09111848127" },
  "c35c83a5e069496a80b0e1d3f1878062": { label: "LT05-TT202356", imei: "868720065056487", sim: "09111848129" },
}

class CantrackClient {
  private sessionCookie = env.CANTRACK_SESSION
  private seckeyCookie  = env.CANTRACK_SECKEY
  private bmapCookie    = env.CANTRACK_BMAP
  private liveCache     = new Map<string, GPSLocation>()
  private lastLogin     = 0

  private cookies() {
    const c: Record<string, string> = {
      "ASP.NET_SessionId": this.sessionCookie || env.CANTRACK_SESSION,
      "domainIndex": "2",
    }
    const sk = this.seckeyCookie || env.CANTRACK_SECKEY
    const bm = this.bmapCookie   || env.CANTRACK_BMAP
    if (sk) c["SECKEY_ABVK"] = sk
    if (bm) c["BMAP_SECKEY"] = bm
    return Object.entries(c).map(([k, v]) => `${k}=${v}`).join("; ")
  }

  private headers() {
    return {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/146.0.0.0 Safari/537.36",
      "Accept": "*/*",
      "Cookie": this.cookies(),
      "Referer": `${BASE}/user/tracking.html?mds=${MDS}&school_id=${SCHOOL_ID}&custid=${CUST_ID}&mapType=GOOGLE`,
    }
  }

  private isExpired(text: string) {
    const t = text.trim().toLowerCase()
    return t.includes("loginouts") || t.includes("window.location") ||
           t.startsWith("<!doctype") || t.startsWith("<html") || t.length < 10
  }

  async login(): Promise<boolean> {
    const r = Date.now()
    try {
      const url = new URL(`${BASE}/user/index.aspx`)
      url.searchParams.set("logOut", "")
      url.searchParams.set("login_id", SCHOOL_ID)
      url.searchParams.set("mds", MDS)
      url.searchParams.set("father_id", SCHOOL_ID)
      url.searchParams.set("isDealer", "false")
      url.searchParams.set("r", String(r))

      const resp = await fetch(url.toString(), {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/146.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
          "Referer": BASE + "/",
        },
        redirect: "follow",
      })

      const setCookies = resp.headers.getSetCookie?.() ?? []
      const cookieStr  = (resp.headers.get("set-cookie") ?? "") + setCookies.join(";")

      const sessionMatch = cookieStr.match(/ASP\.NET_SessionId=([^;,\s]+)/)
      const seckeyMatch  = cookieStr.match(/SECKEY_ABVK=([^;,\s]+)/)
      const bmapMatch    = cookieStr.match(/BMAP_SECKEY=([^;,\s]+)/)

      if (sessionMatch) {
        this.sessionCookie = sessionMatch[1]
        console.log(`[cantrack] ✅ Session: ${this.sessionCookie.slice(0, 8)}…`)
      }
      if (seckeyMatch) this.seckeyCookie = seckeyMatch[1]
      if (bmapMatch)   this.bmapCookie   = bmapMatch[1]

      this.lastLogin = Date.now()
      const body = await resp.text()
      if (body.includes("loginouts")) {
        console.error("[cantrack] ❌ Login returned logout JS — check MDS token:", MDS.slice(0, 8))
        return false
      }
      return !!this.sessionCookie
    } catch (e) {
      console.error("[cantrack] Login error:", e)
      return false
    }
  }

  private parseJsonp(text: string): Record<string, unknown> {
    const match = text.match(/updateDataCallBack\s*\(([\s\S]*)\)\s*;?\s*$/)
    if (!match) return {}
    try { return JSON.parse(match[1]) }
    catch { return {} }
  }

  private parseRecord(rec: unknown[]): GPSLocation | null {
    if (!Array.isArray(rec) || rec.length < 11) return null
    const lat = parseFloat(String(rec[2] ?? "0"))
    const lng = parseFloat(String(rec[1] ?? "0"))
    if (lat === 0 && lng === 0) return null

    const uid = String(rec[10] ?? "")
    const tracker = TRACKERS[uid]

    return {
      deviceId:  uid,
      latitude:  lat,
      longitude: lng,
      speedKmh:  parseFloat(String(rec[7] ?? "0")),
      heading:   parseFloat(String(rec[9] ?? "0")),
      timestamp: new Date(parseInt(String(rec[5] ?? "0"))).toISOString(),
      label:     tracker?.label ?? uid.slice(0, 8),
    }
  }

  async fetchAll(): Promise<GPSLocation[]> {
    const ts      = Date.now()
    const userIDs = Object.keys(TRACKERS).join(",")
    const url     = new URL(`${BASE}/TrackService.aspx`)

    url.searchParams.set("method",    "getOnlineGpsInfoByIDUtc")
    url.searchParams.set("callback",  "TrackOBJ.updateDataCallBack")
    url.searchParams.set("school_id", SCHOOL_ID)
    url.searchParams.set("custid",    CUST_ID)
    url.searchParams.set("userIDs",   userIDs)
    url.searchParams.set("mapType",   "GOOGLE")
    url.searchParams.set("option",    "en")
    url.searchParams.set("t",         String(ts))
    url.searchParams.set("mds",       MDS)
    url.searchParams.set("timestamp", String(ts))

    const attempt = async () => {
      const r = await fetch(url.toString(), { headers: this.headers() })
      return r.text()
    }

    let text = await attempt()

    if (this.isExpired(text)) {
      console.warn("[cantrack] Session expired — re-logging in…")
      await this.login()
      text = await attempt()
    }

    const data    = this.parseJsonp(text)
    const records = (data.records as unknown[][]) ?? []
    const results: GPSLocation[] = []

    for (const rec of records) {
      const loc = this.parseRecord(rec)
      if (loc) {
        this.liveCache.set(loc.deviceId, loc)
        results.push(loc)
      }
    }

    return results
  }

  async fetchOne(deviceId: string): Promise<GPSLocation | null> {
    const ts  = Date.now()
    const url = new URL(`${BASE}/TrackService.aspx`)
    url.searchParams.set("method",    "getOnlineGpsInfoByIDUtc")
    url.searchParams.set("callback",  "TrackOBJ.updateDataCallBack")
    url.searchParams.set("school_id", SCHOOL_ID)
    url.searchParams.set("custid",    CUST_ID)
    url.searchParams.set("userIDs",   deviceId)
    url.searchParams.set("mapType",   "GOOGLE")
    url.searchParams.set("option",    "en")
    url.searchParams.set("t",         String(ts))
    url.searchParams.set("mds",       MDS)
    url.searchParams.set("timestamp", String(ts))

    const attempt = async () => {
      const r = await fetch(url.toString(), { headers: this.headers() })
      return r.text()
    }

    let text = await attempt()
    if (this.isExpired(text)) {
      await this.login()
      text = await attempt()
    }

    const data = this.parseJsonp(text)
    const recs = (data.records as unknown[][]) ?? []

    for (const rec of recs) {
      const loc = this.parseRecord(rec)
      if (loc) {
        this.liveCache.set(loc.deviceId, loc)
        return loc
      }
    }

    // Return cached location if available
    return this.liveCache.get(deviceId) ?? null
  }

  getCache(deviceId: string): GPSLocation | null {
    return this.liveCache.get(deviceId) ?? null
  }

  getAllCached(): GPSLocation[] {
    return [...this.liveCache.values()]
  }
}

export const cantrack = new CantrackClient()
