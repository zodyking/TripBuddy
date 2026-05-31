import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildBriefingPrompt,
  openRouterComplete,
} from './openrouter-briefing.mjs'
import {
  cleanChatText,
  formatTranscript,
} from './waha-daily-briefing.mjs'

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

test('buildBriefingPrompt scopes the clean transcript to the current date', () => {
  const prompt = buildBriefingPrompt(
    '[9:00 AM] Driver: Bring empty trailers',
    'Linehaul Group',
    { dateLabel: '2026-05-31', timeZone: 'America/New_York' },
  )

  assert.equal(prompt[0].role, 'system')
  assert.equal(prompt[1].role, 'user')
  assert.match(prompt[1].content, /Current date: 2026-05-31/)
  assert.match(prompt[1].content, /Time zone: America\/New_York/)
  assert.match(prompt[1].content, /Today's clean chat transcript:/)
  assert.match(prompt[1].content, /Bring empty trailers/)
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
