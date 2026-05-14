// src/components/Connect.tsx
// First-launch admin connection screen

import { useState } from "react"
import { LockKeyhole, ShieldCheck, Truck } from "lucide-react"
import logoUrl from "../assets/liebetag-logo-guidelines.png"
import riderImage from "../assets/liebetag-rider-brand-application.png"

interface Props { onConnect: () => void }

export default function Connect({ onConnect }: Props) {
  const [url, setUrl] = useState(localStorage.getItem("lt_api_url") || "https://liebetaglogistics-api.onrender.com")
  const [key, setKey] = useState(localStorage.getItem("lt_api_key") || "")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const connect = async () => {
    setLoading(true)
    setError("")
    try {
      const r = await fetch(`${url}/`, { headers: { "X-API-Key": key } })
      if (!r.ok) throw new Error(`${r.status} - check your API key`)
      localStorage.setItem("lt_api_url", url)
      localStorage.setItem("lt_api_key", key)
      onConnect()
    } catch (e: any) {
      setError(e.message || "Could not connect")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-950 text-white">
      <img src={riderImage} alt="" className="absolute inset-0 h-full w-full object-cover opacity-30" />
      <div className="absolute inset-0 bg-slate-950/80" />

      <div className="relative mx-auto grid min-h-screen max-w-6xl grid-cols-1 items-center gap-8 px-4 py-8 lg:grid-cols-[1fr_0.9fr]">
        <section className="max-w-2xl">
          <img src={logoUrl} alt="Liebe Tag Logistics" className="mb-8 h-16 w-36 rounded object-cover object-left" />
          <p className="mb-4 inline-flex rounded-full border border-brand/30 bg-brand/10 px-3 py-1 text-sm font-semibold text-brand">
            Operations portal
          </p>
          <h1 className="font-display text-4xl font-extrabold leading-tight md:text-5xl">
            Manage dispatch, riders, trackers, customers, and allocation requests.
          </h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-slate-300">
            Connect the admin dashboard to the Liebe Tag API to monitor the same live database used by WhatsApp and the web portal.
          </p>
          <div className="mt-8 grid max-w-xl grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-white/10 bg-white/5 p-4">
              <Truck size={18} className="text-brand" />
              <p className="mt-2 text-sm font-semibold">Dispatch control</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/5 p-4">
              <ShieldCheck size={18} className="text-brand" />
              <p className="mt-2 text-sm font-semibold">Protected API access</p>
            </div>
          </div>
        </section>

        <section className="w-full rounded-lg border border-white/10 bg-white p-5 text-slate-950 shadow-2xl">
          <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-md bg-brand text-slate-950">
            <LockKeyhole size={22} />
          </div>
          <h2 className="font-display text-2xl font-bold">Admin connection</h2>
          <p className="mt-1 text-sm text-slate-500">Enter the API endpoint and admin key for this browser.</p>

          <div className="mt-6 space-y-4">
            <div>
              <label className="label mb-1 block">API URL</label>
              <input className="input w-full" value={url} onChange={e => setUrl(e.target.value)}
                placeholder="https://liebetaglogistics-api.onrender.com" />
            </div>
            <div>
              <label className="label mb-1 block">API Key</label>
              <input className="input w-full" type="password" value={key} onChange={e => setKey(e.target.value)}
                placeholder="llt_..." />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button className="btn-primary w-full py-2.5" onClick={connect} disabled={loading}>
              {loading ? "Connecting..." : "Connect to dashboard"}
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}
