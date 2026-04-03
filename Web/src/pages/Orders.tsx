// src/pages/Orders.tsx
import { useEffect, useState } from "react"
import { Search, Package, MapPin, Phone, ChevronDown, ChevronUp } from "lucide-react"
import { api, type Order } from "../services/api.ts"
import StatusBadge from "../components/StatusBadge.tsx"

export default function Orders() {
  const [orders,  setOrders]  = useState<Order[]>([])
  const [query,   setQuery]   = useState("")
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  const search = async (q = query) => {
    setLoading(true)
    try {
      const { orders: data } = await api.searchOrders(q)
      setOrders(data)
    } catch {}
    setLoading(false)
  }

  useEffect(() => { search("") }, [])

  const toggle = (id: string) => setExpanded(prev => prev === id ? null : id)

  const pickup  = (o: Order) => tryParse(o.pickupJson)
  const dropoff = (o: Order) => tryParse(o.dropoffJson)

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Orders</h1>
        <span className="badge-blue">{orders.length} results</span>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          className="input w-full pl-9"
          placeholder="Search by tracking ref, order number, or phone…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === "Enter" && search()}
        />
        <button onClick={() => search()} className="absolute right-2 top-1/2 -translate-y-1/2 btn-primary text-xs px-3 py-1.5">
          Search
        </button>
      </div>

      {/* Orders list */}
      <div className="space-y-2">
        {loading && <p className="text-slate-400 text-sm text-center py-8">Loading…</p>}
        {!loading && orders.length === 0 && (
          <p className="text-slate-500 text-sm text-center py-12">No orders found</p>
        )}
        {orders.map(o => (
          <div key={o.id} className="card overflow-hidden">
            {/* Row */}
            <button className="w-full flex items-center gap-3 text-left" onClick={() => toggle(o.id)}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-sm text-brand">{o.orderRef}</span>
                  <span className="text-xs text-slate-500">{o.orderNumber}</span>
                  <StatusBadge status={o.status} />
                  {o.deliveryType !== "NORMAL" && (
                    <span className={`badge ${o.deliveryType === "PRIORITY" ? "badge-red" : "badge-purple"}`}>
                      {o.deliveryType}
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-400 mt-0.5 truncate">
                  {o.senderName || o.senderPhone} → {o.recipientName || o.recipientPhone}
                </p>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <span className="text-sm font-medium">₦{o.fareTotal.toLocaleString()}</span>
                {expanded === o.id ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
              </div>
            </button>

            {/* Expanded detail */}
            {expanded === o.id && (
              <div className="mt-4 pt-4 border-t border-dark-border grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div className="space-y-2">
                  <Detail label="Order Number"  value={o.orderNumber} mono />
                  <Detail label="Tracking Ref"  value={o.orderRef} mono />
                  <Detail label="Status"         value={<StatusBadge status={o.status} />} />
                  <Detail label="Payment"        value={<StatusBadge status={o.paymentStatus} />} />
                  <Detail label="Payment Type"   value={o.paymentType} />
                  <Detail label="Delivery Type"  value={o.deliveryType} />
                  <Detail label="Fare"           value={`₦${o.fareTotal.toLocaleString()}`} />
                  <Detail label="Package"        value={`${o.packageDesc} · ${o.weightKg}kg${o.fragile ? " ⚠️" : ""}`} />
                </div>
                <div className="space-y-2">
                  <Detail label="Sender"    value={o.senderName}    />
                  <Detail label="Sender Ph" value={o.senderPhone}   />
                  <Detail label="Receiver"  value={o.recipientName} />
                  <Detail label="Recv Ph"   value={o.recipientPhone}/>
                  {o.riderPhone && <Detail label="Rider" value={o.riderPhone} />}
                  <Detail label="Pickup"    value={pickup(o)?.address}  />
                  <Detail label="Drop-off"  value={dropoff(o)?.address} />
                  <Detail label="Created"   value={fmt(o.createdAt)} />
                  {o.deliveredAt && <Detail label="Delivered" value={fmt(o.deliveredAt)} />}
                </div>
                {/* Map links */}
                <div className="md:col-span-2 flex gap-3 pt-2">
                  {pickup(o)?.lat && (
                    <a href={`https://maps.google.com/?q=${pickup(o)!.lat},${pickup(o)!.lng}`}
                      target="_blank" rel="noreferrer"
                      className="text-xs text-brand/70 hover:text-brand flex items-center gap-1">
                      <MapPin size={12} /> Pickup
                    </a>
                  )}
                  {dropoff(o)?.lat && (
                    <a href={`https://maps.google.com/?q=${dropoff(o)!.lat},${dropoff(o)!.lng}`}
                      target="_blank" rel="noreferrer"
                      className="text-xs text-brand/70 hover:text-brand flex items-center gap-1">
                      <MapPin size={12} /> Drop-off
                    </a>
                  )}
                  {o.senderPhone && (
                    <a href={`tel:+${o.senderPhone}`}
                      className="text-xs text-green-400/70 hover:text-green-400 flex items-center gap-1">
                      <Phone size={12} /> Call Sender
                    </a>
                  )}
                  {o.recipientPhone && (
                    <a href={`tel:+${o.recipientPhone}`}
                      className="text-xs text-green-400/70 hover:text-green-400 flex items-center gap-1">
                      <Phone size={12} /> Call Receiver
                    </a>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function Detail({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  if (!value) return null
  return (
    <div className="flex items-start gap-2">
      <span className="text-slate-500 w-28 flex-shrink-0">{label}</span>
      <span className={`text-slate-200 break-all ${mono ? "font-mono text-xs" : ""}`}>{value}</span>
    </div>
  )
}

function tryParse(json: string): { lat?: number; lng?: number; address?: string } | null {
  try { return JSON.parse(json) } catch { return null }
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString("en-NG", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" })
}
