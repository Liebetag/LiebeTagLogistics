// src/components/Sidebar.tsx
import { NavLink } from "react-router-dom"
import { LayoutDashboard, Map, Package, ClipboardList, Users, LogOut, Truck, UserRound } from "lucide-react"
import clsx from "clsx"

const links = [
  { to: "/",        icon: LayoutDashboard, label: "Dashboard"  },
  { to: "/map",     icon: Map,             label: "Live Map"   },
  { to: "/orders",  icon: Package,         label: "Orders"     },
  { to: "/errands", icon: ClipboardList,   label: "Errands"    },
  { to: "/riders",  icon: Users,           label: "Riders"     },
  { to: "/customers", icon: UserRound,     label: "Customers"  },
]

export default function Sidebar() {
  const disconnect = () => {
    localStorage.removeItem("lt_api_url")
    localStorage.removeItem("lt_api_key")
    window.location.reload()
  }

  return (
    <aside className="w-56 flex-shrink-0 bg-dark-card border-r border-dark-border flex flex-col h-screen sticky top-0">
      <div className="p-4 border-b border-dark-border flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-brand/20 flex items-center justify-center">
          <Truck size={16} className="text-brand" />
        </div>
        <div>
          <p className="font-semibold text-sm leading-none">Liebe Tag</p>
          <p className="text-xs text-slate-500">Admin Panel</p>
        </div>
      </div>

      <nav className="flex-1 p-3 space-y-0.5">
        {links.map(({ to, icon: Icon, label }) => (
          <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) =>
            clsx("flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
              isActive ? "bg-brand/15 text-brand font-medium" : "text-slate-400 hover:text-slate-100 hover:bg-dark-border/50")
          }>
            <Icon size={16} />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="p-3 border-t border-dark-border">
        <button onClick={disconnect}
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-500 hover:text-red-400 w-full transition-colors">
          <LogOut size={16} />
          Disconnect
        </button>
      </div>
    </aside>
  )
}
