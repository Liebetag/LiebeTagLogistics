import { useEffect, useState } from "react"
import { RefreshCw, ShieldCheck, UserPlus } from "lucide-react"
import { api, type AdminUser } from "../services/api.ts"

const defaultPermissions = {
  dashboard: true,
  orders: true,
  riders: true,
  customers: true,
  trackers: true,
  settings: false,
}

export default function AdminUsers() {
  const [admins, setAdmins] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [form, setForm] = useState({
    phone: "",
    name: "",
    password: "",
    role: "operations" as AdminUser["role"],
    permissions: defaultPermissions,
  })

  const load = async () => {
    setLoading(true)
    setError("")
    try {
      const result = await api.adminUsers()
      setAdmins(result.admins)
    } catch (e: any) {
      setError(e.message || "Could not load admins")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const create = async () => {
    setLoading(true)
    setError("")
    try {
      await api.createAdmin(form)
      setForm({ phone: "", name: "", password: "", role: "operations", permissions: defaultPermissions })
      await load()
    } catch (e: any) {
      setError(e.message || "Could not create admin")
      setLoading(false)
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold">Admin Access</h1>
          <p className="text-slate-400 text-sm mt-0.5">Super admins can create dashboard accounts and assign operating rules.</p>
        </div>
        <button onClick={load} className="btn-ghost flex items-center gap-2 text-sm" disabled={loading}>
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="card space-y-4">
          <div className="flex items-center gap-2">
            <UserPlus size={17} className="text-brand-blue" />
            <h2 className="font-display text-lg font-bold">Create admin account</h2>
          </div>
          <Field label="Full name" value={form.name} onChange={name => setForm({ ...form, name })} placeholder="Operations manager" />
          <Field label="WhatsApp phone" value={form.phone} onChange={phone => setForm({ ...form, phone })} placeholder="08012345678" />
          <Field label="Temporary password" value={form.password} onChange={password => setForm({ ...form, password })} placeholder="At least 8 characters" type="password" />

          <label className="space-y-1 block">
            <span className="label">Role</span>
            <select className="input w-full" value={form.role} onChange={e => setForm({ ...form, role: e.target.value as AdminUser["role"] })}>
              <option value="operations">Operations</option>
              <option value="admin">Admin</option>
              <option value="viewer">Viewer</option>
            </select>
          </label>

          <div>
            <p className="label mb-2">Rules</p>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(form.permissions).map(([key, value]) => (
                <label key={key} className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm capitalize">
                  <input
                    type="checkbox"
                    checked={value}
                    onChange={e => setForm({ ...form, permissions: { ...form.permissions, [key]: e.target.checked } })}
                  />
                  {key}
                </label>
              ))}
            </div>
          </div>

          <button className="btn-blue w-full" onClick={create} disabled={loading}>Create admin</button>
        </div>

        <div className="card space-y-3">
          <div className="flex items-center gap-2">
            <ShieldCheck size={17} className="text-brand-blue" />
            <h2 className="font-display text-lg font-bold">Current admins</h2>
          </div>
          {admins.length === 0 ? (
            <p className="text-sm text-slate-500">No admin accounts found.</p>
          ) : admins.map(admin => (
            <div key={admin.id} className="border-t border-slate-200 pt-3 first:border-0 first:pt-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-semibold">{admin.name || admin.phone}</p>
                  <p className="text-xs text-slate-500">+{admin.phone} · {admin.role.replace("_", " ")}</p>
                </div>
                <span className={admin.status === "active" ? "badge-green" : "badge-red"}>{admin.status}</span>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Rules: {Object.entries(admin.permissions ?? {}).filter(([, allowed]) => allowed).map(([key]) => key).join(", ") || "No rules"}
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function Field({ label, value, onChange, placeholder, type = "text" }: { label: string; value: string; onChange: (value: string) => void; placeholder: string; type?: string }) {
  return (
    <label className="space-y-1 block">
      <span className="label">{label}</span>
      <input className="input w-full" type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
    </label>
  )
}
