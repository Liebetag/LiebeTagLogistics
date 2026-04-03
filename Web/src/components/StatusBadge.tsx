// src/components/StatusBadge.tsx
import clsx from "clsx"

const MAP: Record<string, { label: string; cls: string }> = {
  created:    { label: "Created",    cls: "badge-blue"   },
  paid:       { label: "Paid",       cls: "badge-blue"   },
  assigned:   { label: "Assigned",   cls: "badge-yellow" },
  picked_up:  { label: "Collected",  cls: "badge-yellow" },
  in_transit: { label: "In Transit", cls: "badge-yellow" },
  delivered:  { label: "Delivered",  cls: "badge-green"  },
  completed:  { label: "Completed",  cls: "badge-green"  },
  cancelled:  { label: "Cancelled",  cls: "badge-red"    },
  in_progress:{ label: "In Progress",cls: "badge-yellow" },
  pending:    { label: "Pending",    cls: "badge-blue"   },
  confirmed:  { label: "Confirmed",  cls: "badge-green"  },
  failed:     { label: "Failed",     cls: "badge-red"    },
}

export default function StatusBadge({ status }: { status: string }) {
  const cfg = MAP[status] ?? { label: status, cls: "badge-blue" }
  return <span className={cfg.cls}>{cfg.label}</span>
}
