import * as pdfjsLib from 'pdfjs-dist'
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

let workerConfigured = false

/**
 * PDF.js may transfer the underlying buffer to the worker; always pass a fresh copy.
 * @param {ArrayBuffer | Uint8Array} pdfBytes
 * @returns {Uint8Array}
 */
function clonePdfBytes(pdfBytes) {
  const view = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes)
  return view.slice()
}

function ensurePdfWorker() {
  if (!workerConfigured) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker
    workerConfigured = true
  }
}

/**
 * Rasterize one PDF page to a JPEG data URL, scaled to fit a rectangle in **mm** (jsPDF units).
 * @param {ArrayBuffer | Uint8Array} pdfBytes
 * @param {number} pageNumber 1-based
 * @param {{ maxWidthMm: number, maxHeightMm: number }} box
 * @returns {Promise<{ dataUrl: string, widthMm: number, heightMm: number }>}
 */
export async function renderPdfPageToJpegDataUrl(pdfBytes, pageNumber, box) {
  ensurePdfWorker()
  const u8 = clonePdfBytes(pdfBytes)
  const task = pdfjsLib.getDocument({ data: u8 })
  const pdf = await task.promise
  const page = await pdf.getPage(pageNumber)
  const baseVp = page.getViewport({ scale: 1 })
  const ar = baseVp.width / baseVp.height
  let widthMm = box.maxWidthMm
  let heightMm = widthMm / ar
  if (heightMm > box.maxHeightMm) {
    heightMm = box.maxHeightMm
    widthMm = heightMm * ar
  }

  /** ~3 px/mm for readable print when embedded in letter PDF */
  const pxPerMm = 3
  const canvasW = Math.min(4096, Math.max(1, Math.round(widthMm * pxPerMm)))
  const scale = canvasW / baseVp.width
  const viewport = page.getViewport({ scale })

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(viewport.width)
  canvas.height = Math.round(viewport.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  const renderTask = page.render({
    canvasContext: ctx,
    viewport,
    intent: 'display',
  })
  await renderTask.promise
  const dataUrl = canvas.toDataURL('image/jpeg', 0.9)
  try {
    await pdf.destroy()
  } catch {
    /* ignore */
  }
  return { dataUrl, widthMm, heightMm }
}

/**
 * @param {ArrayBuffer | Uint8Array} pdfBytes
 * @returns {Promise<number>}
 */
export async function getPdfPageCount(pdfBytes) {
  ensurePdfWorker()
  const u8 = clonePdfBytes(pdfBytes)
  const task = pdfjsLib.getDocument({ data: u8 })
  const pdf = await task.promise
  try {
    return pdf.numPages
  } finally {
    try {
      await pdf.destroy()
    } catch {
      /* ignore */
    }
  }
}
