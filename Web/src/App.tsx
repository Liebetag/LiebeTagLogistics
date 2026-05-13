import AdminApp from "./apps/AdminApp.tsx"
import CustomerPortal from "./apps/CustomerPortal.tsx"

export default function App() {
  return window.location.pathname.startsWith("/admin")
    ? <AdminApp />
    : <CustomerPortal />
}
