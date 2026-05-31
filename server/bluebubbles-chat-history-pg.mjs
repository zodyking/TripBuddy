import crypto from 'node:crypto'
import { getPostgresPool } from './kv-pg.mjs'

const MESSAGE_TABLE = 'fedextool_bluebubbles_chat_message'
const META_TABLE = 'fedextool_bluebubbles_chat_meta'

function cleanId(value) {
  return String(value ?? '').trim()
}

export function bbHistoryMessageId(msg) {
  if (!msg || typeof msg !== 'object') return ''
  const id = cleanId(msg.guid || msg.id)
  if (id) return id
  return ''
}

export function bbHistoryTimestampMs(msg) {
  const ts = Number(msg?.dateCreated ?? msg?.date ?? msg?.ts ?? 0)
  if (Number.isFinite(ts) && ts > 0) {
    return ts < 1e12 ? ts * 1000 : ts
  }
  return 0
}

export function bbHistoryFromMe(msg) {
  return Boolean(msg?.isFromMe)
}

function rawBody(msg) {
  return String(msg?.text ?? msg?.body ?? msg?.subject ?? '').trim()
}

function fallbackMessageId(msg) {
  const body = rawBody(msg).slice(0, 256)
  const hash = crypto
    .createHash('sha1')
    .update(JSON.stringify({
      ts: bbHistoryTimestampMs(msg),
      fromMe: bbHistoryFromMe(msg),
      body,
      handle: msg?.handle?.address || '',
    }))
    .digest('hex')
  return `fallback:${hash}`
}

export function normalizeBbHistoryMessage(msg) {
  if (!msg || typeof msg !== 'object') return null
  const tsMs = bbHistoryTimestampMs(msg)
  if (!tsMs) return null
  const messageId = bbHistoryMessageId(msg) || fallbackMessageId(msg)
  return {
    messageId,
    tsMs,
    fromMe: bbHistoryFromMe(msg),
    body: rawBody(msg),
    raw: msg,
  }
}

export function rowsToBbMessages(rows) {
  if (!Array.isArray(rows)) return []
  return rows
    .map((row) => {
      if (row?.raw && typeof row.raw === 'object') return row.raw
      return null
    })
    .filter(Boolean)
}

export async function ensureBlueBubblesChatHistoryTable() {
  const p = await getPostgresPool()
  if (!p) return
  const client = await p.connect()
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${MESSAGE_TABLE} (
        account_key TEXT NOT NULL,
        chat_guid TEXT NOT NULL,
        message_id TEXT NOT NULL,
        ts_ms BIGINT NOT NULL,
        from_me BOOLEAN NOT NULL DEFAULT false,
        body TEXT,
        raw JSONB NOT NULL DEFAULT '{}'::jsonb,
        synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (account_key, chat_guid, message_id)
      )
    `)
    await client.query(`
      CREATE INDEX IF NOT EXISTS ${MESSAGE_TABLE}_chat_ts
      ON ${MESSAGE_TABLE} (account_key, chat_guid, ts_ms)
    `)
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${META_TABLE} (
        account_key TEXT NOT NULL,
        chat_guid TEXT NOT NULL,
        display_name TEXT,
        participants JSONB NOT NULL DEFAULT '[]'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (account_key, chat_guid)
      )
    `)
  } finally {
    client.release()
  }
}

export async function upsertBlueBubblesChatMeta(accountKey, chatGuid, opts = {}) {
  const ak = cleanId(accountKey)
  const id = cleanId(chatGuid)
  if (!ak || !id) return
  const p = await getPostgresPool()
  if (!p) return
  await ensureBlueBubblesChatHistoryTable()
  const displayName = String(opts.displayName ?? '').trim().slice(0, 500)
  const participants = Array.isArray(opts.participants) ? opts.participants : []
  await p.query(
    `INSERT INTO ${META_TABLE} (account_key, chat_guid, display_name, participants, updated_at)
     VALUES ($1, $2, $3, $4::jsonb, now())
     ON CONFLICT (account_key, chat_guid) DO UPDATE SET
       display_name = COALESCE(NULLIF(EXCLUDED.display_name, ''), ${META_TABLE}.display_name),
       participants = CASE WHEN EXCLUDED.participants != '[]'::jsonb THEN EXCLUDED.participants ELSE ${META_TABLE}.participants END,
       updated_at = now()`,
    [ak, id, displayName, JSON.stringify(participants)],
  )
}

export async function upsertBlueBubblesMessages(accountKey, chatGuid, messages) {
  const ak = cleanId(accountKey)
  const id = cleanId(chatGuid)
  if (!ak || !id || !Array.isArray(messages) || !messages.length) return { stored: 0 }
  const normalized = messages
    .map((msg) => normalizeBbHistoryMessage(msg))
    .filter(Boolean)
  if (!normalized.length) return { stored: 0 }
  const p = await getPostgresPool()
  if (!p) return { stored: 0 }
  await ensureBlueBubblesChatHistoryTable()
  const client = await p.connect()
  try {
    await client.query('BEGIN')
    for (const m of normalized) {
      await client.query(
        `INSERT INTO ${MESSAGE_TABLE}
           (account_key, chat_guid, message_id, ts_ms, from_me, body, raw, synced_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, now())
         ON CONFLICT (account_key, chat_guid, message_id) DO UPDATE SET
           ts_ms = EXCLUDED.ts_ms,
           from_me = EXCLUDED.from_me,
           body = EXCLUDED.body,
           raw = EXCLUDED.raw,
           synced_at = now()`,
        [ak, id, m.messageId, m.tsMs, m.fromMe, m.body, JSON.stringify(m.raw)],
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

export async function readBlueBubblesThreadHistory(accountKey, chatGuid, opts = {}) {
  const ak = cleanId(accountKey)
  const id = cleanId(chatGuid)
  if (!ak || !id) return null
  const p = await getPostgresPool()
  if (!p) return null
  await ensureBlueBubblesChatHistoryTable()
  const limit = Math.min(5000, Math.max(1, Number(opts.limit) || 500))
  const { rows } = await p.query(
    `SELECT message_id, ts_ms, from_me, body, raw
     FROM ${MESSAGE_TABLE}
     WHERE account_key = $1 AND chat_guid = $2
     ORDER BY ts_ms DESC
     LIMIT $3`,
    [ak, id, limit],
  )
  const meta = await p.query(
    `SELECT display_name, participants, updated_at
     FROM ${META_TABLE}
     WHERE account_key = $1 AND chat_guid = $2`,
    [ak, id],
  )
  const messages = rowsToBbMessages(rows).reverse()
  if (!messages.length && !meta.rows[0]) return null
  const updatedAtRaw = meta.rows[0]?.updated_at
  return {
    chatGuid: id,
    updatedAt: updatedAtRaw ? new Date(updatedAtRaw).getTime() : Date.now(),
    messages,
    displayName: meta.rows[0]?.display_name || '',
    participants: Array.isArray(meta.rows[0]?.participants) ? meta.rows[0].participants : [],
    fromPostgres: true,
  }
}
