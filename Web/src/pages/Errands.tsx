// src/pages/Errands.tsx
import { useEffect, useState } from "react"
import { Search, ClipboardList, ChevronDown, ChevronUp, Phone } from "lucide-react"
import { api, type Errand } from "../services/api.ts"
import StatusBadge from "../components/StatusBadge.tsx"

const TYPE_EMOJI: Record<string, string> = {
  SHOPPING: "🛒", BANK: "🏦", PHARMACY: "💊", FOOD_PICKUP: "🍽️",
  DOCUMENT: "📋", COLLECTION: "📦", OTHER: "✏️",
}

export default function Errands() {
  const [errands, setErrands]  = useState<Errand[]>([])
  const [query,   setQuery]    = useState("")
  const [loading, setLoading]  = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  const search = async (q = query) => {
    setLoading(true)
    try {
      const { errands: data } = await api.searchErrands(q)
      setErrands(data)
    } catch {}
    setLoading(false)
  }

  useEffect(() => { search("") }, [])

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Errands</h1>
        <span className="badge-purple">{errands.length} results</span>
      </div>

      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input className="input w-full pl-9" placeholder="Search by ref, client phone…"
          value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === "Enter" && search()} />
        <button onClick={() => search()} className="absolute right-2 top-1/2 -translate-y-1/2 btn-primary text-xs px-3 py-1.5">
          Search
        </button>
      </div>

      <div className="space-y-2">
        {loading && <p className="text-slate-400 text-sm text-center py-8">Loading…</p>}
        {!loading && errands.length === 0 && <p className="text-slate-500 text-sm text-center py-12">No errands found</p>}
        {errands.map(e => (
          <div key={e.id} className="card overflow-hidden">
            <button className="w-full flex items-center gap-3 text-left" onClick={() => setExpanded(p => p === e.id ? null : e.id)}>
              <span className="text-xl">{TYPE_EMOJI[e.errandType] ?? "✏️"}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-sm text-purple-400">{e.errandRef}</span>
                  <StatusBadge status={e.status} />
                  <span className="badge badge-purple">{e.errandType.replace("_"," ")}</span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5 truncate">{e.taskDescription.slice(0, 60)}</p>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <span className="text-sm font-medium">₦{e.totalCharge.toLocaleString()}</span>
                {expanded === e.id ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
              </div>
            </button>

            {expanded === e.id && (
              <div className="mt-4 pt-4 border-t border-dark-border space-y-2 text-sm">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <EDetail label="Errand Ref"    value={e.errandRef} />
                    <EDetail label="Ref Number"    value={e.errandNumber} />
                    <EDetail label="Type"          value={e.errandType.replace("_"," ")} />
                    <EDetail label="Client"        value={e.clientPhone} />
                    <EDetail label="Errand Fee"    value={`₦${e.errandFee.toLocaleString()}`} />
                    {e.itemCost > 0 && <EDetail label="Item Cost" value={`₦${e.itemCost.toLocaleString()}`} />}
                    <EDetail label="Total"         value={`₦${e.totalCharge.toLocaleString()}`} />
                  </div>
                  <div className="space-y-2">
                    <EDetail label="Status"      value={<StatusBadge status={e.status} />} />
                    <EDetail label="Payment"     value={e.paymentType} />
                    <EDetail label="Task"        value={e.taskDescription} />
                    <EDetail label="Created"     value={fmt(e.createdAt)} />
                    {e.completedAt && <EDetail label="Completed" value={fmt(e.completedAt)} />}
                  </div>
                </div>
                <div className="pt-2">
                  <a href={`tel:+${e.clientPhone}`}
                    className="text-xs text-green-400/70 hover:text-green-400 flex items-center gap-1 w-fit">
                    <Phone size={12} /> Call Client
                  </a>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function EDetail({ label, value }: { label: string; value: React.ReactNode }) {
  if (!value) return null
  return (
    <div className="flex items-start gap-2">
      <span className="text-slate-500 w-24 flex-shrink-0 text-xs">{label}</span>
      <span className="text-slate-200 text-xs break-all">{value}</span>
    </div>
  )
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString("en-NG", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" })
}
