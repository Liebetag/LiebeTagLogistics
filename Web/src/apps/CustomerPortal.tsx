import { useEffect, useMemo, useState } from "react"
import { Bike, ClipboardList, LogOut, MapPin, MessageCircle, Package, Phone, Send } from "lucide-react"
import { api, type Errand, type Order } from "../services/api.ts"
import StatusBadge from "../components/StatusBadge.tsx"

type PortalData = {
  user: { phone: string; name: string } | null
  orders: Order[]
  errands: Errand[]
}

export default function CustomerPortal() {
  const [token, setToken] = useState(localStorage.getItem("lt_portal_token") || "")
  const [phone, setPhone] = useState("")
  const [code, setCode] = useState("")
  const [step, setStep] = useState<"phone" | "code">("phone")
  const [data, setData] = useState<PortalData | null>(null)
  const [message, setMessage] = useState("")
  const [status, setStatus] = useState("")
  const [loading, setLoading] = useState(false)

  const activeOrders = useMemo(
    () => (data?.orders ?? []).filter(o => !["delivered", "cancelled"].includes(o.status)),
    [data],
  )
  const apiBase = localStorage.getItem("lt_api_url") || "https://liebetaglogistics-api.onrender.com"

  const load = async (currentToken = token) => {
    if (!currentToken) return
    setLoading(true)
    try {
      setData(await api.portalMe(currentToken))
      setStatus("")
    } catch {
      localStorage.removeItem("lt_portal_token")
      setToken("")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const requestOtp = async () => {
    setLoading(true); setStatus("")
    try {
      const result = await api.requestPortalOtp(phone)
      setPhone(result.phone)
      setStep("code")
      setStatus("Code sent on WhatsApp.")
    } catch (e: any) {
      setStatus(e.message || "Could not send code.")
    } finally {
      setLoading(false)
    }
  }

  const verifyOtp = async () => {
    setLoading(true); setStatus("")
    try {
      const result = await api.verifyPortalOtp(phone, code)
      localStorage.setItem("lt_portal_token", result.token)
      setToken(result.token)
      await load(result.token)
    } catch (e: any) {
      setStatus(e.message || "Incorrect code.")
    } finally {
      setLoading(false)
    }
  }

  const sendToAssistant = async (text = message) => {
    if (!text.trim() || !token) return
    setLoading(true); setStatus("")
    try {
      await api.portalChat(token, text.trim())
      setMessage("")
      await load(token)
      setStatus("Request received. Updates will continue here and on WhatsApp.")
    } catch (e: any) {
      setStatus(e.message || "Could not send request.")
    } finally {
      setLoading(false)
    }
  }

  const logout = () => {
    localStorage.removeItem("lt_portal_token")
    setToken("")
    setData(null)
    setStep("phone")
    setCode("")
  }

  if (!token || !data) {
    return (
      <main className="min-h-screen grid place-items-center p-4 bg-dark">
        <section className="w-full max-w-sm card space-y-4">
          <div className="space-y-1">
            <div className="w-10 h-10 rounded-lg bg-brand/20 text-brand grid place-items-center">
              <Phone size={20} />
            </div>
            <h1 className="text-xl font-bold">Liebe Tag Logistics</h1>
            <p className="text-sm text-slate-400">Sign in with your WhatsApp number.</p>
          </div>

          {step === "phone" ? (
            <>
              <input className="input w-full" placeholder="08012345678" value={phone} onChange={e => setPhone(e.target.value)} />
              <button className="btn-primary w-full" onClick={requestOtp} disabled={loading}>Send WhatsApp Code</button>
            </>
          ) : (
            <>
              <input className="input w-full" placeholder="6-digit code" value={code} onChange={e => setCode(e.target.value)} />
              <button className="btn-primary w-full" onClick={verifyOtp} disabled={loading}>Verify and Enter</button>
              <button className="btn-ghost w-full" onClick={() => setStep("phone")}>Change Number</button>
            </>
          )}
          {status && <p className="text-sm text-slate-300">{status}</p>}
        </section>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-dark">
      <header className="border-b border-dark-border bg-dark-card">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm text-brand font-medium">Liebe Tag Logistics</p>
            <h1 className="text-xl font-bold">Welcome{data.user?.name ? `, ${data.user.name}` : ""}</h1>
          </div>
          <button onClick={logout} className="btn-ghost flex items-center gap-2 text-sm"><LogOut size={14} /> Sign out</button>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Action icon={<Package size={18} />} label="Book delivery" onClick={() => sendToAssistant("I want to book a delivery")} />
          <Action icon={<Bike size={18} />} label="Book errand" onClick={() => sendToAssistant("I want to book an errand")} />
          <Action icon={<ClipboardList size={18} />} label="Get quote" onClick={() => sendToAssistant("I want a delivery quote")} />
          <Action icon={<MapPin size={18} />} label="Track order" onClick={() => sendToAssistant("I want to track my order")} />
        </section>

        <section className="card space-y-3">
          <div className="flex items-center gap-2">
            <MessageCircle size={16} className="text-brand" />
            <h2 className="font-semibold">Assistant</h2>
          </div>
          <div className="flex gap-2">
            <input
              className="input flex-1"
              placeholder="Type what you need, same as WhatsApp..."
              value={message}
              onChange={e => setMessage(e.target.value)}
              onKeyDown={e => e.key === "Enter" && sendToAssistant()}
            />
            <button className="btn-primary flex items-center gap-2" onClick={() => sendToAssistant()} disabled={loading}>
              <Send size={14} /> Send
            </button>
          </div>
          {status && <p className="text-sm text-slate-400">{status}</p>}
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <List title="Active Deliveries" empty="No active deliveries" items={activeOrders} trackBase={apiBase} />
          <ErrandList title="Errands" empty="No errands yet" items={data.errands} trackBase={apiBase} />
        </section>
      </div>
    </main>
  )
}

function Action({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="card text-left hover:border-brand/50 transition-colors">
      <span className="text-brand">{icon}</span>
      <span className="block mt-2 font-medium">{label}</span>
    </button>
  )
}

function List({ title, empty, items, trackBase }: { title: string; empty: string; items: Order[]; trackBase: string }) {
  return (
    <div className="card space-y-3">
      <h2 className="font-semibold">{title}</h2>
      {items.length === 0 ? <p className="text-sm text-slate-500">{empty}</p> : items.map(order => (
        <a key={order.id} className="block border-t border-dark-border pt-3 first:border-0 first:pt-0" href={`${trackBase}/track/${order.orderRef}`}>
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-brand text-sm">{order.orderRef}</span>
            <StatusBadge status={order.status} />
          </div>
          <p className="text-sm text-slate-300 mt-1">{order.packageDesc || "Package"}</p>
          <p className="text-xs text-slate-500">Receiver: {order.recipientName || order.recipientPhone}</p>
        </a>
      ))}
    </div>
  )
}

function ErrandList({ title, empty, items, trackBase }: { title: string; empty: string; items: Errand[]; trackBase: string }) {
  return (
    <div className="card space-y-3">
      <h2 className="font-semibold">{title}</h2>
      {items.length === 0 ? <p className="text-sm text-slate-500">{empty}</p> : items.map(errand => (
        <a key={errand.id} className="block border-t border-dark-border pt-3 first:border-0 first:pt-0" href={`${trackBase}/track/${errand.errandRef}`}>
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-purple-400 text-sm">{errand.errandRef}</span>
            <StatusBadge status={errand.status} />
          </div>
          <p className="text-sm text-slate-300 mt-1">{errand.taskDescription || errand.errandType}</p>
          <p className="text-xs text-slate-500">Type: {errand.errandType}</p>
        </a>
      ))}
    </div>
  )
}
