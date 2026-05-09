import { useEffect, useState } from "react"
import { Phone, Search, UserRound } from "lucide-react"
import { api, type Customer } from "../services/api.ts"

export default function Customers() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [query, setQuery] = useState("")
  const [loading, setLoading] = useState(false)

  const search = async (q = query) => {
    setLoading(true)
    try {
      const result = await api.searchCustomers(q)
      setCustomers(result.customers)
    } catch {
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { search("") }, [])

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Customers</h1>
        <span className="badge-blue">{customers.length} records</span>
      </div>

      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          className="input w-full pl-9"
          placeholder="Search by customer name or phone..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === "Enter" && search()}
        />
        <button onClick={() => search()} className="absolute right-2 top-1/2 -translate-y-1/2 btn-primary text-xs px-3 py-1.5">
          Search
        </button>
      </div>

      {loading && <p className="text-slate-400 text-sm text-center py-8">Loading...</p>}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {customers.map(customer => (
          <div key={customer.id} className="card space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-brand/20 flex items-center justify-center text-brand">
                <UserRound size={18} />
              </div>
              <div className="min-w-0">
                <p className="font-medium truncate">{customer.name || "Unnamed customer"}</p>
                <p className="text-xs text-slate-400">+{customer.phone}</p>
              </div>
            </div>
            <div className="text-xs text-slate-400 space-y-1 border-t border-dark-border pt-3">
              <p>Orders: {customer.orderCount}</p>
              <p>Last seen: {new Date(customer.lastSeen).toLocaleString()}</p>
              <p>Joined: {new Date(customer.joinedAt).toLocaleDateString()}</p>
            </div>
            <a href={`tel:+${customer.phone}`} className="btn-ghost flex items-center justify-center gap-1.5 text-xs py-1.5">
              <Phone size={12} /> Call
            </a>
          </div>
        ))}
      </div>

      {!loading && customers.length === 0 && (
        <p className="text-slate-500 text-sm text-center py-12">No customers found</p>
      )}
    </div>
  )
}
