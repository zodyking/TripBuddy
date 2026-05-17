// Handwriting fonts for jsPDF - Caveat (signature) and Indie Flower (handwritten fields)
// Fonts are loaded from base64-encoded TTF files

import caveatBase64 from './caveat-base64.txt?raw'
import indieFlowerBase64 from './indieflower-base64.txt?raw'

/**
 * Register handwriting fonts with a jsPDF document instance
 * @param {import('jspdf').jsPDF} doc - The jsPDF document instance
 */
export function registerHandwritingFonts(doc) {
  // Register Caveat (cursive signature font)
  doc.addFileToVFS('Caveat-Regular.ttf', caveatBase64.trim())
  doc.addFont('Caveat-Regular.ttf', 'Caveat', 'normal')

  // Register Indie Flower (handwritten text font)
  doc.addFileToVFS('IndieFlower-Regular.ttf', indieFlowerBase64.trim())
  doc.addFont('IndieFlower-Regular.ttf', 'IndieFlower', 'normal')
}

export const FONT_SIGNATURE = 'Caveat'
export const FONT_HANDWRITING = 'IndieFlower'
