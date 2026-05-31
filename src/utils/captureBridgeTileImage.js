/**
 * Capture the on-screen bridge crossing card as a JPEG (pixel-perfect vs UI).
 */
import { bridgeCameraSnapshotUrl } from './bridgeCameraSnapshotUrl.js'

/**
 * In the cloned DOM, swap live video/iframe for a still so html2canvas can paint it.
 * @param {HTMLElement} tile
 * @param {import('./bridgeCameraSnapshotUrl.js').BridgeCameraFeed | null | undefined} cameraFeed
 */
function patchCameraInClone(tile, cameraFeed) {
  const snapUrl = bridgeCameraSnapshotUrl(cameraFeed)
  const camCol = tile.querySelector('.bridge-camera-col')
  if (!camCol) return

  const makeImg = () => {
    const img = tile.ownerDocument.createElement('img')
    img.alt = 'Bridge camera'
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;'
    if (snapUrl) img.src = snapUrl
    return img
  }

  for (const iframe of camCol.querySelectorAll('iframe')) {
    const parent = iframe.parentElement
    if (!parent) continue
    if (snapUrl) {
      parent.replaceChild(makeImg(), iframe)
    } else {
      iframe.style.visibility = 'hidden'
    }
  }

  for (const video of camCol.querySelectorAll('video')) {
    const parent = video.parentElement
    if (!parent) continue
    if (snapUrl) {
      parent.replaceChild(makeImg(), video)
    } else {
      video.style.visibility = 'hidden'
    }
  }

  const existingImg = camCol.querySelector('img.camera-img, img')
  if (existingImg instanceof HTMLImageElement && snapUrl && !existingImg.src) {
    existingImg.src = snapUrl
  }
}

/**
 * @param {HTMLElement} tileEl `.bridge-tile` list item
 * @param {{
 *   routeId?: string,
 *   cameraFeed?: {
 *     youtubeVideoId?: string | null,
 *     imageUrl?: string | null,
 *     videoUrl?: string | null,
 *     status?: string,
 *   } | null,
 * }} [opts]
 * @returns {Promise<Blob>}
 */
export async function captureBridgeTileElement(tileEl, opts = {}) {
  if (!tileEl || !(tileEl instanceof HTMLElement)) {
    throw new Error('Bridge tile element not found')
  }

  const html2canvas = (await import('html2canvas')).default
  const routeId = String(opts.routeId ?? '').trim()
  const scale = Math.min(2.5, Math.max(1.5, window.devicePixelRatio || 2))

  const canvas = await html2canvas(tileEl, {
    backgroundColor: '#0a0a0e',
    scale,
    useCORS: true,
    allowTaint: true,
    logging: false,
    scrollX: 0,
    scrollY: -window.scrollY,
    windowWidth: document.documentElement.clientWidth,
    onclone: (clonedDoc) => {
      const tile = routeId
        ? clonedDoc.getElementById(`bridge-tile-${routeId}`)
        : clonedDoc.querySelector('.bridge-tile')
      if (tile instanceof HTMLElement) {
        tile.style.transform = 'none'
        tile.style.boxShadow = '0 4px 18px rgba(0,0,0,0.38)'
        patchCameraInClone(tile, opts.cameraFeed)
      }
    },
  })

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error('Failed to encode bridge card image'))
      },
      'image/jpeg',
      0.93,
    )
  })
}

/**
 * @param {string} routeId
 * @returns {HTMLElement | null}
 */
export function findBridgeTileElement(routeId) {
  const id = String(routeId ?? '').trim()
  if (!id) return null
  const el = document.getElementById(`bridge-tile-${id}`)
  return el instanceof HTMLElement ? el : null
}
