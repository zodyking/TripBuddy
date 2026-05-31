/**
 * Portrait PNG for bridge traffic WhatsApp alerts (matches card data: KPIs + history chart).
 */

const PORTRAIT_W = 400
const PORTRAIT_H = 560
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
 * @param {string} strokeColor
 */
function buildChartPaths(pts, strokeColor) {
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
  const pathPts = pts.map((pt) => ({
    x: xOf(pt.t),
    y: yOf(pt.m),
  }))
  return { vb, pathPts, strokeColor, yBase: vb.plotB }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ vb: object, pathPts: { x: number, y: number }[], strokeColor: string, yBase: number }} chart
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 */
function drawChart(ctx, chart, x, y, w, h) {
  const { vb, pathPts, strokeColor, yBase } = chart
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
  ctx.lineWidth = 2.5
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.stroke()

  const last = mapped[mapped.length - 1]
  ctx.beginPath()
  ctx.arc(last.x, last.y, 4, 0, Math.PI * 2)
  ctx.fillStyle = strokeColor
  ctx.fill()
  ctx.strokeStyle = '#0f0f14'
  ctx.lineWidth = 1
  ctx.stroke()
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
 * }} opts
 * @returns {Promise<Blob>}
 */
export async function renderBridgeAlertPortraitBlob(opts) {
  const canvas = document.createElement('canvas')
  canvas.width = PORTRAIT_W
  canvas.height = PORTRAIT_H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas not available')

  const accent = opts.accentColor || '#f87171'
  const stroke = opts.strokeColor || accent

  const bg = ctx.createLinearGradient(0, 0, 0, PORTRAIT_H)
  bg.addColorStop(0, '#16161e')
  bg.addColorStop(1, '#0c0c10')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, PORTRAIT_W, PORTRAIT_H)

  ctx.fillStyle = accent
  ctx.fillRect(0, 0, PORTRAIT_W, 5)

  ctx.strokeStyle = `${accent}55`
  ctx.lineWidth = 1
  ctx.strokeRect(12, 16, PORTRAIT_W - 24, PORTRAIT_H - 28)

  ctx.fillStyle = '#f4f4f5'
  ctx.font = 'bold 22px system-ui, sans-serif'
  const title = String(opts.bridgeName || 'Bridge').slice(0, 48)
  ctx.fillText(title, 28, 58)

  ctx.fillStyle = accent
  ctx.font = '600 13px system-ui, sans-serif'
  const status = String(opts.statusLabel || '').slice(0, 40)
  ctx.fillText(status, 28, 82)

  const kpiY = 108
  const kpiW = (PORTRAIT_W - 56 - 12) / 2
  for (let i = 0; i < 2; i++) {
    const kx = 28 + i * (kpiW + 12)
    ctx.fillStyle = '#1a1a24'
    ctx.beginPath()
    roundRect(ctx, kx, kpiY, kpiW, 72, 10)
    ctx.fill()
    ctx.strokeStyle = '#2a2a38'
    ctx.stroke()
  }

  ctx.fillStyle = '#9ca3af'
  ctx.font = '500 11px system-ui, sans-serif'
  ctx.fillText('Crossing time', 40, kpiY + 22)
  ctx.fillText('Observed speed', 40 + kpiW + 12, kpiY + 22)

  ctx.fillStyle = '#fafafa'
  ctx.font = 'bold 28px system-ui, sans-serif'
  ctx.fillText(String(opts.crossingMin ?? '—'), 40, kpiY + 54)
  ctx.font = 'bold 22px system-ui, sans-serif'
  ctx.fillText(String(opts.speedMph ?? '—'), 40 + kpiW + 12, kpiY + 54)

  ctx.fillStyle = '#9ca3af'
  ctx.font = '500 12px system-ui, sans-serif'
  ctx.fillText('min', 40 + ctx.measureText(String(opts.crossingMin ?? '—')).width + 6, kpiY + 54)
  ctx.fillText('mph', 40 + kpiW + 12 + 36, kpiY + 54)

  ctx.fillStyle = '#d4d4d8'
  ctx.font = '600 14px system-ui, sans-serif'
  ctx.fillText(`Trend ${opts.trendShort || '·'}`, 28, 198)

  ctx.fillStyle = '#9ca3af'
  ctx.font = '500 11px system-ui, sans-serif'
  ctx.fillText('History · crossing minutes', 28, 222)

  const chartY = 236
  const chartH = 240
  ctx.fillStyle = '#12121a'
  roundRect(ctx, 24, chartY, PORTRAIT_W - 48, chartH, 12)
  ctx.fill()

  let pts = downsampleSeries(opts.series, MAX_CHART_POINTS)
  if (pts.length === 1) {
    const p0 = pts[0]
    pts = [{ t: p0.t - 5 * 60 * 1000, m: p0.m, s: p0.s }, p0]
  }
  if (pts.length >= 2) {
    const chart = buildChartPaths(pts, stroke)
    drawChart(ctx, chart, 36, chartY + 16, PORTRAIT_W - 72, chartH - 32)
  } else {
    ctx.fillStyle = '#6b7280'
    ctx.font = '500 13px system-ui, sans-serif'
    ctx.fillText('Not enough history yet', 28, chartY + chartH / 2)
  }

  if (opts.updatedAtLabel) {
    ctx.fillStyle = '#6b7280'
    ctx.font = '500 11px system-ui, sans-serif'
    ctx.fillText(opts.updatedAtLabel, 28, PORTRAIT_H - 24)
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error('Failed to encode portrait image'))
      },
      'image/jpeg',
      0.9,
    )
  })
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
