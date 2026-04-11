import { createWorker } from 'tesseract.js'

let workerPromise

function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker('eng', 1, {
      logger: () => {},
    })
  }
  return workerPromise
}

/**
 * OCR image buffer; whitelist alphanumerics common on seals/trailers.
 * @param {Buffer} imageBuffer
 * @returns {Promise<{ text: string, confidence: number }>}
 */
export async function recognizeImage(imageBuffer) {
  const worker = await getWorker()
  await worker.setParameters({
    tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-',
  })
  const {
    data: { text, confidence },
  } = await worker.recognize(imageBuffer)
  const cleaned = text.replace(/\s+/g, ' ').trim()
  return { text: cleaned, confidence: Number.isFinite(confidence) ? confidence : 0 }
}

export async function terminateOcrWorker() {
  if (workerPromise) {
    const w = await workerPromise
    await w.terminate()
    workerPromise = null
  }
}
