// src/services/api.ts
// API client for Liebe Tag Logistics backend

const BASE_URL = localStorage.getItem("lt_api_url") || ""
const API_KEY  = localStorage.getItem("lt_api_key") || ""

function headers(extraHeaders?: Record<string, string>) {
  return {
    "Content-Type": "application/json",
    "X-API-Key":    localStorage.getItem("lt_api_key") || "",
    ...extraHeaders,
  }
}

async function get<T>(path: string): Promise<T> {
  const base = localStorage.getItem("lt_api_url") || ""
  const r    = await fetch(`${base}${path}`, { headers: headers() })
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
  return r.json() as T
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const base = localStorage.getItem("lt_api_url") || ""
  const r    = await fetch(`${base}${path}`, {
    method:  "POST",
    headers: headers(),
    body:    JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
  return r.json() as T
}

// ─── Types ────────────────────────────────────────────────────────────────────
export interface GPSTracker {
  deviceId:  string
  latitude:  number
  longitude: number
  speedKmh:  number
  heading:   number
  timestamp: string
  label:     string
  battery?:  number
}

export interface Order {
  id:             string
  orderRef:       string
  orderNumber:    string
  status:         string
  senderPhone:    string
  senderName:     string
  recipientPhone: string
  recipientName:  string
  riderPhone:     string
  packageDesc:    string
  weightKg:       number
  fragile:        boolean
  deliveryType:   string
  fareTotal:      number
  paymentType:    string
  paymentStatus:  string
  createdAt:      string
  paidAt?:        string
  assignedAt?:    string
  pickedUpAt?:    string
  deliveredAt?:   string
  pickupJson:     string
  dropoffJson:    string
}

export interface Errand {
  id:              string
  errandRef:       string
  errandNumber:    string
  status:          string
  clientPhone:     string
  errandType:      string
  taskDescription: string
  locationJson:    string
  errandFee:       number
  itemCost:        number
  totalCharge:     number
  paymentType:     string
  createdAt:       string
  completedAt?:    string
}

export interface Rider {
  id:         string
  phone:      string
  name:       string
  deviceId:   string
  balance:    number
  totalEarned: number
  isActive:   boolean
}

export interface DashboardStats {
  activeOrders:  number
  gpsTrackers:   number
  gpsLive:       number
}

// ─── API calls ────────────────────────────────────────────────────────────────
export const api = {
  health:       () => get<DashboardStats>("/"),
  liveTrackers: () => get<{ count: number; trackers: GPSTracker[] }>("/trackers/live"),
  tracker:      (id: string) => get<GPSTracker>(`/location/${id}`),
  searchOrders: (q: string) => get<{ count: number; orders: Order[] }>(`/orders/search?q=${encodeURIComponent(q)}`),
  getOrder:     (ref: string) => get<Order>(`/orders/${ref}`),
  searchErrands:(q: string) => get<{ count: number; errands: Errand[] }>(`/errands/search?q=${encodeURIComponent(q)}`),
  getRiders:    () => get<{ count: number; riders: Rider[] }>("/riders"),
  riderBalance: (phone: string) => get<Rider>(`/riders/${phone}/balance`),
}
