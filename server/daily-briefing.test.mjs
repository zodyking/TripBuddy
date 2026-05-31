import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildBriefingPrompt,
  openRouterComplete,
} from './openrouter-briefing.mjs'
import {
  BRIEFING_LOOKBACK_MS,
  briefingWindowForNow,
  cleanChatText,
  formatTranscript,
  isInBriefingWindow,
} from './waha-daily-briefing.mjs'
import {
  normalizeWahaHistoryMessage,
  rowsToWahaMessages,
  wahaHistoryMessageId,
  wahaHistoryTimestampMs,
} from './waha-chat-history-pg.mjs'

test('formatTranscript produces clean timezone-aware chat text', () => {
  const transcript = formatTranscript(
    [
      {
        ts: Date.UTC(2026, 4, 31, 13, 5),
        sender: 'Alice\nDispatcher',
        text: '  Yard\u0000move\tupdated\n\nnow  ',
      },
      {
        ts: Date.UTC(2026, 4, 31, 14, 10),
        sender: 'You',
        text: '\u200BConfirmed\u202E',
      },
    ],
    'UTC',
  )

  assert.equal(
    transcript,
    '[1:05 PM] Alice Dispatcher: Yard move updated now\n[2:10 PM] You: Confirmed',
  )
})

test('formatTranscript can include dates for multi-day briefings', () => {
  const transcript = formatTranscript(
    [
      {
        ts: Date.UTC(2026, 4, 30, 23, 15),
        sender: 'Dispatcher',
        text: 'Tomorrow plan posted',
      },
    ],
    'UTC',
    { includeDate: true },
  )

  assert.equal(transcript, '[May 30, 11:15 PM] Dispatcher: Tomorrow plan posted')
})

test('buildBriefingPrompt scopes the clean transcript to the recent briefing window', () => {
  const prompt = buildBriefingPrompt(
    '[May 31, 9:00 AM] Driver: Bring empty trailers',
    'Linehaul Group',
    {
      dateLabel: '2026-05-31',
      windowLabel: '2026-05-29 through 2026-05-31',
      timeZone: 'America/New_York',
    },
  )

  assert.equal(prompt[0].role, 'system')
  assert.equal(prompt[1].role, 'user')
  assert.match(prompt[1].content, /Current date: 2026-05-31/)
  assert.match(prompt[1].content, /Briefing window: 2026-05-29 through 2026-05-31/)
  assert.match(prompt[1].content, /Time zone: America\/New_York/)
  assert.match(prompt[1].content, /Recent clean chat transcript:/)
  assert.match(prompt[1].content, /Bring empty trailers/)
})

test('briefing window includes the rolling last two days', () => {
  const now = Date.UTC(2026, 4, 31, 12, 0)
  const window = briefingWindowForNow(now, 'UTC')

  assert.equal(window.endMs, now)
  assert.equal(window.startMs, now - BRIEFING_LOOKBACK_MS)
  assert.equal(window.label, '2026-05-29 through 2026-05-31')
  assert.equal(isInBriefingWindow(now - BRIEFING_LOOKBACK_MS, now, 'UTC'), true)
  assert.equal(isInBriefingWindow(now - BRIEFING_LOOKBACK_MS - 1, now, 'UTC'), false)
  assert.equal(isInBriefingWindow(now + 1, now, 'UTC'), false)
})

test('openRouterComplete posts the documented OpenRouter chat completion payload', async (t) => {
  const originalFetch = globalThis.fetch
  let request
  t.after(() => {
    globalThis.fetch = originalFetch
  })

  globalThis.fetch = async (url, init) => {
    request = {
      url,
      init,
      body: JSON.parse(String(init.body)),
    }
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: [{ type: 'text', text: '  Briefing ready.  ' }],
            },
          },
        ],
      }),
      { status: 200 },
    )
  }

  const result = await openRouterComplete(
    '  test-key  ',
    [
      { role: 'system', content: 'System prompt' },
      { role: 'user', content: 'Chat\u0000 text   for today' },
    ],
    { model: 'openai/gpt-4o-mini', maxTokens: 321 },
  )

  assert.deepEqual(result, { ok: true, text: 'Briefing ready.' })
  assert.equal(request.url, 'https://openrouter.ai/api/v1/chat/completions')
  assert.equal(request.init.method, 'POST')
  assert.equal(request.init.headers.Authorization, 'Bearer test-key')
  assert.equal(request.init.headers['Content-Type'], 'application/json')
  assert.equal(request.init.headers['X-OpenRouter-Title'], 'TripBuddy Daily Briefing')
  assert.equal(request.body.model, 'openai/gpt-4o-mini')
  assert.equal(request.body.max_completion_tokens, 321)
  assert.equal('max_tokens' in request.body, false)
  assert.equal(request.body.temperature, 0.4)
  assert.deepEqual(request.body.messages[1], {
    role: 'user',
    content: 'Chat text for today',
  })
})

test('cleanChatText strips control and zero-width characters', () => {
  assert.equal(cleanChatText(' A\u0000\u200B  B\nC '), 'A B C')
})

test('WAHA history normalization extracts stable ids and millisecond timestamps', () => {
  const raw = {
    id: { _serialized: 'msg-1' },
    timestamp: 1_780_000_000,
    fromMe: false,
    body: 'Dispatch update',
  }

  assert.equal(wahaHistoryMessageId(raw), 'msg-1')
  assert.equal(wahaHistoryTimestampMs(raw), 1_780_000_000_000)
  assert.deepEqual(normalizeWahaHistoryMessage(raw), {
    messageId: 'msg-1',
    tsMs: 1_780_000_000_000,
    fromMe: false,
    body: 'Dispatch update',
    raw,
  })
})

test('WAHA history normalization creates fallback ids for id-less messages', () => {
  const first = normalizeWahaHistoryMessage({
    ts: 1_780_000_100_000,
    fromMe: true,
    text: 'Confirmed',
  })
  const second = normalizeWahaHistoryMessage({
    ts: 1_780_000_100_000,
    fromMe: true,
    text: 'Confirmed',
  })

  assert.ok(first.messageId.startsWith('fallback:'))
  assert.equal(first.messageId, second.messageId)
  assert.equal(first.fromMe, true)
  assert.equal(first.body, 'Confirmed')
})

test('rowsToWahaMessages restores raw WAHA payloads only', () => {
  const raw = { id: 'a', timestamp: 1_780_000_000, body: 'Hi' }
  assert.deepEqual(rowsToWahaMessages([{ raw }, { raw: null }, {}]), [raw])
})
