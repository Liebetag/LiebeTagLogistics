// src/components/Connect.tsx
// Admin password login screen

import { useState } from "react"
import { LockKeyhole, ShieldCheck, Truck } from "lucide-react"
import logoUrl from "../assets/liebetag-wordmark.svg"
import riderImage from "../assets/liebetag-rider-brand-application.png"
import { api } from "../services/api.ts"

interface Props { onConnect: () => void }

export default function Connect({ onConnect }: Props) {
  const [url, setUrl] = useState(localStorage.getItem("lt_api_url") || "https://liebetaglogistics-api.onrender.com")
  const [phone, setPhone] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const connect = async () => {
    setLoading(true)
    setError("")
    try {
      localStorage.setItem("lt_api_url", url)
      const result = await api.adminLogin(phone, password)
      localStorage.setItem("lt_admin_token", result.token)
      localStorage.setItem("lt_admin_user", JSON.stringify(result.admin))
      localStorage.removeItem("lt_api_key")
      onConnect()
    } catch (e: any) {
      setError(e.message || "Could not sign in")
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
          <div className="mb-8 inline-flex rounded-lg bg-white px-4 py-3 shadow-sm">
            <img src={logoUrl} alt="Liebe Tag Logistics" className="h-12 w-auto" />
          </div>
          <p className="mb-4 inline-flex rounded-full border border-brand/30 bg-brand/10 px-3 py-1 text-sm font-semibold text-brand">
            Super admin protected
          </p>
          <h1 className="font-display text-4xl font-extrabold leading-tight md:text-5xl">
            Sign in to manage dispatch, riders, customers, and admin access.
          </h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-slate-300">
            The super admin can create admin accounts and define access rules. The API key is no longer used as the dashboard login.
          </p>
          <div className="mt-8 grid max-w-xl grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-white/10 bg-white/5 p-4">
              <Truck size={18} className="text-brand" />
              <p className="mt-2 text-sm font-semibold">Dispatch control</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/5 p-4">
              <ShieldCheck size={18} className="text-brand" />
              <p className="mt-2 text-sm font-semibold">Role-based admin access</p>
            </div>
          </div>
        </section>

        <section className="w-full rounded-lg border border-white/10 bg-white p-5 text-slate-950 shadow-2xl">
          <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-md bg-brand text-slate-950">
            <LockKeyhole size={22} />
          </div>
          <h2 className="font-display text-2xl font-bold">Admin sign in</h2>
          <p className="mt-1 text-sm text-slate-500">Use your admin phone number and password.</p>

          <div className="mt-6 space-y-4">
            <div>
              <label className="label mb-1 block">API URL</label>
              <input className="input w-full" value={url} onChange={e => setUrl(e.target.value)}
                placeholder="https://liebetaglogistics-api.onrender.com" />
            </div>
            <div>
              <label className="label mb-1 block">Admin phone</label>
              <input className="input w-full" value={phone} onChange={e => setPhone(e.target.value)}
                placeholder="08012345678" />
            </div>
            <div>
              <label className="label mb-1 block">Password</label>
              <input className="input w-full" type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder="Enter password" onKeyDown={e => e.key === "Enter" && connect()} />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button className="btn-primary w-full py-2.5" onClick={connect} disabled={loading}>
              {loading ? "Signing in..." : "Sign in"}
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}
