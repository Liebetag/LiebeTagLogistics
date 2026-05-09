// src/App.tsx
import { useState, useEffect } from "react"
import { Routes, Route } from "react-router-dom"
import Connect  from "./components/Connect.tsx"
import Sidebar  from "./components/Sidebar.tsx"
import Dashboard from "./pages/Dashboard.tsx"
import LiveMap   from "./pages/LiveMap.tsx"
import Orders    from "./pages/Orders.tsx"
import Errands   from "./pages/Errands.tsx"
import Riders    from "./pages/Riders.tsx"
import Customers from "./pages/Customers.tsx"

export default function App() {
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    const url = localStorage.getItem("lt_api_url")
    const key = localStorage.getItem("lt_api_key")
    if (url && key) setConnected(true)
  }, [])

  if (!connected) return <Connect onConnect={() => setConnected(true)} />

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 overflow-auto min-w-0">
        <Routes>
          <Route path="/"        element={<Dashboard />} />
          <Route path="/map"     element={<LiveMap />}   />
          <Route path="/orders"  element={<Orders />}    />
          <Route path="/errands" element={<Errands />}   />
          <Route path="/riders"  element={<Riders />}    />
          <Route path="/customers" element={<Customers />} />
        </Routes>
      </main>
    </div>
  )
}
