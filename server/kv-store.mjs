import { getPostgresPool, pgGetJson, pgSetJson, postgresReady } from './kv-pg.mjs'

/**
 * @param {string} key
 * @param {() => unknown} getDefault
 */
export async function readKeyJson(key, getDefault) {
  await getPostgresPool()
  if (!postgresReady()) {
    throw new Error('Database not ready')
  }
  const v = await pgGetJson(key)
  if (v != null) return v
  return getDefault()
}

/**
 * @param {string} key
 * @param {unknown} value
 */
export async function writeKeyJson(key, value) {
  await getPostgresPool()
  if (!postgresReady()) {
    throw new Error('Database not ready')
  }
  await pgSetJson(key, value)
}
