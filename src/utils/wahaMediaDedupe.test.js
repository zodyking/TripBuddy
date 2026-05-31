import { describe, it, expect } from 'vitest'
import { dedupeThreadMediaMessages } from './wahaApi.js'

describe('dedupeThreadMediaMessages', () => {
  it('keeps video and drops nearby thumbnail image', () => {
    const ts = 1_700_000_000_000
    const out = dedupeThreadMediaMessages([
      {
        id: 'a',
        ts,
        fromMe: true,
        hasMedia: true,
        text: '',
        media: { kind: 'image', url: 'https://x/a.jpg' },
      },
      {
        id: 'b',
        ts: ts + 500,
        fromMe: true,
        hasMedia: true,
        text: '',
        media: { kind: 'video', url: 'https://x/a.mp4' },
      },
    ])
    expect(out).toHaveLength(1)
    expect(out[0].media?.kind).toBe('video')
  })

  it('does not remove messages with different captions', () => {
    const ts = 1_700_000_000_000
    const out = dedupeThreadMediaMessages([
      {
        id: 'a',
        ts,
        fromMe: false,
        hasMedia: true,
        text: 'first',
        media: { kind: 'image', url: 'https://x/1.jpg' },
      },
      {
        id: 'b',
        ts: ts + 1000,
        fromMe: false,
        hasMedia: true,
        text: 'second',
        media: { kind: 'image', url: 'https://x/2.jpg' },
      },
    ])
    expect(out).toHaveLength(2)
  })
})
