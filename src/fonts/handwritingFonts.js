// Caveat (signature) + Indie Flower (handwritten fields) — TTF bytes loaded via Vite ?url + fetch
// so jsPDF VFS always gets valid font data (large base64 ?raw imports can mis-bundle).

import caveatFontUrl from './Caveat-Regular.ttf?url'
import indieFlowerFontUrl from './IndieFlower-Regular.ttf?url'

/** @param {ArrayBuffer} buf */
function arrayBufferToBinaryString(buf) {
  const bytes = new Uint8Array(buf)
  const chunk = 0x8000
  let out = ''
  for (let i = 0; i < bytes.length; i += chunk) {
    const sub = bytes.subarray(i, i + chunk)
    out += String.fromCharCode.apply(null, sub)
  }
  return out
}

/**
 * @param {string} url
 * @returns {Promise<string>}
 */
async function loadTtfBinaryString(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to load font (${res.status}): ${url}`)
  return arrayBufferToBinaryString(await res.arrayBuffer())
}

/** Cached TTF binary strings (shared across PDFs). */
let caveatBin = /** @type {string | null} */ (null)
let indieBin = /** @type {string | null} */ (null)
let loadPromise = /** @type {Promise<void> | null} */ (null)

async function ensureFontBytesLoaded() {
  if (caveatBin != null && indieBin != null) return
  if (!loadPromise) {
    loadPromise = (async () => {
      const [c, i] = await Promise.all([
        loadTtfBinaryString(caveatFontUrl),
        loadTtfBinaryString(indieFlowerFontUrl),
      ])
      caveatBin = c
      indieBin = i
    })()
  }
  await loadPromise
}

/**
 * Register handwriting fonts on this jsPDF instance (each doc has its own VFS).
 * @param {import('jspdf').jsPDF} doc
 */
export async function registerHandwritingFonts(doc) {
  await ensureFontBytesLoaded()
  if (!caveatBin || !indieBin) throw new Error('Handwriting fonts failed to load')
  if (!doc.existsFileInVFS('Caveat-Regular.ttf')) {
    doc.addFileToVFS('Caveat-Regular.ttf', caveatBin)
    doc.addFont('Caveat-Regular.ttf', 'Caveat', 'normal', undefined, 'Identity-H')
  }
  if (!doc.existsFileInVFS('IndieFlower-Regular.ttf')) {
    doc.addFileToVFS('IndieFlower-Regular.ttf', indieBin)
    doc.addFont('IndieFlower-Regular.ttf', 'IndieFlower', 'normal', undefined, 'Identity-H')
  }
}

export const FONT_SIGNATURE = 'Caveat'
export const FONT_HANDWRITING = 'IndieFlower'
