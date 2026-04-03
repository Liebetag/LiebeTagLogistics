// src/utils/tracking-page.ts
// Render the public HTML tracking page for an order or errand

import { env } from "./env.ts"

interface OrderRecord {
  orderRef?:      string
  errandRef?:     string
  orderNumber?:   string
  errandNumber?:  string
  status:         string
  senderName?:    string
  senderPhone?:   string
  recipientName?: string
  recipientPhone?: string
  clientName?:    string
  clientPhone?:   string
  pickupJson?:    string
  dropoffJson?:   string
  locationJson?:  string
  packageDesc?:   string
  weightKg?:      number
  fragile?:       number | boolean
  deliveryType?:  string
  fareTotal?:     number
  errandFee?:     number
  totalCharge?:   number
  taskDescription?: string
  errandType?:    string
  deadline?:      string
  paymentType?:   string
  createdAt?:     Date | string
  paidAt?:        Date | string | null
  assignedAt?:    Date | string | null
  pickedUpAt?:    Date | string | null
  deliveredAt?:   Date | string | null
  completedAt?:   Date | string | null
  cancelledAt?:   Date | string | null
  riderPhone?:    string
  pickupPhotoId?: string
  // GPS injected at render time
  riderLat?:      number
  riderLng?:      number
  riderSpeed?:    number
}

const STATUS_LABEL: Record<string, string> = {
  created:     "Order Placed",
  paid:        "Payment Confirmed",
  assigned:    "Rider Assigned",
  picked_up:   "Package Collected",
  in_transit:  "In Transit",
  in_progress: "Errand In Progress",
  delivered:   "Delivered ✓",
  completed:   "Completed ✓",
  cancelled:   "Cancelled",
}

const STATUS_COLOR: Record<string, string> = {
  created:    "#f59e0b",
  paid:       "#3b82f6",
  assigned:   "#8b5cf6",
  picked_up:  "#06b6d4",
  in_transit: "#06b6d4",
  in_progress:"#06b6d4",
  delivered:  "#10b981",
  completed:  "#10b981",
  cancelled:  "#ef4444",
}

function fmt(d: Date | string | null | undefined): string {
  if (!d) return ""
  const dt = new Date(d)
  return dt.toLocaleString("en-NG", { timeZone: "Africa/Lagos",
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit" }) + " WAT"
}

function safe(s: string | null | undefined, max = 60): string {
  return (s ?? "—").replace(/</g, "&lt;").replace(/>/g, "&gt;").slice(0, max)
}

export function renderTrackingPage(order: OrderRecord): string {
  const ref       = order.orderRef ?? order.errandRef ?? "—"
  const num       = order.orderNumber ?? order.errandNumber ?? "—"
  const isErrand  = !!order.errandRef
  const title     = isErrand ? "Errand Tracking" : "Delivery Tracking"
  const status    = order.status ?? "created"
  const color     = STATUS_COLOR[status] ?? "#64748b"
  const label     = STATUS_LABEL[status] ?? status
  const fare      = order.fareTotal ?? order.totalCharge ?? 0
  const photoUrl  = order.pickupPhotoId
    ? `${env.APP_URL}/order/${ref}/photo`
    : null

  // Parse locations
  let pickupAddr = "—", dropoffAddr = "—"
  try { pickupAddr  = (JSON.parse(order.pickupJson  ?? order.locationJson ?? "{}") as any).address ?? "—" } catch {}
  try { dropoffAddr = (JSON.parse(order.dropoffJson ?? "{}") as any).address ?? "—" } catch {}

  // Timeline events
  const events: Array<{ icon: string; label: string; time: string }> = []
  if (order.createdAt)   events.push({ icon: "📋", label: "Order placed",       time: fmt(order.createdAt) })
  if (order.paidAt)      events.push({ icon: "💳", label: "Payment confirmed",  time: fmt(order.paidAt) })
  if (order.assignedAt)  events.push({ icon: "🏍️", label: "Rider assigned",     time: fmt(order.assignedAt) })
  if (order.pickedUpAt)  events.push({ icon: "📦", label: "Package collected",  time: fmt(order.pickedUpAt) })
  if (order.deliveredAt || order.completedAt)
    events.push({ icon: "✅", label: isErrand ? "Errand completed" : "Delivered",
                  time: fmt(order.deliveredAt ?? order.completedAt) })
  if (order.cancelledAt) events.push({ icon: "❌", label: "Cancelled",          time: fmt(order.cancelledAt) })

  const timelineHtml = events.map(e =>
    `<div class="tl-item">
      <div class="tl-icon">${e.icon}</div>
      <div class="tl-body">
        <div class="tl-label">${e.label}</div>
        <div class="tl-time">${e.time}</div>
      </div>
    </div>`
  ).join("")

  // GPS map block
  const mapHtml = (order.riderLat && order.riderLng) ? `
    <div class="card">
      <div class="card-title">📍 Live Rider Location</div>
      <div class="map-wrap">
        <iframe
          src="https://www.openstreetmap.org/export/embed.html?bbox=${order.riderLng - 0.02},${order.riderLat - 0.02},${order.riderLng + 0.02},${order.riderLat + 0.02}&amp;layer=mapnik&amp;marker=${order.riderLat},${order.riderLng}"
          style="border:0;width:100%;height:280px;border-radius:8px"
          loading="lazy">
        </iframe>
      </div>
      <p style="margin:8px 0 0;font-size:13px;color:#64748b">
        Speed: ${order.riderSpeed?.toFixed(0) ?? "—"} km/h ·
        <a href="https://maps.google.com/?q=${order.riderLat},${order.riderLng}" target="_blank">Open in Google Maps</a>
      </p>
    </div>` : ""

  // Photo block
  const photoHtml = photoUrl ? `
    <div class="card">
      <div class="card-title">📷 Pickup Photo</div>
      <img src="${photoUrl}" alt="Package photo" style="width:100%;border-radius:8px;max-height:300px;object-fit:cover">
    </div>` : ""

  const senderName    = safe(order.senderName    ?? order.clientName)
  const recipientName = safe(order.recipientName)
  const packageDesc   = safe(order.packageDesc   ?? order.taskDescription)

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — ${ref}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0 }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
           background: #f1f5f9; color: #1e293b; min-height: 100vh }
    .header { background: #1e293b; color: white; padding: 16px 20px; display:flex;
              align-items:center; gap:12px; position:sticky; top:0; z-index:10 }
    .logo { font-weight:800; font-size:18px; letter-spacing:-0.5px }
    .logo span { color: #f59e0b }
    .page { max-width:600px; margin:0 auto; padding:16px }
    .status-bar { background:white; border-radius:12px; padding:20px;
                  margin-bottom:16px; text-align:center;
                  border-top: 4px solid ${color} }
    .status-label { font-size:22px; font-weight:700; color:${color} }
    .ref { font-size:13px; color:#64748b; margin-top:4px; font-family:monospace }
    .card { background:white; border-radius:12px; padding:16px; margin-bottom:16px }
    .card-title { font-size:13px; font-weight:700; color:#64748b;
                  text-transform:uppercase; letter-spacing:.5px; margin-bottom:12px }
    .row { display:flex; justify-content:space-between; align-items:flex-start;
           padding:8px 0; border-bottom:1px solid #f1f5f9 }
    .row:last-child { border-bottom:none }
    .row-key { font-size:13px; color:#64748b; min-width:100px }
    .row-val { font-size:14px; font-weight:500; text-align:right; flex:1; padding-left:12px }
    .fare { font-size:20px; font-weight:800; color:#10b981 }
    .tl-item { display:flex; gap:12px; padding:8px 0; border-left:2px solid #e2e8f0;
                margin-left:10px; padding-left:16px; position:relative }
    .tl-icon { position:absolute; left:-12px; top:10px; font-size:16px }
    .tl-label { font-size:14px; font-weight:600 }
    .tl-time { font-size:12px; color:#64748b; margin-top:2px }
    .print-btn { width:100%; padding:14px; background:#1e293b; color:white; border:none;
                 border-radius:10px; font-size:15px; font-weight:600; cursor:pointer;
                 margin-bottom:16px }
    .print-btn:active { opacity:.8 }
    .badge { display:inline-block; background:${color}22; color:${color};
             padding:2px 8px; border-radius:99px; font-size:12px; font-weight:700 }
    @media print {
      .header, .print-btn { display:none }
      body { background:white }
      .card { box-shadow:none; border:1px solid #e2e8f0 }
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="logo">Liebe<span>Tag</span> Logistics</div>
      <div style="font-size:12px;opacity:.6;margin-top:2px">${title}</div>
    </div>
  </div>

  <div class="page">
    <div class="status-bar">
      <div class="status-label">${label}</div>
      <div class="ref">${ref} · ${num}</div>
    </div>

    ${mapHtml}

    ${photoHtml}

    <div class="card">
      <div class="card-title">📦 Order Details</div>
      ${!isErrand ? `
      <div class="row"><span class="row-key">From</span><span class="row-val">${pickupAddr}</span></div>
      <div class="row"><span class="row-key">To</span><span class="row-val">${dropoffAddr}</span></div>
      <div class="row"><span class="row-key">Package</span><span class="row-val">${packageDesc}</span></div>
      ${order.weightKg ? `<div class="row"><span class="row-key">Weight</span><span class="row-val">${order.weightKg}kg${order.fragile ? " · ⚠️ Fragile" : ""}</span></div>` : ""}
      <div class="row"><span class="row-key">Type</span><span class="row-val"><span class="badge">${order.deliveryType ?? "NORMAL"}</span></span></div>
      ` : `
      <div class="row"><span class="row-key">Location</span><span class="row-val">${pickupAddr}</span></div>
      <div class="row"><span class="row-key">Task</span><span class="row-val">${packageDesc}</span></div>
      <div class="row"><span class="row-key">Type</span><span class="row-val"><span class="badge">${order.errandType ?? "OTHER"}</span></span></div>
      ${order.deadline ? `<div class="row"><span class="row-key">Deadline</span><span class="row-val">${safe(order.deadline)}</span></div>` : ""}
      `}
      <div class="row"><span class="row-key">Payment</span><span class="row-val">${order.paymentType === "cash" ? "Cash" : "Online"}</span></div>
      ${fare ? `<div class="row"><span class="row-key">Fare</span><span class="row-val fare">₦${fare.toLocaleString()}</span></div>` : ""}
    </div>

    <div class="card">
      <div class="card-title">👤 Parties</div>
      <div class="row"><span class="row-key">Sender</span><span class="row-val">${senderName}</span></div>
      ${recipientName !== "—" ? `<div class="row"><span class="row-key">Recipient</span><span class="row-val">${recipientName}</span></div>` : ""}
    </div>

    ${timelineHtml ? `
    <div class="card">
      <div class="card-title">🕒 Timeline</div>
      ${timelineHtml}
    </div>` : ""}

    <button class="print-btn" onclick="window.print()">🖨️ Print / Save as PDF</button>

    <p style="text-align:center;font-size:12px;color:#94a3b8;margin-bottom:24px">
      Liebe Tag Logistics · info@liebetag.com · +234 811 870 7226
    </p>
  </div>

  <script>
    // Auto-refresh GPS every 30s if rider is active
    const activeStatuses = ["assigned","picked_up","in_transit","in_progress"]
    if (activeStatuses.includes("${status}")) {
      setTimeout(() => location.reload(), 30000)
    }
  </script>
</body>
</html>`
}
