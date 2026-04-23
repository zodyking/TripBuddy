import fs from 'node:fs/promises'
import path from 'node:path'
import { isPostgresConfigured, getPostgresPool, pgGetJson, pgSetJson, postgresReady } from './kv-pg.mjs'

async function pgOn() {
  if (!isPostgresConfigured()) return false
  await getPostgresPool()
  return postgresReady()
}

const mirrorToFile = () => process.env.FEDEX_TOOL_KV_FILE_MIRROR === '1'

/**
 * Read: PostgreSQL first, else migrate from JSON file once, else default.
 * @param {string} docKey
 * @param {string} filePath
 * @param {() => unknown} getDefault
 */
export async function readKVJson(docKey, filePath, getDefault) {
  if (await pgOn()) {
    const v = await pgGetJson(docKey)
    if (v != null) return v
  }
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    const j = JSON.parse(raw)
    if (await pgOn()) {
      try {
        await pgSetJson(docKey, j)
      } catch (e) {
        console.error('[kv-store] migrate to PG failed:', e.message || e)
      }
    }
    return j
  } catch {
    return getDefault()
  }
}

/**
 * Write: PostgreSQL when on; JSON file only if FEDEX_TOOL_KV_FILE_MIRROR=1
 * (default: PG-only to avoid dual sources of truth).
 * @param {string} docKey
 * @param {string} filePath
 * @param {unknown} value
 */
export async function writeKVJson(docKey, filePath, value) {
  if (await pgOn()) {
    await pgSetJson(docKey, value)
  }
  if (mirrorToFile() || !(await pgOn())) {
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  }
}
