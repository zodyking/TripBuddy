// linehaul_pretrip_refined_v7_template.js
// npm install jspdf
// Vite/plain JS: import { jsPDF } from "jspdf";

import { jsPDF } from 'jspdf'
import {
  registerHandwritingFonts,
  FONT_SIGNATURE,
  FONT_HANDWRITING,
} from '../fonts/handwritingFonts.js'

export async function generateLinehaulPretripPDF(input = {}) {
  const data = {
    tractor: '',
    destination: '',
    driver: '',
    tripDestination: '',
    eta: '',
    timezone: '',
    basedUpon: '',
    facilityName: '',
    address: '',
    city: '',
    state: '',
    zip: '',
    phone: '',
    paid: '',
    avr: '',
    invoiceRef: '',
    gpsNorth: '',
    gpsWest: '',
    originCode: '',
    originAddress: '',
    originCity: '',
    originState: '',
    originZip: '',
    originPhone: '',
    printedTime: '',
    trailers: [
      { number: '', seal: '', load: '', weight: '' },
      { number: '', seal: '', load: '', weight: '' },
      { number: '', seal: '', load: '', weight: '' },
    ],
    dollies: ['', ''],
    // Driver-filled fields (handwriting style)
    driverSignature: '',
    signatureDate: '',
    driverId: '',
    ...input,
  }

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: [612, 768],
    compress: true,
  })

  doc.setTextColor(0, 0, 0)
  doc.setDrawColor(0, 0, 0)

  // Register custom handwriting fonts (TTF via Vite asset URL + fetch)
  await registerHandwritingFonts(doc)

  const font = (size = 8, style = 'normal', family = 'helvetica') => {
    doc.setFont(family, style)
    doc.setFontSize(size)
  }

  const text = (value, x, y, size = 8, style = 'normal', options = {}) => {
    font(size, style, options.family || 'helvetica')
    doc.text(String(value ?? ''), x, y, options)
  }

  const box = (x, y, w, h, lw = 1.35) => {
    doc.setLineWidth(lw)
    doc.rect(x, y, w, h)
  }

  const line = (x1, y1, x2, y2, lw = 0.95) => {
    doc.setLineWidth(lw)
    doc.line(x1, y1, x2, y2)
  }

  const center = (value, x, y, w, size = 8, style = 'bold', family = 'helvetica') => {
    text(value, x + w / 2, y, size, style, { align: 'center', family })
  }

  const checkbox = (x, y) => box(x, y, 9.5, 9.5, 1.0)

  // Handwriting-style text for general driver-filled fields (Indie Flower - realistic handwriting)
  const handwriting = (value, x, y, size = 11) => {
    if (!value) return
    doc.setFont(FONT_HANDWRITING, 'normal')
    doc.setFontSize(size)
    // Blue-black color to simulate ballpoint pen
    doc.setTextColor(10, 10, 90)
    doc.text(String(value), x, y)
    doc.setTextColor(0, 0, 0)
  }

  // Cursive signature style (Caveat - flowing cursive for signatures)
  const signature = (value, x, y, size = 14) => {
    if (!value) return
    doc.setFont(FONT_SIGNATURE, 'normal')
    doc.setFontSize(size)
    // Blue-black color to simulate ballpoint pen
    doc.setTextColor(10, 10, 90)
    doc.text(String(value), x, y)
    doc.setTextColor(0, 0, 0)
  }

  // Header
  text('Tractor:', 22, 24, 9.2, 'bold')
  text(data.tractor, 70, 24, 12.0, 'bold', { family: 'courier' })
  text('Destination', 142, 24, 9.2, 'bold')
  text(data.destination, 219, 24, 11.2, 'bold', { family: 'courier' })
  text('DRIVER', 332, 24, 9.2, 'bold')
  text(data.driver, 386, 24, 9.2, 'bold')
  text('DRIVER', 332, 42, 9.2, 'bold')

  // Linehaul responsibilities box. The original scan has no divider here.
  box(17, 55, 578, 45)
  text('Linehaul Driver', 23, 70, 8.4, 'bold')
  text('- Trailer seal numbers, Dolly IDs, and Pre-Trip Inspection', 23, 84, 7.2)
  text('- Return completed form to Linehaul Office', 23, 95, 7.2)
  text('Linehaul Responsibilities:', 318, 70, 8.4, 'bold')
  text('- Seals provided match TLCRs, the proper FedEx ID and dolly', 318, 84, 7.2)
  text('  numbers are correct in TMS', 318, 95, 7.2)

  // Safety strip
  box(17, 107, 578, 24)
  center('LIGHTS AND SEAT BELTS ON FOR SAFETY?', 17, 125, 286, 10.2, 'bold')
  center('ALL COUPLING DEVICES SECURE?', 309, 125, 286, 10.2, 'bold')

  const leftX = 15
  const leftW = 289
  const rightX = 309
  const rightW = 281

  // Main boxes
  box(leftX, 137, leftW, 419)
  box(leftX, 570, leftW, 43)

  box(rightX, 137, rightW, 83)
  box(rightX, 232, rightW, 39)
  box(rightX, 284, rightW, 80)
  box(rightX, 377, rightW, 37)
  box(rightX, 427, rightW, 80)
  box(rightX, 519, rightW, 88)

  // Left panel content
  text('TRIP DESTINATION:', 24, 168, 10.0, 'bold')
  text(data.tripDestination, 137, 168, 15.2, 'bold', { family: 'courier' })

  text('ETA OF TRIP LEG:', 24, 211, 12.0)
  text(data.eta, 45, 241, 14.8, 'bold', { family: 'courier' })
  text(data.timezone, 240, 241, 14.8, 'bold', { family: 'courier' })

  text('BASED UPON', 22, 276, 9.0, 'bold')
  text(data.basedUpon, 103, 276, 8.8, 'bold')

  text(data.facilityName, 22, 299, 10.2, 'bold')
  text(data.address, 69, 316, 10.0, 'bold')

  text(data.city, 60, 363, 10.0, 'bold')
  text(data.state, 205, 363, 8.0, 'bold')
  text(data.zip, 237, 363, 7.5, 'normal', { family: 'courier' })
  text(data.phone, 60, 380, 10.0, 'bold')

  text('PAID', 22, 412, 11.0, 'bold')
  text(data.paid, 161, 412, 10.0)

  text('STANDARD ROUTE DETAILS PROVIDED UPON REQUEST', 22, 443, 7.8)
  text(`AUTOMATED DISPATCH / ARRIVAL (AVR): ${data.avr}`, 22, 473, 7.4, 'bold')
  text('.', 22, 489, 7.0)

  text('GPS COORDINATES:', 22, 522, 9.0)
  text(data.gpsNorth, 160, 522, 9.0)
  text(data.gpsWest, 160, 542, 9.0)

  // Purchased carrier invoice
  text('PURCHASED CARRIER INVOICE', 22, 585, 9.0)
  text('REFERENCE #:', 22, 604, 9.0)
  line(94, 604, 296, 604)
  if (data.invoiceRef) text(data.invoiceRef, 100, 601, 8.5, 'bold')

  function trailerBlock(index, values, titleY, sealY, loadY, weightY) {
    text(`TRAILER ${index}:`, rightX + 6, titleY, 8.8, 'bold')
    if (values?.number) text(values.number, rightX + 70, titleY, 11.2, 'bold', { family: 'courier' })

    text('SEAL:', rightX + 6, sealY, 8.3)
    line(rightX + 46, sealY, rightX + rightW - 12, sealY, 0.9)
    // Render seal value in handwriting style if present
    if (values?.seal) handwriting(values.seal, rightX + 50, sealY - 3, 9)

    text('LOAD', rightX + 6, loadY, 8.3)
    center(values?.load || '', rightX + 114, loadY, 145, 8.8, 'bold')

    text('PACKAGE WEIGHT:', rightX + 6, weightY, 8.3)
    center(values?.weight || '', rightX + 126, weightY, 100, 8.6, 'normal')
  }

  trailerBlock(1, data.trailers?.[0], 150, 168, 188, 209)

  text('DOLLY 1:', rightX + 6, 254, 8.8)
  line(371, 254, 582, 254, 0.9)
  if (data.dollies?.[0]) handwriting(data.dollies[0], 376, 251, 9)

  trailerBlock(2, data.trailers?.[1], 297, 316, 337, 356)

  text('DOLLY 2:', rightX + 6, 398, 8.8)
  line(371, 398, 582, 398, 0.9)
  if (data.dollies?.[1]) handwriting(data.dollies[1], 376, 395, 9)

  trailerBlock(3, data.trailers?.[2], 439, 458, 478, 497)

  // Origin box
  text('TRIP LEG ORIGIN:', rightX + 6, 532, 8.8, 'bold')
  text(data.originCode, 397, 532, 8.5, 'bold', { family: 'courier' })
  text(data.originAddress, rightX + 6, 551, 8.0, 'bold')
  text(data.originCity, rightX + 6, 588, 8.0, 'bold')
  text(data.originState, 485, 588, 7.8, 'bold')
  text(data.originZip, 529, 588, 7.8, 'bold', { family: 'courier' })
  text(data.originPhone, rightX + 6, 599, 8.0, 'bold')

  // DOT section
  box(17, 621, 578, 133)
  center('DOT REQUIRED PRE-TRIP', 17, 634, 578, 10.8, 'bold')

  const base = 656
  const items1 = ['LIGHTS / REFLECTORS', 'TIRES / WHEELS', 'BRAKES', 'SUSPENSION']
  const items2 = ['AIR LINES / AIR SYSTEMS', 'DOOR / DOOR LATCHES', 'LANDING GEAR', 'FRAME']
  const items3 = ['COUPLING DEVICES (e.g., FIFTH WHEEL, PINTLE HOOK)', 'SAFETY CHAIN', 'BODY:', 'OTHER:']

  function checklistColumn(x, items) {
    items.forEach((item, index) => {
      const y = base + index * 14
      checkbox(x, y - 9)
      // Add checkmark inside the checkbox to simulate filled form
      text('X', x + 2.5, y - 1, 7.5, 'bold')
      text(item, x + 18, y, 6.5, 'bold')
    })
  }

  checklistColumn(27, items1)
  checklistColumn(166, items2)
  // Third column - only check first two items (COUPLING DEVICES, SAFETY CHAIN), leave BODY and OTHER unchecked
  const items3First = items3.slice(0, 2)
  const items3Last = items3.slice(2)
  items3First.forEach((item, index) => {
    const y = base + index * 14
    checkbox(322, y - 9)
    text('X', 324.5, y - 1, 7.5, 'bold')
    text(item, 340, y, 6.5, 'bold')
  })
  items3Last.forEach((item, index) => {
    const y = base + (index + 2) * 14
    checkbox(322, y - 9)
    text(item, 340, y, 6.5, 'bold')
  })
  line(373, 684, 554, 684)
  line(373, 698, 554, 698)

  text(
    'I have inspected all of the above components on the above vehicles/equipment as required by 49 CFR Part 396 and declare that all are compliant with DOT standards',
    29,
    710,
    4.4,
  )

  text('Driver Signature', 29, 727, 7.0)
  line(102, 727, 347, 727)
  // Driver signature in cursive style (Caveat font)
  if (data.driverSignature) signature(data.driverSignature, 110, 724, 14)

  text('Date', 365, 727, 7.0)
  line(398, 727, 554, 727)
  // Date in handwriting style (Indie Flower font)
  if (data.signatureDate) handwriting(data.signatureDate, 405, 722, 11)

  text('Driver ID Number:', 29, 744, 7.0)
  line(122, 744, 347, 744)
  // Driver ID in handwriting style (Indie Flower font)
  if (data.driverId) handwriting(data.driverId, 130, 740, 11)

  // Kept at the crop edge like the scanned original.
  text('Printed Time:', 348, 766, 7.0, 'bold')
  text(data.printedTime, 412, 766, 7.0)

  return doc
}

export async function downloadLinehaulPretripPDF(data = {}) {
  const doc = await generateLinehaulPretripPDF(data)
  doc.save('linehaul-pretrip-refined-v7.pdf')
}
