// src/pages/LiveMap.tsx
import { useEffect, useRef, useState } from "react"
import { MapPin, RefreshCw, Navigation, Battery } from "lucide-react"
import { api, type GPSTracker } from "../services/api.ts"

// Leaflet loaded from CDN in index.html
declare const L: any

const TRACKER_COLORS = ["#E8B84B", "#4ADE80", "#60A5FA", "#F87171", "#A78BFA"]

function hasLiveFix(t: GPSTracker): t is GPSTracker & { latitude: number; longitude: number } {
  return t.status !== "offline" && t.latitude !== null && t.longitude !== null
}

export default function LiveMap() {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstance = useRef<any>(null)
  const markers = useRef<Map<string, any>>(new Map())
  const [trackers, setTrackers] = useState<GPSTracker[]>([])
  const [selected, setSelected] = useState<GPSTracker | null>(null)
  const [loading, setLoading] = useState(false)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)

  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return
    const map = L.map(mapRef.current, { center: [9.0579, 7.4951], zoom: 12, zoomControl: true })
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap",
    }).addTo(map)
    mapInstance.current = map
    return () => { map.remove(); mapInstance.current = null }
  }, [])

  const renderMarkers = (data: GPSTracker[]) => {
    if (!mapInstance.current) return

    const liveIds = new Set(data.filter(hasLiveFix).map(t => t.deviceId))
    for (const [deviceId, marker] of markers.current.entries()) {
      if (!liveIds.has(deviceId)) {
        mapInstance.current.removeLayer(marker)
        markers.current.delete(deviceId)
      }
    }

    data.filter(hasLiveFix).forEach((t, i) => {
      const color = TRACKER_COLORS[i % TRACKER_COLORS.length]!
      const icon = L.divIcon({
        className: "",
        html: `<div style="background:${color};width:16px;height:16px;border-radius:50%;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.4)"></div>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      })

      if (markers.current.has(t.deviceId)) {
        const marker = markers.current.get(t.deviceId)
        marker.setLatLng([t.latitude, t.longitude])
        marker.setPopupContent(popupHtml(t, color))
      } else {
        const marker = L.marker([t.latitude, t.longitude], { icon })
          .addTo(mapInstance.current)
          .bindPopup(popupHtml(t, color))
        markers.current.set(t.deviceId, marker)
      }
    })
  }

  const fetchTrackers = async () => {
    setLoading(true)
    try {
      const { trackers: data } = await api.liveTrackers()
      setTrackers(data)
      setLastUpdate(new Date())
      renderMarkers(data)
    } catch {}
    setLoading(false)
  }

  useEffect(() => {
    fetchTrackers()
    const timer = setInterval(fetchTrackers, 30_000)

    const base = (localStorage.getItem("lt_api_url") || "").replace(/^http/, "ws")
    const apiKey = localStorage.getItem("lt_api_key") || ""
    let ws: WebSocket | null = null
    if (base) {
      ws = new WebSocket(`${base}/ws/trackers?key=${encodeURIComponent(apiKey)}`)
      ws.onmessage = e => {
        try {
          const msg = JSON.parse(e.data)
          if (msg.type === "trackers" && Array.isArray(msg.data)) {
            setTrackers(msg.data)
            setLastUpdate(new Date())
            renderMarkers(msg.data)
          }
        } catch {}
      }
      ws.onerror = () => console.warn("[ws] tracker stream disconnected")
    }

    return () => { clearInterval(timer); ws?.close() }
  }, [])

  const flyTo = (t: GPSTracker) => {
    if (!hasLiveFix(t)) return
    setSelected(t)
    mapInstance.current?.flyTo([t.latitude, t.longitude], 16, { duration: 1 })
    markers.current.get(t.deviceId)?.openPopup()
  }

  return (
    <div className="flex h-[calc(100vh-0px)] overflow-hidden">
      <div className="w-64 flex-shrink-0 bg-dark-card border-r border-dark-border flex flex-col">
        <div className="p-4 border-b border-dark-border flex items-center justify-between">
          <h2 className="font-semibold flex items-center gap-2"><MapPin size={16} className="text-brand" /> GPS Trackers</h2>
          <button onClick={fetchTrackers} className="p-1.5 rounded-lg hover:bg-dark-border transition-colors">
            <RefreshCw size={14} className={loading ? "animate-spin text-brand" : "text-slate-400"} />
          </button>
        </div>

        {lastUpdate && (
          <p className="text-xs text-slate-500 px-4 pt-2">Updated {lastUpdate.toLocaleTimeString()}</p>
        )}

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {trackers.length === 0 ? (
            <div className="text-center py-8 text-slate-500 text-sm">
              {loading ? "Loading GPS data..." : "No trackers configured"}
            </div>
          ) : trackers.map((t, i) => {
            const live = hasLiveFix(t)
            return (
              <button key={t.deviceId} onClick={() => flyTo(t)}
                className={`w-full text-left p-3 rounded-xl border transition-all ${
                  selected?.deviceId === t.deviceId
                    ? "border-brand/50 bg-brand/10"
                    : "border-dark-border hover:border-dark-border/80 hover:bg-dark-border/30"
                }`}>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: live ? TRACKER_COLORS[i % TRACKER_COLORS.length] : "#64748b" }} />
                  <span className="font-medium text-sm">{t.label}</span>
                  {!live ? (
                    <span className="ml-auto text-xs text-slate-500">Offline</span>
                  ) : t.speedKmh > 0 && (
                    <span className="ml-auto text-xs text-green-400 flex items-center gap-1">
                      <Navigation size={10} /> Moving
                    </span>
                  )}
                </div>
                <div className="text-xs text-slate-400 space-y-0.5">
                  {!live ? (
                    <p>Offline - no live GPS fix</p>
                  ) : (
                    <>
                      <p>Speed: {t.speedKmh} km/h</p>
                      <p>Location: {t.latitude!.toFixed(4)}, {t.longitude!.toFixed(4)}</p>
                    </>
                  )}
                  {t.battery !== undefined && (
                    <p className="flex items-center gap-1"><Battery size={10} /> {t.battery}%</p>
                  )}
                  {t.timestamp && <p className="text-slate-500">{new Date(t.timestamp).toLocaleTimeString()}</p>}
                </div>
                {live && (
                  <a
                    href={`https://maps.google.com/?q=${t.latitude},${t.longitude}`}
                    target="_blank" rel="noreferrer"
                    onClick={e => e.stopPropagation()}
                    className="mt-2 text-xs text-brand/70 hover:text-brand block"
                  >
                    Open in Google Maps
                  </a>
                )}
              </button>
            )
          })}
        </div>
      </div>

      <div ref={mapRef} className="flex-1" style={{ background: "#1a1a2e" }} />
    </div>
  )
}

function popupHtml(t: GPSTracker, color: string) {
  if (!hasLiveFix(t)) {
    return `
      <div style="font-family:system-ui;font-size:13px;min-width:160px">
        <b>${t.label}</b>
        <div style="color:#888;font-size:12px;margin-top:6px">Offline - no live GPS fix</div>
      </div>
    `
  }

  return `
    <div style="font-family:system-ui;font-size:13px;min-width:160px">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
        <span style="background:${color};width:10px;height:10px;border-radius:50%;display:inline-block"></span>
        <b>${t.label}</b>
      </div>
      <div style="color:#888;font-size:12px">
        <div>Speed: ${t.speedKmh} km/h</div>
        <div>${t.latitude!.toFixed(5)}, ${t.longitude!.toFixed(5)}</div>
        <div style="margin-top:4px">
          <a href="https://maps.google.com/?q=${t.latitude},${t.longitude}" target="_blank"
            style="color:#E8B84B">Navigate</a>
        </div>
      </div>
    </div>
  `
}
