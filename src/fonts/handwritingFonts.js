// Notera2 (signature) + Indie Flower (handwritten fields) — TTF bytes via Vite ?url + fetch

import notera2FontUrl from './Notera2PersonalUseOnlyLight-maBV.ttf?url'
import indieFlowerFontUrl from './IndieFlower-Regular.ttf?url'

const NOTERA_VFS = 'Notera2PersonalUseOnlyLight-maBV.ttf'

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
let notera2Bin = /** @type {string | null} */ (null)
let indieBin = /** @type {string | null} */ (null)
let loadPromise = /** @type {Promise<void> | null} */ (null)

async function ensureFontBytesLoaded() {
  if (notera2Bin != null && indieBin != null) return
  if (!loadPromise) {
    loadPromise = (async () => {
      const [n, i] = await Promise.all([
        loadTtfBinaryString(notera2FontUrl),
        loadTtfBinaryString(indieFlowerFontUrl),
      ])
      notera2Bin = n
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
  if (!notera2Bin || !indieBin) throw new Error('Handwriting fonts failed to load')
  if (!doc.existsFileInVFS(NOTERA_VFS)) {
    doc.addFileToVFS(NOTERA_VFS, notera2Bin)
    doc.addFont(NOTERA_VFS, 'Notera2', 'normal', undefined, 'Identity-H')
  }
  if (!doc.existsFileInVFS('IndieFlower-Regular.ttf')) {
    doc.addFileToVFS('IndieFlower-Regular.ttf', indieBin)
    doc.addFont('IndieFlower-Regular.ttf', 'IndieFlower', 'normal', undefined, 'Identity-H')
  }
}

export const FONT_SIGNATURE = 'Notera2'
export const FONT_HANDWRITING = 'IndieFlower'
