import { useEffect, useMemo, useState } from "react"
import {
  ArrowRight,
  Bike,
  ClipboardList,
  Globe2,
  LockKeyhole,
  LogOut,
  Package,
  Plane,
  ReceiptText,
  Search,
  ShieldCheck,
  Truck,
} from "lucide-react"
import { api, type Errand, type Order } from "../services/api.ts"
import StatusBadge from "../components/StatusBadge.tsx"

type PortalData = {
  user: { phone: string; name: string } | null
  orders: Order[]
  errands: Errand[]
}

type RequestForm = {
  service: "delivery" | "errand" | "interstate" | "international"
  pickup: string
  dropoff: string
  item: string
  recipientName: string
  recipientPhone: string
  notes: string
}

const emptyRequest: RequestForm = {
  service: "delivery",
  pickup: "",
  dropoff: "",
  item: "",
  recipientName: "",
  recipientPhone: "",
  notes: "",
}

export default function CustomerPortal() {
  const [token, setToken] = useState(localStorage.getItem("lt_portal_token") || "")
  const [phone, setPhone] = useState("")
  const [code, setCode] = useState("")
  const [step, setStep] = useState<"phone" | "code">("phone")
  const [data, setData] = useState<PortalData | null>(null)
  const [status, setStatus] = useState("")
  const [loading, setLoading] = useState(false)
  const [trackingRef, setTrackingRef] = useState("")
  const [trackedItem, setTrackedItem] = useState<Order | Errand | null>(null)
  const [request, setRequest] = useState<RequestForm>(emptyRequest)

  const apiBase = localStorage.getItem("lt_api_url") || "https://liebetaglogistics-api.onrender.com"
  const orders = data?.orders ?? []
  const errands = data?.errands ?? []

  const activeOrders = useMemo(
    () => orders.filter(o => !["delivered", "cancelled"].includes(o.status)),
    [orders],
  )

  const completedCount = useMemo(
    () => orders.filter(o => o.status === "delivered").length + errands.filter(e => e.status === "completed").length,
    [orders, errands],
  )

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
    setLoading(true)
    setStatus("")
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
    setLoading(true)
    setStatus("")
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

  const findTracking = () => {
    const ref = trackingRef.trim().toUpperCase()
    if (!ref) return
    const match =
      orders.find(o => o.orderRef.toUpperCase() === ref || o.orderNumber === ref) ??
      errands.find(e => e.errandRef.toUpperCase() === ref || e.errandNumber === ref) ??
      null
    setTrackedItem(match)
    setStatus(match ? "Shipment found in your account." : "No matching shipment was found in this account.")
  }

  const submitRequest = async () => {
    if (!token) return
    if (!request.pickup.trim() || !request.dropoff.trim() || !request.item.trim()) {
      setStatus("Pickup, drop-off, and item details are required.")
      return
    }

    setLoading(true)
    setStatus("")
    const serviceLabel = serviceOptions.find(s => s.id === request.service)?.label ?? "Delivery"
    const message = [
      `Web ${serviceLabel} request`,
      `Pickup: ${request.pickup}`,
      `Drop-off: ${request.dropoff}`,
      `Item: ${request.item}`,
      request.recipientName ? `Recipient: ${request.recipientName}` : "",
      request.recipientPhone ? `Recipient phone: ${request.recipientPhone}` : "",
      request.notes ? `Notes: ${request.notes}` : "",
    ].filter(Boolean).join("\n")

    try {
      await api.portalChat(token, message)
      setRequest(emptyRequest)
      await load(token)
      setStatus("Request submitted. Confirmation and next steps will arrive on WhatsApp.")
    } catch (e: any) {
      setStatus(e.message || "Could not submit request.")
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
      <main className="min-h-screen bg-slate-950 text-white">
        <div className="mx-auto grid min-h-screen max-w-6xl grid-cols-1 lg:grid-cols-[1.2fr_0.8fr]">
          <section className="flex flex-col justify-between px-6 py-8 lg:px-10">
            <BrandLogo light />
            <div className="max-w-2xl py-14">
              <p className="mb-4 inline-flex rounded-full border border-brand/30 bg-brand/10 px-3 py-1 text-sm font-semibold text-brand">
                Fast. Reliable. Global.
              </p>
              <h1 className="font-display text-4xl font-extrabold leading-tight md:text-6xl">
                Moving your world, one delivery at a time.
              </h1>
              <p className="mt-5 max-w-xl text-base leading-7 text-slate-300">
                Book local deliveries, manage errands, track shipments, and keep every receipt in one connected Liebe Tag account.
              </p>
              <div className="mt-8 grid max-w-xl grid-cols-1 gap-3 sm:grid-cols-3">
                <Proof icon={<ShieldCheck size={18} />} label="WhatsApp OTP" />
                <Proof icon={<Bike size={18} />} label="Live rider tracking" />
                <Proof icon={<ReceiptText size={18} />} label="Receipts and labels" />
              </div>
            </div>
            <p className="text-sm text-slate-500">No password. Your WhatsApp number is your account identity.</p>
          </section>

          <section className="flex items-center px-6 py-8 lg:px-10">
            <div className="w-full rounded-lg border border-white/10 bg-white p-5 text-slate-950 shadow-2xl">
              <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-md bg-brand text-slate-950">
                <LockKeyhole size={22} />
              </div>
              <h2 className="font-display text-2xl font-bold">Enter the portal</h2>
              <p className="mt-1 text-sm text-slate-500">We will send a one-time code to your WhatsApp.</p>

              <div className="mt-6 space-y-3">
                {step === "phone" ? (
                  <>
                    <label className="label">WhatsApp number</label>
                    <input className="input w-full" placeholder="08012345678" value={phone} onChange={e => setPhone(e.target.value)} />
                    <button className="btn-primary w-full" onClick={requestOtp} disabled={loading}>Send WhatsApp Code</button>
                  </>
                ) : (
                  <>
                    <label className="label">Verification code</label>
                    <input className="input w-full" placeholder="6-digit code" value={code} onChange={e => setCode(e.target.value)} />
                    <button className="btn-primary w-full" onClick={verifyOtp} disabled={loading}>Verify and Enter</button>
                    <button className="btn-ghost w-full" onClick={() => setStep("phone")}>Change Number</button>
                  </>
                )}
                {status && <p className="text-sm text-slate-600">{status}</p>}
              </div>
            </div>
          </section>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4">
          <BrandLogo />
          <nav className="hidden items-center gap-6 text-sm font-semibold text-slate-700 md:flex">
            <a href="#ship">Ship</a>
            <a href="#track">Track</a>
            <a href="#history">History</a>
            <a href="/admin">Admin</a>
          </nav>
          <button onClick={logout} className="btn-ghost flex items-center gap-2 text-sm"><LogOut size={14} /> Sign out</button>
        </div>
      </header>

      <section className="border-b border-slate-200 bg-white">
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-8 px-4 py-8 lg:grid-cols-[1.15fr_0.85fr] lg:py-12">
          <div>
            <p className="text-sm font-bold uppercase text-brand-blue">Welcome{data.user?.name ? `, ${data.user.name}` : ""}</p>
            <h1 className="mt-3 max-w-3xl font-display text-4xl font-extrabold leading-tight text-slate-950 md:text-5xl">
              A logistics portal for every pickup, errand, and shipment record.
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600">
              Use structured booking tools on the web while WhatsApp stays dedicated to conversation, alerts, OTP, and customer support.
            </p>
            <div className="mt-6 grid grid-cols-3 gap-3">
              <Metric label="Active" value={activeOrders.length} />
              <Metric label="Completed" value={completedCount} />
              <Metric label="Records" value={orders.length + errands.length} />
            </div>
          </div>

          <div id="track" className="rounded-lg border border-slate-200 bg-slate-950 p-5 text-white">
            <div className="mb-4 flex items-center gap-2">
              <Search size={18} className="text-brand" />
              <h2 className="font-display text-xl font-bold">Track shipment</h2>
            </div>
            <div className="flex gap-2">
              <input
                className="input flex-1 border-white/20 bg-white/10 text-white placeholder-slate-400"
                placeholder="LT-... or order number"
                value={trackingRef}
                onChange={e => setTrackingRef(e.target.value)}
                onKeyDown={e => e.key === "Enter" && findTracking()}
              />
              <button className="btn-primary flex items-center gap-2" onClick={findTracking}>Track <ArrowRight size={14} /></button>
            </div>
            {trackedItem && (
              <a className="mt-4 block rounded-md border border-white/10 bg-white/10 p-4" href={`${apiBase}/track/${"orderRef" in trackedItem ? trackedItem.orderRef : trackedItem.errandRef}`}>
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-sm text-brand">{"orderRef" in trackedItem ? trackedItem.orderRef : trackedItem.errandRef}</span>
                  <StatusBadge status={trackedItem.status} />
                </div>
                <p className="mt-2 text-sm text-slate-300">Open tracking, receipt, and label details</p>
              </a>
            )}
            {status && <p className="mt-3 text-sm text-slate-300">{status}</p>}
          </div>
        </div>
      </section>

      <section id="ship" className="mx-auto grid max-w-7xl grid-cols-1 gap-6 px-4 py-8 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="space-y-4">
          <h2 className="font-display text-2xl font-bold">Services</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1">
            {serviceOptions.map(service => (
              <button
                key={service.id}
                onClick={() => setRequest(current => ({ ...current, service: service.id }))}
                className={`rounded-lg border p-4 text-left transition ${request.service === service.id ? "border-brand-blue bg-blue-50" : "border-slate-200 bg-white hover:border-brand"}`}
              >
                <span className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-md bg-brand text-slate-950">{service.icon}</span>
                <span className="block font-display text-lg font-bold">{service.label}</span>
                <span className="mt-1 block text-sm leading-6 text-slate-600">{service.description}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="mb-5 flex items-center justify-between gap-4">
            <div>
              <p className="label">New request</p>
              <h2 className="font-display text-2xl font-bold">Book or quote a service</h2>
            </div>
            <span className="hidden rounded-full bg-brand px-3 py-1 text-xs font-bold text-slate-950 sm:inline-flex">
              {serviceOptions.find(s => s.id === request.service)?.label}
            </span>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Pickup address" value={request.pickup} onChange={pickup => setRequest({ ...request, pickup })} placeholder="Area, landmark, full address" />
            <Field label="Drop-off address" value={request.dropoff} onChange={dropoff => setRequest({ ...request, dropoff })} placeholder="Receiver location or destination" />
            <Field label="Item details" value={request.item} onChange={item => setRequest({ ...request, item })} placeholder="Documents, food, package, etc." />
            <Field label="Recipient phone" value={request.recipientPhone} onChange={recipientPhone => setRequest({ ...request, recipientPhone })} placeholder="080..." />
            <Field label="Recipient name" value={request.recipientName} onChange={recipientName => setRequest({ ...request, recipientName })} placeholder="Optional" />
            <Field label="Notes" value={request.notes} onChange={notes => setRequest({ ...request, notes })} placeholder="Fragile, deadline, payment preference" />
          </div>

          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
            <button className="btn-blue flex items-center justify-center gap-2" onClick={submitRequest} disabled={loading}>
              Submit request <ArrowRight size={15} />
            </button>
            <p className="text-sm text-slate-500">A WhatsApp confirmation will follow from the same account.</p>
          </div>
        </div>
      </section>

      <section id="history" className="mx-auto grid max-w-7xl grid-cols-1 gap-6 px-4 pb-10 lg:grid-cols-2">
        <HistoryList title="Deliveries" empty="No deliveries yet" items={orders} trackBase={apiBase} />
        <ErrandHistory title="Errands" empty="No errands yet" items={errands} trackBase={apiBase} />
      </section>
    </main>
  )
}

const serviceOptions: Array<{ id: RequestForm["service"]; label: string; description: string; icon: React.ReactNode }> = [
  { id: "delivery", label: "Local delivery", description: "Bike dispatch across Abuja with live status and proof of delivery.", icon: <Package size={20} /> },
  { id: "errand", label: "Errands", description: "Pickup, purchase, queue, document run, and other assisted tasks.", icon: <Bike size={20} /> },
  { id: "interstate", label: "Interstate", description: "Prepare requests for city-to-city shipments as the network expands.", icon: <Truck size={20} /> },
  { id: "international", label: "International", description: "A future-ready lane for documents and global shipment requests.", icon: <Plane size={20} /> },
]

function BrandLogo({ light = false }: { light?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className="relative h-10 w-10 overflow-hidden rounded-md bg-brand">
        <span className="absolute left-2 top-2 h-6 w-2 -skew-x-12 bg-slate-950" />
        <span className="absolute left-4 top-2 h-6 w-2 -skew-x-12 bg-white" />
        <span className="absolute left-6 top-2 h-6 w-2 -skew-x-12 bg-brand-blue" />
      </div>
      <div>
        <p className={`font-display text-lg font-extrabold leading-none tracking-normal ${light ? "text-white" : "text-slate-950"}`}>LIEBE TAG</p>
        <p className={`text-[10px] font-bold uppercase tracking-[0.22em] ${light ? "text-slate-400" : "text-slate-500"}`}>Logistics</p>
      </div>
    </div>
  )
}

function Proof({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-3">
      <span className="text-brand">{icon}</span>
      <p className="mt-2 text-sm font-semibold text-white">{label}</p>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <p className="font-display text-3xl font-extrabold text-slate-950">{value}</p>
      <p className="text-xs font-semibold uppercase text-slate-500">{label}</p>
    </div>
  )
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <label className="space-y-1">
      <span className="label">{label}</span>
      <input className="input w-full" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
    </label>
  )
}

function HistoryList({ title, empty, items, trackBase }: { title: string; empty: string; items: Order[]; trackBase: string }) {
  return (
    <div className="card space-y-3">
      <div className="flex items-center gap-2">
        <ClipboardList size={17} className="text-brand-blue" />
        <h2 className="font-display text-xl font-bold">{title}</h2>
      </div>
      {items.length === 0 ? <p className="text-sm text-slate-500">{empty}</p> : items.slice(0, 8).map(order => (
        <a key={order.id} className="block border-t border-slate-200 pt-3 first:border-0 first:pt-0" href={`${trackBase}/track/${order.orderRef}`}>
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-sm font-semibold text-brand-blue">{order.orderRef}</span>
            <StatusBadge status={order.status} />
          </div>
          <p className="mt-1 text-sm text-slate-700">{order.packageDesc || "Package"}</p>
          <p className="text-xs text-slate-500">Receiver: {order.recipientName || order.recipientPhone}</p>
        </a>
      ))}
    </div>
  )
}

function ErrandHistory({ title, empty, items, trackBase }: { title: string; empty: string; items: Errand[]; trackBase: string }) {
  return (
    <div className="card space-y-3">
      <div className="flex items-center gap-2">
        <Globe2 size={17} className="text-brand-blue" />
        <h2 className="font-display text-xl font-bold">{title}</h2>
      </div>
      {items.length === 0 ? <p className="text-sm text-slate-500">{empty}</p> : items.slice(0, 8).map(errand => (
        <a key={errand.id} className="block border-t border-slate-200 pt-3 first:border-0 first:pt-0" href={`${trackBase}/track/${errand.errandRef}`}>
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-sm font-semibold text-brand-blue">{errand.errandRef}</span>
            <StatusBadge status={errand.status} />
          </div>
          <p className="mt-1 text-sm text-slate-700">{errand.taskDescription || errand.errandType}</p>
          <p className="text-xs text-slate-500">Type: {errand.errandType}</p>
        </a>
      ))}
    </div>
  )
}
