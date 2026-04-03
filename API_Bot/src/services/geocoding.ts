// src/services/geocoding.ts
// Nominatim geocoding with Abuja geo-fence, landmark DB, and smart suggestions

import type { Location } from "../types/index.ts"

const BASE    = "https://nominatim.openstreetmap.org"
const HEADERS = { "User-Agent": "LiebeTagLogistics/4.0 (info@liebetag.com)" }

// Full FCT + border towns bounding box
const BOUNDS = { minLat: 8.40, maxLat: 9.50, minLng: 6.80, maxLng: 7.90 }
const VIEWBOX = `${BOUNDS.minLng},${BOUNDS.maxLat},${BOUNDS.maxLng},${BOUNDS.minLat}`

export function inAbuja(lat: number, lng: number) {
  return lat >= BOUNDS.minLat && lat <= BOUNDS.maxLat &&
         lng >= BOUNDS.minLng && lng <= BOUNDS.maxLng
}

// Known Abuja landmarks not in Nominatim
const LANDMARKS: Record<string, Location> = {
  "naf base":               { lat: 9.0579, lng: 7.4951, address: "Nigerian Air Force Base, Asokoro, Abuja" },
  "naf base asokoro":       { lat: 9.0579, lng: 7.4951, address: "Nigerian Air Force Base, Asokoro, Abuja" },
  "nigerian air force base":{ lat: 9.0579, lng: 7.4951, address: "Nigerian Air Force Base, Asokoro, Abuja" },
  "air force base abuja":   { lat: 9.0579, lng: 7.4951, address: "Nigerian Air Force Base, Asokoro, Abuja" },
  "aso rock":               { lat: 9.0417, lng: 7.4991, address: "Aso Rock, Abuja" },
  "aso villa":              { lat: 9.0417, lng: 7.4991, address: "Aso Villa (State House), Abuja" },
  "transcorp hilton":       { lat: 9.0724, lng: 7.4924, address: "Transcorp Hilton Hotel, Maitama, Abuja" },
  "nicon luxury":           { lat: 9.0579, lng: 7.4811, address: "Nicon Luxury Hotel, Central Area, Abuja" },
  "wuse market":            { lat: 9.0724, lng: 7.4640, address: "Wuse Market, Wuse, Abuja" },
  "jabi lake":              { lat: 9.0803, lng: 7.4393, address: "Jabi Lake Mall, Jabi, Abuja" },
  "banex plaza":            { lat: 9.0741, lng: 7.4516, address: "Banex Plaza, Wuse 2, Abuja" },
  "ceddi plaza":            { lat: 9.0603, lng: 7.4791, address: "Ceddi Plaza, Central Area, Abuja" },
  "mambilla barracks":      { lat: 9.0556, lng: 7.5025, address: "Mambilla Barracks, Asokoro, Abuja" },
  "army headquarters":      { lat: 9.0556, lng: 7.5025, address: "Army Headquarters, Mambilla Barracks, Abuja" },
  "force headquarters":     { lat: 9.0444, lng: 7.5050, address: "Force Headquarters, Area 11, Abuja" },
  "defence headquarters":   { lat: 9.0514, lng: 7.4978, address: "Defence Headquarters, Abuja" },
  "abuja airport":          { lat: 9.0068, lng: 7.2632, address: "Nnamdi Azikiwe International Airport, Abuja" },
  "nnamdi azikiwe airport": { lat: 9.0068, lng: 7.2632, address: "Nnamdi Azikiwe International Airport, Abuja" },
  "life camp":              { lat: 9.0928, lng: 7.3872, address: "Life Camp, Abuja" },
  "gwarinpa estate":        { lat: 9.1118, lng: 7.4195, address: "Gwarinpa Estate, Abuja" },
  "nizamiye hospital":      { lat: 9.0695, lng: 7.4457, address: "Nizamiye Hospital, Jabi, Abuja" },
  "garki hospital":         { lat: 9.0319, lng: 7.4819, address: "Garki Hospital, Garki, Abuja" },
  "national stadium":       { lat: 9.0232, lng: 7.4704, address: "National Stadium, Abuja" },
  "utako market":           { lat: 9.0765, lng: 7.4499, address: "Utako Market, Utako, Abuja" },
  "sheraton abuja":         { lat: 9.0724, lng: 7.4924, address: "Sheraton Abuja Hotel, Maitama, Abuja" },
  "citec estate":           { lat: 9.0834, lng: 7.3986, address: "Citec Estate, Mbora, Abuja" },
  "kubwa expressway":       { lat: 9.1286, lng: 7.3614, address: "Kubwa Expressway, Kubwa, Abuja" },
}

function lookupLandmark(query: string): Location | null {
  const q = query.toLowerCase().trim()
  if (LANDMARKS[q]) return LANDMARKS[q]!
  for (const [key, val] of Object.entries(LANDMARKS)) {
    if (key.includes(q) || q.includes(key)) return val
  }
  return null
}

function cleanAddress(displayName: string): string {
  if (!displayName) return ""
  return displayName.split(",").slice(0, 4).map(p => p.trim()).filter(Boolean).join(", ")
}

async function nominatim(query: string, limit = 5, bounded = true): Promise<Location[]> {
  const url = new URL(`${BASE}/search`)
  url.searchParams.set("q",            query)
  url.searchParams.set("format",       "json")
  url.searchParams.set("limit",        String(limit))
  url.searchParams.set("countrycodes", "ng")
  url.searchParams.set("viewbox",      VIEWBOX)
  url.searchParams.set("bounded",      bounded ? "1" : "0")

  try {
    const r    = await fetch(url.toString(), { headers: HEADERS })
    const data = await r.json() as Array<{ lat: string; lon: string; display_name: string }>
    return data
      .map(d => ({
        lat:     parseFloat(d.lat),
        lng:     parseFloat(d.lon),
        address: cleanAddress(d.display_name),
      }))
      .filter(l => inAbuja(l.lat, l.lng))
  } catch {
    return []
  }
}

export async function geocode(address: string): Promise<Location | null> {
  // 1. Landmark DB
  const lm = lookupLandmark(address)
  if (lm) return lm

  // 2. Nominatim with Abuja bias
  const q1 = address.toLowerCase().includes("abuja") ? address : `${address}, Abuja, Nigeria`
  const r1  = await nominatim(q1, 5, true)
  if (r1[0]) return r1[0]

  // 3. Without bounded
  const r2 = await nominatim(q1, 5, false)
  if (r2[0]) return r2[0]

  // 4. Strip common words and retry
  const cleaned = address.replace(/\b(abuja|fct|nigeria|base|barracks|estate|road|street|avenue|close|crescent)\b/gi, "").trim()
  if (cleaned && cleaned !== address) {
    const r3 = await nominatim(`${cleaned} Abuja`, 3, false)
    if (r3[0]) return r3[0]
  }

  return null
}

export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  try {
    const url = new URL(`${BASE}/reverse`)
    url.searchParams.set("lat",    String(lat))
    url.searchParams.set("lon",    String(lng))
    url.searchParams.set("format", "json")
    const r    = await fetch(url.toString(), { headers: HEADERS })
    const data = await r.json() as { display_name?: string }
    return data.display_name ? cleanAddress(data.display_name) : null
  } catch {
    return null
  }
}

export async function suggestAddresses(query: string, limit = 5): Promise<Location[]> {
  const results: Location[] = []

  // Landmark first
  const lm = lookupLandmark(query)
  if (lm) results.push(lm)

  // Nominatim suggestions
  const q    = query.toLowerCase().includes("abuja") ? query : `${query} Abuja`
  const sugg = await nominatim(q, limit + 2, true)
  for (const s of sugg) {
    if (!results.some(r => Math.abs(r.lat - s.lat) < 0.001)) {
      results.push(s)
    }
    if (results.length >= limit) break
  }

  // Try word variations if still empty
  if (results.length < 2) {
    const words = query.split(" ")
    for (let i = 0; i < words.length; i++) {
      const variant = words.filter((_, j) => j !== i).join(" ") + " Abuja"
      const more    = await nominatim(variant, 2, true)
      for (const s of more) {
        if (!results.some(r => Math.abs(r.lat - s.lat) < 0.001)) {
          results.push(s)
        }
      }
      if (results.length >= limit) break
    }
  }

  return results.slice(0, limit)
}
