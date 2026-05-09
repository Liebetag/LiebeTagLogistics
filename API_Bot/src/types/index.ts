// src/types/index.ts

export interface Location {
  lat: number
  lng: number
  address: string
  live?: boolean
}

export interface FareBreakdown {
  baseFare:          number
  distanceCharge:    number
  distanceKm:        number
  weightCharge:      number
  fragileCharge:     number
  priorityFee:       number
  scheduledDiscount: number
  totalFare:         number
  riderEarnings:     number
  companyCommission: number
  breakdown:         string
  deliveryType:      string
}

export interface ErrandFare {
  baseFee:     number
  distanceFee: number
  totalFee:    number
  riderCut:    number
  commission:  number
}

export interface ItemData {
  name:    string
  weight:  number
  fragile: boolean
}

export interface ConversationData {
  pickup?:            Location
  dropoff?:           Location
  items?:             string[]
  itemsData?:         ItemData[]
  itemsPending?:      string[]
  itemsNeedingNames?: string[]
  currentItemWeight?: number
  currentItemIdx?:    number
  packageDesc?:       string
  weightKg?:          number
  fragile?:           boolean
  deliveryType?:      string
  scheduledTime?:     string
  fare?:              FareBreakdown
  farePreview?:       FareBreakdown
  paymentUrl?:        string
  orderRef?:          string
  orderNumber?:       string
  recipientName?:     string
  recipientPhone?:    string
  senderName?:        string
  riderPhone?:        string
  deviceId?:          string
  assignmentId?:      string
  deliveryCode?:      string
  awaitingDeliveryCode?: boolean
  paymentType?:       string
  paymentTs?:         number

  // Errand-specific
  errandType?:        string
  errandRef?:         string
  errandNumber?:      string
  errandLocation?:    Location
  errandReturnLocation?: Location
  taskDescription?:   string
  shoppingList?:      string[]
  errandDeadline?:    string
  runnerNeedsCash?:   boolean
  cashProvided?:      number
  errandFare?:        ErrandFare

  // Rider-specific
  queue?:             CurrentOrder[]
  currentOrder?:      CurrentOrder
  arriveEpoch?:       number
  arriveOrderRef?:    string
  pickupOrderNumber?: string
  pickupPhotoId?:     string
  deliverSelectionMode?: boolean
  pendingJobs?:       PendingJob[]
  pendingMode?:       string | null

  // Address suggestions
  suggestions?:       Location[]

  // AI conversation fields
  aiMessages?:        unknown[]    // AIMessage[] stored as JSON
  aiIntent?:          string
  aiConfirmIntent?:   string

  // Misc
  _lastLocation?:     Location
  _paymentTs?:        number
  [key: string]: unknown
}

export interface CurrentOrder {
  orderRef:       string
  errandRef?:     string
  customerPhone:  string
  dropoffAddress: string
  dropoffLat?:    number
  dropoffLng?:    number
  recipientPhone: string
  recipientName:  string
  packageDesc:    string
  fareTotal:      number
  paymentType:    string
  deliveryCode?:  string
  orderType?:     'delivery' | 'errand'
}

export interface PendingJob {
  customerPhone:  string
  orderRef?:      string
  errandRef?:     string
  pickupAddress:  string
  dropoffAddress: string
  deliveryType:   string
  fareTotal:      number
  paymentType:    string
  paymentPending?: boolean
  orderType?:     'delivery' | 'errand'
}

export interface GPSLocation {
  deviceId:   string
  latitude:   number | null
  longitude:  number | null
  speedKmh:   number
  heading:    number
  timestamp:  string
  battery?:   number
  signal?:    number
  label?:     string
  status?:    "online" | "offline"
}
