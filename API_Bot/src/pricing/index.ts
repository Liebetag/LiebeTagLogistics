// src/pricing/index.ts
// Delivery and errand pricing

import type { FareBreakdown, ErrandFare } from "../types/index.ts"

// ─── Delivery pricing ──────────────────────────────────────────────────────────
const BASE_FARE       = 2_000
const BASE_KM         = 10
const PER_KM          = 200
const FRAGILE_FEE     = 500
const WEIGHT_FEES     = [
  { above: 10, fee: 2_000 },
  { above:  5, fee: 1_000 },
  { above:  2, fee:   500 },
]
const PRIORITY_FEE      = 1_500
const SCHEDULED_DISCOUNT = 200
const SCHEDULED_MIN_HRS  = 4
const COMMISSION_PCT      = 0.15
const RIDER_PCT           = 0.85

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R  = 6371
  const dL = (lat2 - lat1) * Math.PI / 180
  const dl = (lng2 - lng1) * Math.PI / 180
  const a  = Math.sin(dL/2)**2 +
             Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) * Math.sin(dl/2)**2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function calculateFare(
  pickupLat: number, pickupLng: number,
  destLat: number,   destLng: number,
  options: {
    weightKg?:      number
    deliveryType?:  string
    fragile?:       boolean
    scheduledEpoch?: number
  } = {}
): FareBreakdown {
  const { weightKg = 0, deliveryType = "NORMAL", fragile = false, scheduledEpoch = 0 } = options
  const dist      = haversineKm(pickupLat, pickupLng, destLat, destLng)
  const extraKm   = Math.max(0, dist - BASE_KM)
  const distCharge = BASE_FARE + Math.round(extraKm * PER_KM)

  const wFee = WEIGHT_FEES.find(w => weightKg > w.above)?.fee ?? 0
  const fFee = fragile ? FRAGILE_FEE : 0

  let typeCharge   = 0
  let discount     = 0
  let typeLabel    = ""

  if (deliveryType === "PRIORITY") {
    typeCharge = PRIORITY_FEE
    typeLabel  = `+₦${PRIORITY_FEE.toLocaleString()} priority`
  } else if (deliveryType === "SCHEDULED") {
    const hoursAhead = scheduledEpoch
      ? (scheduledEpoch - Date.now() / 1000) / 3600
      : SCHEDULED_MIN_HRS
    discount   = hoursAhead >= SCHEDULED_MIN_HRS ? SCHEDULED_DISCOUNT : 0
    typeCharge = -discount
    typeLabel  = discount ? `-₦${discount} scheduled saving` : "Scheduled"
  }

  const total      = distCharge + wFee + fFee + typeCharge
  const commission = Math.round(total * COMMISSION_PCT)
  const earnings   = total - commission

  const parts = [`Base ₦${BASE_FARE.toLocaleString()} (first ${BASE_KM}km)`]
  if (extraKm > 0) parts.push(`${extraKm.toFixed(1)}km × ₦${PER_KM}`)
  if (wFee) parts.push(`Weight +₦${wFee.toLocaleString()}`)
  if (fFee) parts.push(`Fragile +₦${fFee.toLocaleString()}`)
  if (typeLabel) parts.push(typeLabel)

  return {
    baseFare:          BASE_FARE,
    distanceCharge:    distCharge,
    distanceKm:        Math.round(dist * 10) / 10,
    weightCharge:      wFee,
    fragileCharge:     fFee,
    priorityFee:       deliveryType === "PRIORITY" ? PRIORITY_FEE : 0,
    scheduledDiscount: discount,
    totalFare:         total,
    riderEarnings:     earnings,
    companyCommission: commission,
    breakdown:         parts.join(" + "),
    deliveryType,
  }
}

// ─── Errand pricing ────────────────────────────────────────────────────────────
const ERRAND_BASE_FEE     = 1_500  // first 5km / 30 mins
const ERRAND_BASE_KM      = 5
const ERRAND_PER_KM       = 200
const ERRAND_RUSH_FEE     = 1_000  // within 1 hour
const ERRAND_WAIT_PER_10M = 100    // waiting time charge

export function calculateErrandFare(
  runnerLat: number, runnerLng: number,
  destLat: number,   destLng: number,
  options: {
    rush?:         boolean
    returnTrip?:   boolean
    itemCost?:     number
  } = {}
): ErrandFare {
  const dist    = haversineKm(runnerLat, runnerLng, destLat, destLng)
  const extraKm = Math.max(0, dist - ERRAND_BASE_KM)
  let fee       = ERRAND_BASE_FEE + Math.round(extraKm * ERRAND_PER_KM)

  if (options.rush)        fee += ERRAND_RUSH_FEE
  if (options.returnTrip)  fee += Math.round(fee * 0.5)  // 50% extra for return

  const commission = Math.round(fee * COMMISSION_PCT)
  const riderCut   = fee - commission

  return {
    baseFee:    ERRAND_BASE_FEE,
    distanceFee: Math.round(extraKm * ERRAND_PER_KM),
    totalFee:   fee,
    riderCut,
    commission,
  }
}

export function waitingCharge(arrivalEpoch: number): number {
  const minutesWaited = (Date.now() / 1000 - arrivalEpoch) / 60
  const periods       = Math.floor(minutesWaited / 10)
  return periods > 0 ? periods * ERRAND_WAIT_PER_10M : 0
}

export { COMMISSION_PCT, RIDER_PCT, ERRAND_WAIT_PER_10M }
