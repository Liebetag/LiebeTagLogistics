// src/services/api.ts
// API client for Liebe Tag Logistics backend

function headers(extraHeaders?: Record<string, string>) {
  const token = localStorage.getItem("lt_admin_token") || ""
  return {
    "Content-Type": "application/json",
    "X-API-Key":    localStorage.getItem("lt_api_key") || "",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
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

async function publicPost<T>(path: string, body: unknown): Promise<T> {
  const base = localStorage.getItem("lt_api_url") || "https://liebetaglogistics-api.onrender.com"
  let r: Response
  try {
    r = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  } catch {
    throw new Error(`Could not reach the Liebe Tag API at ${base}. Check API deployment, API URL, and CORS settings.`)
  }
  const data = await r.json().catch(() => ({})) as any
  if (!r.ok || data?.ok === false) throw new Error(data?.error || `${r.status} ${r.statusText}`)
  return data as T
}

async function publicAdminPost<T>(path: string, body: unknown): Promise<T> {
  const base = localStorage.getItem("lt_api_url") || "https://liebetaglogistics-api.onrender.com"
  const r = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const data = await r.json().catch(() => ({})) as any
  if (!r.ok || data?.ok === false) throw new Error(data?.error || `${r.status} ${r.statusText}`)
  return data as T
}

async function portalGet<T>(path: string, token: string): Promise<T> {
  const base = localStorage.getItem("lt_api_url") || "https://liebetaglogistics-api.onrender.com"
  const r = await fetch(`${base}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
  return r.json() as T
}

async function portalPost<T>(path: string, token: string, body: unknown): Promise<T> {
  const base = localStorage.getItem("lt_api_url") || "https://liebetaglogistics-api.onrender.com"
  const r = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  const data = await r.json().catch(() => ({})) as any
  if (!r.ok || data?.ok === false) throw new Error(data?.error || `${r.status} ${r.statusText}`)
  return data as T
}

// ─── Types ────────────────────────────────────────────────────────────────────
export interface GPSTracker {
  deviceId:  string
  latitude:  number | null
  longitude: number | null
  speedKmh:  number
  heading:   number
  timestamp: string
  label:     string
  status?:   "online" | "offline"
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

export interface Customer {
  id:         string
  phone:      string
  name:       string
  role:       string
  joinedAt:   string
  lastSeen:   string
  orderCount: number
}

export interface AllocationRequest {
  id:          string
  riderPhone:  string
  riderName:   string
  deviceId:    string
  deviceLabel: string
  status:      string
  requestedAt: string
  reviewedAt?: string
  reviewedBy?: string
  note:        string
}

export interface DashboardStats {
  activeOrders:  number
  gpsTrackers:   number
  gpsLive:       number
}

export interface AdminUser {
  id: string
  phone: string
  name: string
  role: "super_admin" | "admin" | "operations" | "viewer"
  permissions: Record<string, boolean>
  status: "active" | "disabled"
  createdAt: string
  createdBy: string
  lastLoginAt?: string
}

export interface PortalLocation {
  lat: number
  lng: number
  address?: string
}

// ─── API calls ────────────────────────────────────────────────────────────────
export const api = {
  adminLogin:   (phone: string, password: string) => publicAdminPost<{ ok: boolean; token: string; admin: AdminUser }>("/admin/auth/login", { phone, password }),
  adminMe:      () => get<{ admin: AdminUser }>("/admin/me"),
  adminUsers:   () => get<{ admins: AdminUser[] }>("/admin/users"),
  createAdmin:  (body: { phone: string; name: string; password: string; role: AdminUser["role"]; permissions: Record<string, boolean> }) =>
    post<{ ok: boolean; admin: AdminUser }>("/admin/users", body),
  health:       () => get<DashboardStats>("/"),
  liveTrackers: () => get<{ count: number; trackers: GPSTracker[] }>("/trackers/live"),
  tracker:      (id: string) => get<GPSTracker>(`/location/${id}`),
  searchOrders: (q: string) => get<{ count: number; orders: Order[] }>(`/orders/search?q=${encodeURIComponent(q)}`),
  getOrder:     (ref: string) => get<Order>(`/orders/${ref}`),
  searchErrands:(q: string) => get<{ count: number; errands: Errand[] }>(`/errands/search?q=${encodeURIComponent(q)}`),
  searchCustomers:(q: string) => get<{ count: number; customers: Customer[] }>(`/customers/search?q=${encodeURIComponent(q)}`),
  getRiders:    () => get<{ count: number; riders: Rider[] }>("/riders"),
  riderBalance: (phone: string) => get<Rider>(`/riders/${phone}/balance`),
  allocationRequests: (status = "pending") => get<{ count: number; requests: AllocationRequest[] }>(`/admin/allocation-requests?status=${encodeURIComponent(status)}`),
  approveAllocation: (id: string) => post<{ ok: boolean; request: AllocationRequest }>(`/admin/allocation-requests/${id}/approve`, {}),
  rejectAllocation:  (id: string, note = "") => post<{ ok: boolean }>(`/admin/allocation-requests/${id}/reject`, { note }),
  unassignBike:      (phone: string) => post<{ ok: boolean }>(`/riders/${phone}/unassign-bike`, {}),
  requestPortalOtp:  (phone: string) => publicPost<{ ok: boolean; phone: string }>("/portal/auth/request-otp", { phone }),
  verifyPortalOtp:   (phone: string, code: string) => publicPost<{ ok: boolean; token: string }>("/portal/auth/verify-otp", { phone, code }),
  portalMe:          (token: string) => portalGet<{ user: { phone: string; name: string } | null; orders: Order[]; errands: Errand[] }>("/portal/me", token),
  portalChat:        (token: string, message: string, location?: PortalLocation) =>
    portalPost<{ ok: boolean; state: string }>("/portal/chat", token, { message, ...(location ? { location } : {}) }),
}
