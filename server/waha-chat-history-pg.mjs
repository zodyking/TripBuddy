import crypto from 'node:crypto'
import { getPostgresPool } from './kv-pg.mjs'
import { wahaMessageTimestampMs } from '../src/utils/wahaMessageTime.js'

const MESSAGE_TABLE = 'fedextool_waha_chat_message'
const META_TABLE = 'fedextool_waha_chat_meta'

function cleanId(value) {
  return String(value ?? '').trim()
}

function messageKeyObject(msg) {
  const data = msg?._data && typeof msg._data === 'object' ? msg._data : {}
  if (msg?.key && typeof msg.key === 'object') return msg.key
  if (data?.key && typeof data.key === 'object') return data.key
  return {}
}

export function wahaHistoryMessageId(msg) {
  if (!msg || typeof msg !== 'object') return ''
  const id = msg.id
  if (typeof id === 'string' && id.trim()) return id.trim()
  if (id && typeof id === 'object') {
    const nested = cleanId(id._serialized || id.id)
    if (nested) return nested
  }
  const key = messageKeyObject(msg)
  const keyId = cleanId(key._serialized || key.id)
  if (keyId) return keyId
  return ''
}

export function wahaHistoryTimestampMs(msg) {
  return wahaMessageTimestampMs(msg)
}

export function wahaHistoryFromMe(msg) {
  const data = msg?._data && typeof msg._data === 'object' ? msg._data : {}
  const key = messageKeyObject(msg)
  return Boolean(msg?.fromMe ?? data?.fromMe ?? key?.fromMe)
}

function rawBody(msg) {
  return String(msg?.body ?? msg?.text ?? msg?.caption ?? '').trim()
}

function fallbackMessageId(msg) {
  const body = rawBody(msg).slice(0, 256)
  const hash = crypto
    .createHash('sha1')
    .update(JSON.stringify({
      ts: wahaHistoryTimestampMs(msg),
      fromMe: wahaHistoryFromMe(msg),
      body,
      author: msg?.author || msg?.participant || messageKeyObject(msg)?.participant || '',
    }))
    .digest('hex')
  return `fallback:${hash}`
}

export function normalizeWahaHistoryMessage(msg) {
  if (!msg || typeof msg !== 'object') return null
  const tsMs = wahaHistoryTimestampMs(msg)
  if (!tsMs) return null
  const messageId = wahaHistoryMessageId(msg) || fallbackMessageId(msg)
  return {
    messageId,
    tsMs,
    fromMe: wahaHistoryFromMe(msg),
    body: rawBody(msg),
    raw: msg,
  }
}

export function rowsToWahaMessages(rows) {
  if (!Array.isArray(rows)) return []
  return rows
    .map((row) => {
      if (row?.raw && typeof row.raw === 'object') return row.raw
      return null
    })
    .filter(Boolean)
}

export async function ensureWahaChatHistoryTable() {
  const p = await getPostgresPool()
  if (!p) return
  const client = await p.connect()
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${MESSAGE_TABLE} (
        account_key TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        ts_ms BIGINT NOT NULL,
        from_me BOOLEAN NOT NULL DEFAULT false,
        body TEXT,
        raw JSONB NOT NULL DEFAULT '{}'::jsonb,
        synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (account_key, chat_id, message_id)
      )
    `)
    await client.query(`
      CREATE INDEX IF NOT EXISTS ${MESSAGE_TABLE}_chat_ts
      ON ${MESSAGE_TABLE} (account_key, chat_id, ts_ms)
    `)
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${META_TABLE} (
        account_key TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        contacts JSONB NOT NULL DEFAULT '[]'::jsonb,
        lids JSONB NOT NULL DEFAULT '[]'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (account_key, chat_id)
      )
    `)
  } finally {
    client.release()
  }
}

export async function upsertWahaChatMeta(accountKey, chatId, opts = {}) {
  const ak = cleanId(accountKey)
  const id = cleanId(chatId)
  if (!ak || !id) return
  const p = await getPostgresPool()
  if (!p) return
  await ensureWahaChatHistoryTable()
  const contacts = Array.isArray(opts.contacts) ? opts.contacts : []
  const lids = Array.isArray(opts.lids) ? opts.lids : []
  await p.query(
    `INSERT INTO ${META_TABLE} (account_key, chat_id, contacts, lids, updated_at)
     VALUES ($1, $2, $3::jsonb, $4::jsonb, now())
     ON CONFLICT (account_key, chat_id) DO UPDATE SET
       contacts = EXCLUDED.contacts,
       lids = EXCLUDED.lids,
       updated_at = now()`,
    [ak, id, JSON.stringify(contacts), JSON.stringify(lids)],
  )
}

export async function upsertWahaMessages(accountKey, chatId, messages) {
  const ak = cleanId(accountKey)
  const id = cleanId(chatId)
  if (!ak || !id || !Array.isArray(messages) || !messages.length) return { stored: 0 }
  const normalized = messages
    .map((msg) => normalizeWahaHistoryMessage(msg))
    .filter(Boolean)
  if (!normalized.length) return { stored: 0 }
  const p = await getPostgresPool()
  if (!p) return { stored: 0 }
  await ensureWahaChatHistoryTable()
  const client = await p.connect()
  try {
    await client.query('BEGIN')
    for (const m of normalized) {
      await client.query(
        `INSERT INTO ${MESSAGE_TABLE}
           (account_key, chat_id, message_id, ts_ms, from_me, body, raw, synced_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, now())
         ON CONFLICT (account_key, chat_id, message_id) DO UPDATE SET
           ts_ms = EXCLUDED.ts_ms,
           from_me = EXCLUDED.from_me,
           body = EXCLUDED.body,
           raw = EXCLUDED.raw,
           synced_at = now()`,
        [
          ak,
          id,
          m.messageId,
          m.tsMs,
          m.fromMe,
          m.body,
          JSON.stringify(m.raw),
        ],
      )
    }
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
  return { stored: normalized.length }
}

export async function readWahaThreadHistory(accountKey, chatId, opts = {}) {
  const ak = cleanId(accountKey)
  const id = cleanId(chatId)
  if (!ak || !id) return null
  const p = await getPostgresPool()
  if (!p) return null
  await ensureWahaChatHistoryTable()
  const limit = Math.min(5000, Math.max(1, Number(opts.limit) || 500))
  const { rows } = await p.query(
    `SELECT message_id, ts_ms, from_me, body, raw
     FROM ${MESSAGE_TABLE}
     WHERE account_key = $1 AND chat_id = $2
     ORDER BY ts_ms DESC
     LIMIT $3`,
    [ak, id, limit],
  )
  const meta = await p.query(
    `SELECT contacts, lids, updated_at
     FROM ${META_TABLE}
     WHERE account_key = $1 AND chat_id = $2`,
    [ak, id],
  )
  const messages = rowsToWahaMessages(rows).reverse()
  if (!messages.length && !meta.rows[0]) return null
  const updatedAtRaw = meta.rows[0]?.updated_at
  return {
    chatId: id,
    updatedAt: updatedAtRaw ? new Date(updatedAtRaw).getTime() : Date.now(),
    messages,
    contacts: Array.isArray(meta.rows[0]?.contacts) ? meta.rows[0].contacts : [],
    lids: Array.isArray(meta.rows[0]?.lids) ? meta.rows[0].lids : [],
    fromPostgres: true,
  }
}

export async function readWahaThreadHistoryAroundDate(accountKey, chatId, now, opts = {}) {
  const ak = cleanId(accountKey)
  const id = cleanId(chatId)
  if (!ak || !id) return null
  const p = await getPostgresPool()
  if (!p) return null
  await ensureWahaChatHistoryTable()
  const nowMs = Number(new Date(now).getTime())
  const anchor = Number.isFinite(nowMs) ? nowMs : Date.now()
  const lookbackMs = Math.max(24, Math.min(168, Number(opts.lookbackHours) || 72)) * 60 * 60 * 1000
  const limit = Math.min(5000, Math.max(100, Number(opts.limit) || 2000))
  const { rows } = await p.query(
    `SELECT message_id, ts_ms, from_me, body, raw
     FROM ${MESSAGE_TABLE}
     WHERE account_key = $1
       AND chat_id = $2
       AND ts_ms >= $3
       AND ts_ms <= $4
     ORDER BY ts_ms ASC
     LIMIT $5`,
    [ak, id, Math.max(0, anchor - lookbackMs), anchor + 6 * 60 * 60 * 1000, limit],
  )
  if (!rows.length) return null
  return {
    chatId: id,
    updatedAt: Date.now(),
    messages: rowsToWahaMessages(rows),
    contacts: [],
    lids: [],
    fromPostgres: true,
  }
}
