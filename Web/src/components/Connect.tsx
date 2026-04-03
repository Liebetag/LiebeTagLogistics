// src/components/Connect.tsx
// First-launch connection screen

import { useState } from "react"
import { Truck } from "lucide-react"

interface Props { onConnect: () => void }

export default function Connect({ onConnect }: Props) {
  const [url, setUrl] = useState(localStorage.getItem("lt_api_url") || "https://liebetaglogistics-api.onrender.com")
  const [key, setKey] = useState(localStorage.getItem("lt_api_key") || "")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const connect = async () => {
    setLoading(true); setError("")
    try {
      const r = await fetch(`${url}/`, { headers: { "X-API-Key": key } })
      if (!r.ok) throw new Error(`${r.status} — check your API key`)
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
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-brand/20 mb-4">
            <Truck size={32} className="text-brand" />
          </div>
          <h1 className="text-2xl font-bold">Liebe Tag Logistics</h1>
          <p className="text-slate-400 mt-1">Admin Dashboard</p>
        </div>

        <div className="card space-y-4">
          <div>
            <label className="block text-sm text-slate-400 mb-1">API URL</label>
            <input className="input w-full" value={url} onChange={e => setUrl(e.target.value)}
              placeholder="https://liebetaglogistics-api.onrender.com" />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">API Key</label>
            <input className="input w-full" type="password" value={key} onChange={e => setKey(e.target.value)}
              placeholder="llt_..." />
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button className="btn-primary w-full py-2.5" onClick={connect} disabled={loading}>
            {loading ? "Connecting…" : "Connect"}
          </button>
        </div>
      </div>
    </div>
  )
}
