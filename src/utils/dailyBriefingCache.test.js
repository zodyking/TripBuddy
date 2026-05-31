import test from 'node:test'
import assert from 'node:assert/strict'

/** @type {Record<string, string>} */
const store = {}
globalThis.localStorage = {
  getItem: (k) => store[k] ?? null,
  setItem: (k, v) => { store[k] = String(v) },
  removeItem: (k) => { delete store[k] },
}

const {
  computeThreadLastMessageKey,
  getCachedBriefingIfValid,
  writeBriefingCacheEntry,
} = await import('./dailyBriefingCache.js')

test('computeThreadLastMessageKey uses newest timestamp', () => {
  const key = computeThreadLastMessageKey([
    { id: 'a', ts: 100 },
    { id: 'b', ts: 200 },
  ])
  assert.equal(key, 'b:200')
})

test('briefing cache replays same day when last message unchanged', () => {
  const chatId = 'test@g.us'
  const lastKey = 'm1:999'
  writeBriefingCacheEntry(chatId, {
    briefing: 'All quiet.',
    messageCount: 3,
    lastMessageKey: lastKey,
  })
  const hit = getCachedBriefingIfValid(chatId, lastKey)
  assert.equal(hit?.briefing, 'All quiet.')
  assert.equal(getCachedBriefingIfValid(chatId, 'm2:1000'), null)
})
