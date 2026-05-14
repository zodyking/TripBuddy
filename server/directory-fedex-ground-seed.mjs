import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mergeDirectorySeeds } from './locations-directory-store.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SEED_PATH = path.join(__dirname, 'data', 'fedex-ground-directory-seed.json')

/**
 * Merge built-in FedEx Ground seed rows into the global directory: new ids are inserted;
 * existing rows without coordinates get Lat/Long from the seed when available.
 * @returns {Promise<{ ok: boolean, skipped?: boolean, inserted?: number, coordsFilled?: number, unchanged?: number, error?: string }>}
 */
export async function mergeFedexGroundDirectorySeed() {
  let raw = ''
  try {
    raw = await fs.readFile(SEED_PATH, 'utf8')
  } catch {
    console.warn('[fedex-ground-seed] missing seed file; run server/scripts/build-fedex-directory-seed.mjs')
    return { ok: false, skipped: true }
  }
  if (!raw.trim()) {
    return { ok: false, skipped: true }
  }
  let arr
  try {
    arr = JSON.parse(raw)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[fedex-ground-seed] invalid JSON:', msg)
    return { ok: false, error: msg }
  }
  if (!Array.isArray(arr)) {
    return { ok: false, error: 'seed must be a JSON array' }
  }
  const { inserted, coordsFilled, unchanged } = await mergeDirectorySeeds(arr)
  if (inserted > 0 || coordsFilled > 0) {
    console.log(
      `[fedex-ground-seed] merged seed: ${inserted} inserted, ${coordsFilled} coordinates filled (${unchanged} unchanged)`,
    )
  }
  return { ok: true, inserted, coordsFilled, unchanged }
}
