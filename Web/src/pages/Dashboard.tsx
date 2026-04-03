// src/pages/Dashboard.tsx
import { useEffect, useState } from "react"
import { Package, Truck, Bike, ClipboardList, RefreshCw, Wifi, WifiOff } from "lucide-react"
import { api, type DashboardStats, type Order, type Errand } from "../services/api.ts"
import StatusBadge from "../components/StatusBadge.tsx"

export default function Dashboard() {
  const [stats,    setStats]    = useState<DashboardStats | null>(null)
  const [orders,   setOrders]   = useState<Order[]>([])
  const [errands,  setErrands]  = useState<Errand[]>([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState("")
  const [lastSync, setLastSync] = useState<Date | null>(null)

  const load = async () => {
    setLoading(true); setError("")
    try {
      const [s, o, e] = await Promise.all([
        api.health(),
        api.searchOrders(""),
        api.searchErrands(""),
      ])
      setStats(s)
      setOrders(o.orders.slice(0, 8))
      setErrands(e.errands.slice(0, 5))
      setLastSync(new Date())
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load(); const t = setInterval(load, 30_000); return () => clearInterval(t) }, [])

  const activeOrders  = orders.filter(o => !["delivered","cancelled"].includes(o.status)).length
  const todayDeliveries = orders.filter(o => o.status === "delivered" && o.deliveredAt?.startsWith(new Date().toISOString().slice(0,10))).length
  const pendingPayment  = orders.filter(o => o.paymentStatus === "pending").length

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Dashboard</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            {lastSync ? `Last updated ${lastSync.toLocaleTimeString()}` : "Loading…"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {stats ? (
            <span className="badge-green"><Wifi size={12} /> Live</span>
          ) : error ? (
            <span className="badge-red"><WifiOff size={12} /> Offline</span>
          ) : null}
          <button onClick={load} className="btn-ghost flex items-center gap-2 text-sm" disabled={loading}>
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-red-400 text-sm">{error}</div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={<Package size={20} />} label="Active Orders"    value={activeOrders}       color="yellow" />
        <StatCard icon={<Bike    size={20} />} label="GPS Live"         value={stats?.gpsLive ?? 0}  color="green"  />
        <StatCard icon={<Truck   size={20} />} label="Today Delivered"  value={todayDeliveries}    color="blue"   />
        <StatCard icon={<ClipboardList size={20} />} label="Pending Payment" value={pendingPayment} color="red"    />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent orders */}
        <div className="card">
          <h2 className="font-semibold mb-4 flex items-center gap-2"><Package size={16} className="text-brand" /> Recent Orders</h2>
          {orders.length === 0 ? (
            <p className="text-slate-500 text-sm text-center py-6">No orders yet</p>
          ) : (
            <div className="space-y-3">
              {orders.map(o => (
                <div key={o.id} className="flex items-center justify-between py-2 border-b border-dark-border last:border-0">
                  <div className="min-w-0">
                    <p className="text-sm font-mono text-brand truncate">{o.orderRef}</p>
                    <p className="text-xs text-slate-400 truncate">{o.senderName || o.senderPhone} → {o.recipientName || o.recipientPhone}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                    <span className="text-xs text-slate-400">₦{o.fareTotal.toLocaleString()}</span>
                    <StatusBadge status={o.status} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent errands */}
        <div className="card">
          <h2 className="font-semibold mb-4 flex items-center gap-2"><ClipboardList size={16} className="text-brand" /> Recent Errands</h2>
          {errands.length === 0 ? (
            <p className="text-slate-500 text-sm text-center py-6">No errands yet</p>
          ) : (
            <div className="space-y-3">
              {errands.map(e => (
                <div key={e.id} className="flex items-center justify-between py-2 border-b border-dark-border last:border-0">
                  <div className="min-w-0">
                    <p className="text-sm font-mono text-purple-400 truncate">{e.errandRef}</p>
                    <p className="text-xs text-slate-400 truncate">{e.errandType.replace("_"," ")} — {e.taskDescription.slice(0,40)}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                    <span className="text-xs text-slate-400">₦{e.totalCharge.toLocaleString()}</span>
                    <StatusBadge status={e.status} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color: string }) {
  const colors: Record<string, string> = {
    yellow: "bg-yellow-500/10 text-yellow-400",
    green:  "bg-green-500/10 text-green-400",
    blue:   "bg-blue-500/10 text-blue-400",
    red:    "bg-red-500/10 text-red-400",
  }
  return (
    <div className="card flex items-center gap-4">
      <div className={`p-3 rounded-xl ${colors[color] ?? colors.blue}`}>{icon}</div>
      <div>
        <p className="text-2xl font-bold">{value}</p>
        <p className="text-xs text-slate-400">{label}</p>
      </div>
    </div>
  )
}
