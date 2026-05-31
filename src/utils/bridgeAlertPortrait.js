/**
 * Landscape bridge-card image for WhatsApp alerts (camera + KPIs + chart).
 */
import { bridgeCameraSnapshotUrl } from './bridgeCameraSnapshotUrl.js'

/** Landscape card — matches crossings tile proportions (cam left, data + chart right). */
const CARD_W = 720
const CARD_H = 400
const MAX_CHART_POINTS = 96

/**
 * @param {Array<{ t?: number, m?: number, s?: number }>} series
 * @param {number} maxN
 */
function downsampleSeries(series, maxN) {
  const points = (series || [])
    .map((p) => ({
      t: Number(p?.t),
      m: Number(p?.m),
      s: Number(p?.s),
    }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.m))
  if (!points.length) return []
  points.sort((a, b) => a.t - b.t)
  if (points.length <= maxN) return points
  const out = []
  const last = maxN - 1
  for (let k = 0; k < maxN; k++) {
    const i = Math.min(points.length - 1, Math.round((k * (points.length - 1)) / last))
    out.push(points[i])
  }
  return out
}

/**
 * @param {Array<{ t: number, m: number }>} pts
 */
function buildChartPaths(pts) {
  const vb = { plotL: 14, plotR: 266, plotT: 7, plotB: 34 }
  const pw = vb.plotR - vb.plotL
  const ph = vb.plotB - vb.plotT
  const tMin = pts[0].t
  const tMax = pts[pts.length - 1].t
  const spanT = Math.max(tMax - tMin, 60_000)
  const vals = pts.map((p) => p.m)
  let minM = Math.min(...vals)
  let maxM = Math.max(...vals)
  const pad = Math.max((maxM - minM) * 0.12, 0.85)
  minM = Math.max(0, minM - pad)
  maxM = maxM + pad
  if (maxM - minM < 1.25) {
    const c = (minM + maxM) / 2
    minM = Math.max(0, c - 1)
    maxM = c + 1
  }
  const spanM = Math.max(maxM - minM, 0.75)
  const xOf = (t) => vb.plotL + pw * ((t - tMin) / spanT)
  const yOf = (m) => vb.plotT + ph * (1 - (m - minM) / spanM)
  const pathPts = pts.map((pt) => ({ x: xOf(pt.t), y: yOf(pt.m) }))
  return { vb, pathPts, yBase: vb.plotB }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ vb: object, pathPts: { x: number, y: number }[], yBase: number }} chart
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {string} strokeColor
 */
function drawChart(ctx, chart, x, y, w, h, strokeColor) {
  const { vb, pathPts, yBase } = chart
  if (!pathPts.length) return
  const plotW = vb.plotR - vb.plotL
  const plotH = vb.plotB - vb.plotT
  const sx = w / plotW
  const sy = h / plotH
  const tx = (px) => x + (px - vb.plotL) * sx
  const ty = (py) => y + (py - vb.plotT) * sy
  const mapped = pathPts.map((p) => ({ x: tx(p.x), y: ty(p.y) }))
  const baseY = ty(yBase)

  ctx.save()
  ctx.beginPath()
  ctx.moveTo(mapped[0].x, baseY)
  for (const p of mapped) ctx.lineTo(p.x, p.y)
  ctx.lineTo(mapped[mapped.length - 1].x, baseY)
  ctx.closePath()
  const grad = ctx.createLinearGradient(0, y, 0, y + h)
  grad.addColorStop(0, `${strokeColor}33`)
  grad.addColorStop(1, `${strokeColor}06`)
  ctx.fillStyle = grad
  ctx.fill()

  ctx.beginPath()
  ctx.moveTo(mapped[0].x, mapped[0].y)
  for (let i = 1; i < mapped.length; i++) ctx.lineTo(mapped[i].x, mapped[i].y)
  ctx.strokeStyle = strokeColor
  ctx.lineWidth = 2.2
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.stroke()

  const last = mapped[mapped.length - 1]
  ctx.beginPath()
  ctx.arc(last.x, last.y, 3.5, 0, Math.PI * 2)
  ctx.fillStyle = strokeColor
  ctx.fill()
  ctx.restore()
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {number} r
 */
function roundRect(ctx, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rad, y)
  ctx.lineTo(x + w - rad, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad)
  ctx.lineTo(x + w, y + h - rad)
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h)
  ctx.lineTo(x + rad, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad)
  ctx.lineTo(x, y + rad)
  ctx.quadraticCurveTo(x, y, x + rad, y)
  ctx.closePath()
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {CanvasImageSource} img
 * @param {number} dx
 * @param {number} dy
 * @param {number} dw
 * @param {number} dh
 */
function drawImageCover(ctx, img, dx, dy, dw, dh) {
  const iw = img.width
  const ih = img.height
  if (!iw || !ih) return
  const scale = Math.max(dw / iw, dh / ih)
  const sw = dw / scale
  const sh = dh / scale
  const sx = (iw - sw) / 2
  const sy = (ih - sh) / 2
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh)
}

/**
 * @param {string | null | undefined} url
 * @returns {Promise<HTMLImageElement | null>}
 */
function loadImage(url) {
  const u = String(url ?? '').trim()
  if (!u) return Promise.resolve(null)
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = u
  })
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {{
 *   cameraImageUrl?: string | null,
 *   cameraStatus?: string,
 *   hasVideoOnly?: boolean,
 * }} cam
 */
async function drawCameraPanel(ctx, x, y, w, h, cam) {
  ctx.save()
  roundRect(ctx, x, y, w, h, 10)
  ctx.clip()
  ctx.fillStyle = '#0a0a10'
  ctx.fillRect(x, y, w, h)

  const img = await loadImage(cam.cameraImageUrl)
  if (img) {
    drawImageCover(ctx, img, x, y, w, h)
    ctx.fillStyle = 'rgba(0,0,0,0.25)'
    ctx.fillRect(x, y, w, h)
  } else if (cam.hasVideoOnly) {
    const g = ctx.createLinearGradient(x, y, x + w, y + h)
    g.addColorStop(0, '#1a1a28')
    g.addColorStop(1, '#0c0c14')
    ctx.fillStyle = g
    ctx.fillRect(x, y, w, h)
    ctx.fillStyle = '#9ca3af'
    ctx.font = '600 13px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('Live cam', x + w / 2, y + h / 2 - 6)
    ctx.font = '500 11px system-ui, sans-serif'
    ctx.fillText('(stream in app)', x + w / 2, y + h / 2 + 12)
    ctx.textAlign = 'left'
  } else {
    ctx.fillStyle = '#14141c'
    ctx.fillRect(x, y, w, h)
    ctx.fillStyle = '#6b7280'
    ctx.font = '500 12px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('No cam snapshot', x + w / 2, y + h / 2)
    ctx.textAlign = 'left'
  }

  ctx.fillStyle = 'rgba(0,0,0,0.55)'
  roundRect(ctx, x + 8, y + h - 28, 72, 20, 6)
  ctx.fill()
  ctx.fillStyle = '#e4e4e7'
  ctx.font = '600 10px system-ui, sans-serif'
  ctx.fillText('Bridge cam', x + 14, y + h - 14)
  if (cam.cameraStatus && cam.cameraStatus !== 'Unknown') {
    ctx.fillStyle = '#a78bfa'
    ctx.font = '500 9px system-ui, sans-serif'
    ctx.fillText(String(cam.cameraStatus).slice(0, 12), x + w - 58, y + h - 14)
  }
  ctx.restore()
}

/**
 * @param {{
 *   bridgeName: string,
 *   statusLabel: string,
 *   crossingMin: string,
 *   speedMph: string,
 *   trendShort: string,
 *   strokeColor: string,
 *   accentColor: string,
 *   series: Array<{ t?: number, m?: number, s?: number }>,
 *   updatedAtLabel?: string,
 *   cameraFeed?: {
 *     youtubeVideoId?: string | null,
 *     imageUrl?: string | null,
 *     videoUrl?: string | null,
 *     status?: string,
 *   } | null,
 * }} opts
 * @returns {Promise<Blob>}
 */
export async function renderBridgeAlertPortraitBlob(opts) {
  const canvas = document.createElement('canvas')
  canvas.width = CARD_W
  canvas.height = CARD_H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas not available')

  const accent = opts.accentColor || '#f87171'
  const stroke = opts.strokeColor || accent
  const pad = 10
  const innerW = CARD_W - pad * 2
  const innerH = CARD_H - pad * 2

  const bg = ctx.createLinearGradient(0, 0, CARD_W, CARD_H)
  bg.addColorStop(0, '#1a1a24')
  bg.addColorStop(0.5, '#101018')
  bg.addColorStop(1, '#0a0a0e')
  ctx.fillStyle = bg
  roundRect(ctx, pad, pad, innerW, innerH, 14)
  ctx.fill()

  ctx.fillStyle = accent
  ctx.fillRect(pad, pad, 4, innerH)
  roundRect(ctx, pad, pad, innerW, innerH, 14)
  ctx.strokeStyle = 'rgba(255,255,255,0.09)'
  ctx.lineWidth = 1
  ctx.stroke()

  const topY = pad + 8
  const topH = 168
  const camW = Math.round(innerW * 0.34)
  const dataX = pad + camW + 14
  const dataW = pad + innerW - dataX

  const snapUrl = bridgeCameraSnapshotUrl(opts.cameraFeed)
  const hasVideoOnly =
    !snapUrl &&
    !!(opts.cameraFeed?.videoUrl || opts.cameraFeed?.youtubeVideoId) &&
    !opts.cameraFeed?.imageUrl

  await drawCameraPanel(ctx, pad + 8, topY, camW - 8, topH, {
    cameraImageUrl: snapUrl,
    cameraStatus: opts.cameraFeed?.status,
    hasVideoOnly,
  })

  ctx.fillStyle = '#fafafa'
  ctx.font = 'bold 18px system-ui, sans-serif'
  const title = String(opts.bridgeName || 'Bridge').slice(0, 42)
  let titleY = topY + 22
  ctx.fillText(title, dataX, titleY)

  ctx.fillStyle = accent
  ctx.font = '600 11px system-ui, sans-serif'
  const status = String(opts.statusLabel || '').slice(0, 52)
  ctx.fillText(status, dataX, titleY + 18)

  const trend = opts.trendShort || '·'
  ctx.fillStyle = '#d4d4d8'
  ctx.font = 'bold 16px system-ui, sans-serif'
  ctx.textAlign = 'right'
  ctx.fillText(trend, dataX + dataW - 4, titleY + 4)
  ctx.textAlign = 'left'

  const kpiY = topY + 52
  const kpiW = (dataW - 10) / 2
  for (let i = 0; i < 2; i++) {
    const kx = dataX + i * (kpiW + 10)
    ctx.fillStyle = 'rgba(26,26,36,0.9)'
    roundRect(ctx, kx, kpiY, kpiW, 58, 8)
    ctx.fill()
    ctx.strokeStyle = '#2a2a38'
    ctx.stroke()
  }

  ctx.fillStyle = '#9ca3af'
  ctx.font = '500 10px system-ui, sans-serif'
  ctx.fillText('Crossing time', dataX + 10, kpiY + 18)
  ctx.fillText('Observed speed', dataX + 10 + kpiW + 10, kpiY + 18)

  ctx.fillStyle = '#fafafa'
  ctx.font = 'bold 26px system-ui, sans-serif'
  const cross = String(opts.crossingMin ?? '—')
  const spd = String(opts.speedMph ?? '—')
  ctx.fillText(cross, dataX + 10, kpiY + 46)
  ctx.fillText(spd, dataX + 10 + kpiW + 10, kpiY + 46)
  ctx.fillStyle = '#9ca3af'
  ctx.font = '500 11px system-ui, sans-serif'
  ctx.fillText('min', dataX + 10 + ctx.measureText(cross).width + 4, kpiY + 46)
  ctx.fillText('mph', dataX + 10 + kpiW + 10 + 28, kpiY + 46)

  const chartY = topY + topH + 10
  const chartH = pad + innerH - chartY - 8
  ctx.fillStyle = '#12121a'
  roundRect(ctx, pad + 8, chartY, innerW - 16, chartH, 10)
  ctx.fill()

  ctx.fillStyle = '#6e6e7e'
  ctx.font = '700 9px system-ui, sans-serif'
  ctx.fillText('HISTORY · CROSSING MINUTES', pad + 18, chartY + 14)

  let pts = downsampleSeries(opts.series, MAX_CHART_POINTS)
  if (pts.length === 1) {
    const p0 = pts[0]
    pts = [{ t: p0.t - 5 * 60 * 1000, m: p0.m, s: p0.s }, p0]
  }
  if (pts.length >= 2) {
    const chart = buildChartPaths(pts)
    drawChart(ctx, chart, pad + 20, chartY + 20, innerW - 40, chartH - 28, stroke)
  } else {
    ctx.fillStyle = '#6b7280'
    ctx.font = '500 12px system-ui, sans-serif'
    ctx.fillText('Not enough history yet', pad + 24, chartY + chartH / 2)
  }

  if (opts.updatedAtLabel) {
    ctx.fillStyle = '#6b7280'
    ctx.font = '500 10px system-ui, sans-serif'
    ctx.textAlign = 'right'
    ctx.fillText(opts.updatedAtLabel, pad + innerW - 12, pad + innerH - 6)
    ctx.textAlign = 'left'
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error('Failed to encode bridge alert image'))
      },
      'image/jpeg',
      0.92,
    )
  })
}
