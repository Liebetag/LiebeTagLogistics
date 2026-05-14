import { useEffect, useState } from "react"
import { Routes, Route } from "react-router-dom"
import Connect from "../components/Connect.tsx"
import Sidebar from "../components/Sidebar.tsx"
import Dashboard from "../pages/Dashboard.tsx"
import LiveMap from "../pages/LiveMap.tsx"
import Orders from "../pages/Orders.tsx"
import Errands from "../pages/Errands.tsx"
import Riders from "../pages/Riders.tsx"
import Customers from "../pages/Customers.tsx"
import AdminUsers from "../pages/AdminUsers.tsx"

export default function AdminApp() {
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    const url = localStorage.getItem("lt_api_url")
    const token = localStorage.getItem("lt_admin_token")
    if (url && token) setConnected(true)
  }, [])

  if (!connected) return <Connect onConnect={() => setConnected(true)} />

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 overflow-auto min-w-0">
        <Routes>
          <Route path="/admin" element={<Dashboard />} />
          <Route path="/admin/map" element={<LiveMap />} />
          <Route path="/admin/orders" element={<Orders />} />
          <Route path="/admin/errands" element={<Errands />} />
          <Route path="/admin/riders" element={<Riders />} />
          <Route path="/admin/customers" element={<Customers />} />
          <Route path="/admin/admins" element={<AdminUsers />} />
        </Routes>
      </main>
    </div>
  )
}
