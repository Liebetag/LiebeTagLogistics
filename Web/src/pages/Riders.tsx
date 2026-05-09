// src/pages/Riders.tsx
import { useEffect, useState } from "react"
import { Users, Phone, Bike, TrendingUp, Check, X, Unlink } from "lucide-react"
import { api, type AllocationRequest, type Rider } from "../services/api.ts"

export default function Riders() {
  const [riders,  setRiders]  = useState<Rider[]>([])
  const [requests, setRequests] = useState<AllocationRequest[]>([])
  const [loading, setLoading] = useState(false)

  const load = () => {
    setLoading(true)
    Promise.all([api.getRiders(), api.allocationRequests("pending")])
      .then(([r, a]) => { setRiders(r.riders); setRequests(a.requests) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const approve = async (id: string) => { await api.approveAllocation(id); load() }
  const reject = async (id: string) => { await api.rejectAllocation(id); load() }
  const unassign = async (phone: string) => { await api.unassignBike(phone); load() }

  const totalEarned  = riders.reduce((s, r) => s + r.totalEarned,  0)
  const totalBalance = riders.reduce((s, r) => s + r.balance, 0)

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-bold">Riders</h1>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card text-center">
          <p className="text-2xl font-bold">{riders.length}</p>
          <p className="text-xs text-slate-400 mt-1">Total Riders</p>
        </div>
        <div className="card text-center">
          <p className="text-2xl font-bold text-yellow-400">₦{totalBalance.toLocaleString()}</p>
          <p className="text-xs text-slate-400 mt-1">Pending Settlement</p>
        </div>
        <div className="card text-center">
          <p className="text-2xl font-bold text-green-400">₦{totalEarned.toLocaleString()}</p>
          <p className="text-xs text-slate-400 mt-1">All-time Earnings</p>
        </div>
      </div>

      {requests.length > 0 && (
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Bike Allocation Requests</h2>
            <span className="badge-yellow">{requests.length} pending</span>
          </div>
          <div className="space-y-2">
            {requests.map(req => (
              <div key={req.id} className="flex flex-wrap items-center gap-3 border-t border-dark-border pt-3 first:border-t-0 first:pt-0">
                <div className="flex-1 min-w-56">
                  <p className="font-medium">{req.riderName || req.riderPhone}</p>
                  <p className="text-xs text-slate-400">+{req.riderPhone} requested {req.deviceLabel}</p>
                </div>
                <button onClick={() => approve(req.id)} className="btn-primary flex items-center gap-1.5 text-xs px-3 py-1.5">
                  <Check size={12} /> Approve
                </button>
                <button onClick={() => reject(req.id)} className="btn-ghost flex items-center gap-1.5 text-xs px-3 py-1.5">
                  <X size={12} /> Reject
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Rider cards */}
      {loading && <p className="text-slate-400 text-sm text-center py-8">Loading…</p>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {riders.map(r => (
          <div key={r.id} className="card space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-brand/20 flex items-center justify-center text-brand font-bold">
                {(r.name || r.phone).slice(0, 1).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{r.name || "Unnamed rider"}</p>
                <p className="text-xs text-slate-400">+{r.phone}</p>
              </div>
              <span className={`badge ${r.isActive ? "badge-green" : "badge-red"}`}>
                {r.isActive ? "Active" : "Inactive"}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-dark-border">
              <div>
                <p className="text-xs text-slate-400 flex items-center gap-1"><TrendingUp size={11} /> Total Earned</p>
                <p className="font-semibold text-green-400">₦{r.totalEarned.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400">Pending</p>
                <p className="font-semibold text-yellow-400">₦{r.balance.toLocaleString()}</p>
              </div>
            </div>

            {r.deviceId && (
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <Bike size={12} /> Device: <span className="font-mono">{r.deviceId.slice(0, 12)}…</span>
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <a href={`tel:+${r.phone}`}
                className="btn-ghost flex items-center gap-1.5 text-xs flex-1 justify-center py-1.5">
                <Phone size={12} /> Call
              </a>
              <a href={`https://wa.me/${r.phone}`} target="_blank" rel="noreferrer"
                className="btn-primary flex items-center gap-1.5 text-xs flex-1 justify-center py-1.5">
                WhatsApp
              </a>
              {r.deviceId && (
                <button onClick={() => unassign(r.phone)}
                  className="btn-ghost flex items-center gap-1.5 text-xs flex-1 justify-center py-1.5">
                  <Unlink size={12} /> Unassign
                </button>
              )}
            </div>
          </div>
        ))}
        {!loading && riders.length === 0 && (
          <div className="md:col-span-2 text-center py-12 text-slate-500">
            <Users size={32} className="mx-auto mb-3 opacity-30" />
            <p>No riders registered yet</p>
          </div>
        )}
      </div>
    </div>
  )
}
