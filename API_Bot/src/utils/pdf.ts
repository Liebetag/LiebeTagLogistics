// src/utils/pdf.ts
// Shipping label + receipt PDF generation using pdf-lib

import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib"

// ─── Colours ─────────────────────────────────────────────────────────────────
const C = {
  navy:   rgb(0.07, 0.13, 0.35),
  amber:  rgb(0.95, 0.62, 0.07),
  dark:   rgb(0.10, 0.10, 0.10),
  mid:    rgb(0.40, 0.40, 0.40),
  light:  rgb(0.88, 0.88, 0.88),
  white:  rgb(1.00, 1.00, 1.00),
  green:  rgb(0.13, 0.55, 0.13),
}

// A4 dimensions (pts)
const W = 595, H = 842, M = 36

// ─── Helpers ──────────────────────────────────────────────────────────────────
function rect(page: PDFPage, x: number, y: number, w: number, h: number, fill: ReturnType<typeof rgb>) {
  page.drawRectangle({ x, y, width: w, height: h, color: fill })
}

function line(page: PDFPage, x1: number, y1: number, x2: number, y2: number, color = C.light, thickness = 0.5) {
  page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, color, thickness })
}

function text(
  page: PDFPage,
  str: string,
  x: number,
  y: number,
  font: PDFFont,
  size: number,
  color = C.dark,
  maxWidth?: number,
) {
  if (!str) return
  if (maxWidth) {
    // Word-wrap
    const words = str.split(" ")
    let row = ""
    let cy  = y
    for (const word of words) {
      const test = row ? `${row} ${word}` : word
      if (font.widthOfTextAtSize(test, size) > maxWidth && row) {
        page.drawText(row, { x, y: cy, font, size, color })
        row = word
        cy -= size + 2
      } else {
        row = test
      }
    }
    if (row) page.drawText(row, { x, y: cy, font, size, color })
  } else {
    page.drawText(str, { x, y, font, size, color })
  }
}

function label(page: PDFPage, lbl: string, val: string, x: number, y: number, bold: PDFFont, regular: PDFFont, maxW = 220) {
  text(page, lbl, x, y, bold,    7, C.mid)
  text(page, val, x, y - 11, regular, 9, C.dark, maxW)
}

function formatDate(d = new Date()) {
  return d.toLocaleDateString("en-NG", {
    day: "2-digit", month: "short", year: "numeric",
    timeZone: "Africa/Lagos",
  })
}

function formatTime(d = new Date()) {
  return d.toLocaleTimeString("en-NG", {
    hour: "2-digit", minute: "2-digit",
    timeZone: "Africa/Lagos", hour12: true,
  }) + " WAT"
}

// Mask order number: show first 6 + XXXXXX + last 5
export function maskOrderNumber(orderNumber: string): string {
  if (orderNumber.length <= 11) return orderNumber
  const shown = orderNumber.length - 11
  return orderNumber.slice(0, 6) + "X".repeat(shown) + orderNumber.slice(-5)
}

// ─── Page 1: Shipping Label ───────────────────────────────────────────────────
function drawShippingLabel(
  page:    PDFPage,
  bold:    PDFFont,
  regular: PDFFont,
  order: {
    orderRef:       string
    orderNumber:    string
    senderName:     string
    senderPhone:    string
    pickupAddress:  string
    recipientName:  string
    recipientPhone: string
    dropoffAddress: string
    packageDesc:    string
    weightKg:       number
    fragile:        boolean
    deliveryType:   string
    createdAt:      Date
  }
) {
  // ── Header bar ────────────────────────────────────────────────────────────
  rect(page, 0, H - 72, W, 72, C.navy)
  text(page, "LIEBE TAG LOGISTICS", M, H - 30, bold,    18, C.white)
  text(page, "Fast Delivery & Errands · Abuja",  M, H - 48, regular, 9,  C.amber)
  text(page, "SHIPPING LABEL", W - M - 120, H - 30, bold, 11, C.amber)
  text(page, formatDate(order.createdAt), W - M - 120, H - 48, regular, 8, C.white)

  // ── Tracking reference band ───────────────────────────────────────────────
  rect(page, 0, H - 112, W, 40, C.amber)
  text(page, "TRACKING REF:", M, H - 86, bold,    7,  C.navy)
  text(page, order.orderRef,  M + 78, H - 84, bold,   16, C.navy)

  // ── Barcode-style order number ────────────────────────────────────────────
  const barY = H - 152
  rect(page, M, barY, W - 2 * M, 32, C.light)
  text(page, "ORDER NUMBER", M + 6, barY + 22, bold,    7,  C.mid)
  text(page, order.orderNumber, M + 6, barY + 10, bold, 13, C.dark)

  // ── FROM / TO columns ────────────────────────────────────────────────────
  const colY = barY - 20
  const colW = (W - 2 * M - 12) / 2

  // FROM box
  rect(page, M, colY - 130, colW, 130, rgb(0.96, 0.97, 1.0))
  rect(page, M, colY - 20,  colW, 20,  C.navy)
  text(page, "FROM", M + 6, colY - 13, bold, 9, C.white)
  label(page, "SENDER",  order.senderName,    M + 6, colY - 36, bold, regular, colW - 12)
  label(page, "PHONE",   order.senderPhone,   M + 6, colY - 66, bold, regular, colW - 12)
  label(page, "PICKUP",  order.pickupAddress, M + 6, colY - 96, bold, regular, colW - 12)

  // TO box
  const col2X = M + colW + 12
  rect(page, col2X, colY - 130, colW, 130, rgb(0.96, 1.0, 0.96))
  rect(page, col2X, colY - 20,  colW, 20,  C.green)
  text(page, "TO", col2X + 6, colY - 13, bold, 9, C.white)
  label(page, "RECIPIENT", order.recipientName,  col2X + 6, colY - 36, bold, regular, colW - 12)
  label(page, "PHONE",     order.recipientPhone, col2X + 6, colY - 66, bold, regular, colW - 12)
  label(page, "DROPOFF",   order.dropoffAddress, col2X + 6, colY - 96, bold, regular, colW - 12)

  // ── Package details ───────────────────────────────────────────────────────
  const pkgY = colY - 158
  line(page, M, pkgY + 14, W - M, pkgY + 14)
  text(page, "PACKAGE DETAILS", M, pkgY + 4, bold, 7, C.mid)
  const pkgItems = [
    `📦 ${order.packageDesc}`,
    `⚖️  ${order.weightKg || "< 1"} kg`,
    order.fragile ? "⚠️  FRAGILE — Handle with care" : "✅  Not fragile",
    `🚀 ${order.deliveryType === "PRIORITY" ? "PRIORITY (2–4 hrs)" : order.deliveryType === "SCHEDULED" ? "SCHEDULED" : "STANDARD (same day)"}`,
  ]
  pkgItems.forEach((item, i) => {
    text(page, item, M, pkgY - 10 - i * 14, regular, 9, C.dark)
  })

  // ── Footer strip ──────────────────────────────────────────────────────────
  rect(page, 0, 0, W, 32, C.navy)
  text(page, `liebetag.com/track/${order.orderRef}`, M, 12, regular, 8, C.amber)
  text(page, `Printed: ${formatDate()} ${formatTime()}`, W - M - 160, 12, regular, 7, C.white)
}

// ─── Page 2: Customer Receipt ─────────────────────────────────────────────────
function drawCustomerReceipt(
  page:    PDFPage,
  bold:    PDFFont,
  regular: PDFFont,
  order: {
    orderRef:       string
    orderNumber:    string
    senderName:     string
    senderPhone:    string
    recipientName:  string
    recipientPhone: string
    pickupAddress:  string
    dropoffAddress: string
    packageDesc:    string
    deliveryType:   string
    fareTotal:      number
    paymentType:    string
    paymentStatus:  string
    createdAt:      Date
  },
  fareExtras?: string[],
) {
  // ── Header ────────────────────────────────────────────────────────────────
  rect(page, 0, H - 72, W, 72, C.navy)
  text(page, "LIEBE TAG LOGISTICS", M, H - 30, bold,    18, C.white)
  text(page, "Fast Delivery & Errands · Abuja", M, H - 48, regular, 9, C.amber)
  text(page, "DELIVERY RECEIPT", W - M - 130, H - 36, bold, 13, C.amber)

  // ── Reference section ─────────────────────────────────────────────────────
  let y = H - 95
  rect(page, M, y - 36, W - 2 * M, 38, C.light)
  text(page, `Tracking: ${order.orderRef}`, M + 8, y - 14, bold,    10, C.navy)
  text(page, `Date: ${formatDate(order.createdAt)} at ${formatTime(order.createdAt)}`, M + 8, y - 28, regular, 8, C.mid)

  // ── Route ────────────────────────────────────────────────────────────────
  y -= 55
  text(page, "ROUTE", M, y, bold, 7, C.mid)
  line(page, M, y - 4, W - M, y - 4)

  text(page, "📍 Pickup",  M, y - 16, bold,    8, C.dark)
  text(page, order.pickupAddress, M + 60, y - 16, regular, 8, C.dark, W - 2 * M - 60)

  text(page, "🏁 Dropoff", M, y - 38, bold,    8, C.dark)
  text(page, order.dropoffAddress, M + 60, y - 38, regular, 8, C.dark, W - 2 * M - 60)

  // ── Parties ──────────────────────────────────────────────────────────────
  y -= 80
  text(page, "PARTIES", M, y, bold, 7, C.mid)
  line(page, M, y - 4, W - M, y - 4)

  const colW2 = (W - 2 * M - 12) / 2
  text(page, "Sender",         M,         y - 16, bold,    8, C.dark)
  text(page, order.senderName, M,         y - 28, regular, 9, C.dark)
  text(page, order.senderPhone,M,         y - 40, regular, 8, C.mid)

  text(page, "Recipient",           M + colW2 + 12, y - 16, bold,    8, C.dark)
  text(page, order.recipientName,   M + colW2 + 12, y - 28, regular, 9, C.dark)
  text(page, order.recipientPhone,  M + colW2 + 12, y - 40, regular, 8, C.mid)

  // ── Package ───────────────────────────────────────────────────────────────
  y -= 68
  text(page, "PACKAGE", M, y, bold, 7, C.mid)
  line(page, M, y - 4, W - M, y - 4)
  text(page, order.packageDesc, M, y - 18, regular, 9, C.dark)
  text(page, `Type: ${order.deliveryType === "PRIORITY" ? "Priority (2–4 hrs)" : "Standard (same day)"}`, M, y - 32, regular, 8, C.mid)

  // ── Fare ─────────────────────────────────────────────────────────────────
  y -= 58
  text(page, "PAYMENT", M, y, bold, 7, C.mid)
  line(page, M, y - 4, W - M, y - 4)

  // Total box
  rect(page, M, y - 46, W - 2 * M, 38, C.navy)
  text(page, "TOTAL FARE", M + 8, y - 20, regular, 8, C.white)
  text(page, `\u20A6${order.fareTotal.toLocaleString()}`, M + 8, y - 36, bold, 18, C.amber)

  if (fareExtras?.length) {
    text(page, fareExtras.join("  ·  "), M + 150, y - 36, regular, 7, C.white)
  }

  y -= 58
  const isPaid = order.paymentStatus === "confirmed" || order.paymentType === "cash"
  text(page, `Method: ${order.paymentType === "cash" ? "Cash (pay rider)" : "Online · Paystack"}`, M, y, regular, 9, C.dark)
  text(page, isPaid ? "✅  PAID" : "⏳  AWAITING PAYMENT",  M + 250, y, bold, 9, isPaid ? C.green : C.amber)

  // ── Thank-you footer ──────────────────────────────────────────────────────
  y -= 40
  line(page, M, y, W - M, y)
  text(page, "Thank you for choosing Liebe Tag Logistics!", M, y - 16, bold, 9, C.navy)
  text(page, `Track your order: liebetag.com/track/${order.orderRef}`, M, y - 30, regular, 8, C.mid)

  rect(page, 0, 0, W, 32, C.navy)
  text(page, "Liebe Tag Logistics  ·  Abuja, Nigeria  ·  liebetag.com", M, 12, regular, 8, C.white)
}

// ─── Rider Receipt page ───────────────────────────────────────────────────────
function drawRiderReceipt(
  page:    PDFPage,
  bold:    PDFFont,
  regular: PDFFont,
  order: {
    orderRef:       string
    orderNumber:    string
    recipientName:  string
    recipientPhone: string
    pickupAddress:  string
    dropoffAddress: string
    packageDesc:    string
    deliveryType:   string
    fareTotal:      number
    riderEarnings:  number
    commission:     number
    paymentType:    string
    senderPhone:    string
    senderName:     string
    createdAt:      Date
  }
) {
  // ── Header ────────────────────────────────────────────────────────────────
  rect(page, 0, H - 64, W, 64, C.navy)
  text(page, "LIEBE TAG LOGISTICS",     M, H - 26, bold,    16, C.white)
  text(page, "RIDER COPY — CONFIDENTIAL", M, H - 44, regular, 9,  C.amber)
  text(page, formatDate(order.createdAt), W - M - 80, H - 35, regular, 8, C.white)

  // ── Order reference ───────────────────────────────────────────────────────
  let y = H - 84
  rect(page, M, y - 28, W - 2 * M, 30, C.amber)
  text(page, order.orderRef, M + 8, y - 8, bold, 14, C.navy)
  text(page, `Order #: ${order.orderNumber}`, M + 8, y - 22, regular, 8, C.navy)

  // ── Route ─────────────────────────────────────────────────────────────────
  y -= 50
  text(page, "ROUTE", M, y, bold, 7, C.mid)
  line(page, M, y - 4, W - M, y - 4)
  text(page, "📍 Pickup",  M,       y - 18, bold, 8, C.dark)
  text(page, order.pickupAddress,  M + 60, y - 18, regular, 8, C.dark, W - 2 * M - 60)
  text(page, "🏁 Dropoff", M,       y - 40, bold, 8, C.dark)
  text(page, order.dropoffAddress, M + 60, y - 40, regular, 8, C.dark, W - 2 * M - 60)

  // ── Customer contacts ─────────────────────────────────────────────────────
  y -= 70
  text(page, "CONTACTS", M, y, bold, 7, C.mid)
  line(page, M, y - 4, W - M, y - 4)

  const hw = (W - 2 * M - 12) / 2
  text(page, "Sender",          M,       y - 16, bold,    8, C.dark)
  text(page, order.senderName,  M,       y - 28, regular, 9, C.dark)
  text(page, `+${order.senderPhone}`, M, y - 40, regular, 8, C.mid)

  text(page, "Recipient",           M + hw + 12, y - 16, bold,    8, C.dark)
  text(page, order.recipientName,   M + hw + 12, y - 28, regular, 9, C.dark)
  text(page, order.recipientPhone,  M + hw + 12, y - 40, regular, 8, C.mid)

  // ── Package ───────────────────────────────────────────────────────────────
  y -= 66
  text(page, "PACKAGE", M, y, bold, 7, C.mid)
  line(page, M, y - 4, W - M, y - 4)
  text(page, order.packageDesc, M, y - 18, regular, 9, C.dark)
  text(page, `Delivery: ${order.deliveryType === "PRIORITY" ? "Priority (2–4 hrs)" : "Standard"}`, M, y - 32, regular, 8, C.mid)

  // ── Earnings box ─────────────────────────────────────────────────────────
  y -= 58
  text(page, "YOUR EARNINGS", M, y, bold, 7, C.mid)
  line(page, M, y - 4, W - M, y - 4)

  rect(page, M, y - 72, W - 2 * M, 64, C.navy)
  const payLabel = order.paymentType === "cash"
    ? "💵 CASH — Collect from customer"
    : "💳 ONLINE — Already paid"
  text(page, payLabel, M + 10, y - 20, bold, 9, C.amber)

  text(page, "FARE TOTAL",          M + 10, y - 38, regular, 8, C.white)
  text(page, `YOUR CUT (85%)`,      M + 200, y - 38, regular, 8, C.white)
  text(page, `COMMISSION (15%)`,    M + 350, y - 38, regular, 7, C.light)

  text(page, `\u20A6${order.fareTotal.toLocaleString()}`,      M + 10,  y - 58, bold, 14, C.white)
  text(page, `\u20A6${order.riderEarnings.toLocaleString()}`,  M + 200, y - 58, bold, 14, C.amber)
  text(page, `\u20A6${order.commission.toLocaleString()}`,     M + 350, y - 58, regular, 11, C.light)

  // ── Footer ────────────────────────────────────────────────────────────────
  y -= 90
  text(page, "Type  delivered  when done  ·  Type  cash  to confirm cash payment", M, y, regular, 8, C.mid)

  rect(page, 0, 0, W, 28, C.navy)
  text(page, "Liebe Tag Logistics — Rider Copy", M, 8, regular, 7, C.white)
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface OrderPDFData {
  orderRef:       string
  orderNumber:    string
  senderName:     string
  senderPhone:    string
  recipientName:  string
  recipientPhone: string
  pickupAddress:  string
  dropoffAddress: string
  packageDesc:    string
  weightKg:       number
  fragile:        boolean
  deliveryType:   string
  fareTotal:      number
  riderEarnings:  number
  commission:     number
  paymentType:    string
  paymentStatus:  string
  fareExtras?:    string[]   // e.g. ["Priority +₦1,500"]
  createdAt?:     Date
}

/** Returns base64-encoded customer PDF (2 pages: label + receipt) */
export async function generateCustomerPDF(data: OrderPDFData): Promise<string> {
  const pdf   = await PDFDocument.create()
  const bold  = await pdf.embedFont(StandardFonts.HelveticaBold)
  const reg   = await pdf.embedFont(StandardFonts.Helvetica)

  const now = data.createdAt ?? new Date()

  // Page 1 — Shipping Label
  const p1 = pdf.addPage([W, H])
  drawShippingLabel(p1, bold, reg, { ...data, createdAt: now })

  // Page 2 — Customer Receipt
  const p2 = pdf.addPage([W, H])
  drawCustomerReceipt(p2, bold, reg, { ...data, createdAt: now }, data.fareExtras)

  const bytes = await pdf.save()
  return Buffer.from(bytes).toString("base64")
}

/** Returns base64-encoded rider PDF (1 page: rider receipt) */
export async function generateRiderPDF(data: OrderPDFData): Promise<string> {
  const pdf  = await PDFDocument.create()
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const reg  = await pdf.embedFont(StandardFonts.Helvetica)

  const p = pdf.addPage([W, H])
  drawRiderReceipt(p, bold, reg, { ...data, createdAt: data.createdAt ?? new Date() })

  const bytes = await pdf.save()
  return Buffer.from(bytes).toString("base64")
}
