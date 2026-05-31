import { describe, it, expect } from 'vitest'
import {
  extractUrlsFromText,
  isLinkOnlyMessage,
  parseMessageTextSegments,
  normalizeUrlToken,
} from './chatMessageLinks.js'

describe('chatMessageLinks', () => {
  it('extracts URLs and trims trailing punctuation', () => {
    expect(extractUrlsFromText('see https://example.com/path.')).toEqual([
      'https://example.com/path',
    ])
    expect(normalizeUrlToken('https://x.com/.')).toBe('https://x.com/')
  })

  it('detects link-only messages', () => {
    expect(isLinkOnlyMessage('https://example.com')).toBe(true)
    expect(isLinkOnlyMessage('check https://example.com now')).toBe(false)
  })

  it('parses segments', () => {
    expect(parseMessageTextSegments('hi https://a.com bye')).toEqual([
      { type: 'text', value: 'hi ' },
      { type: 'url', value: 'https://a.com' },
      { type: 'text', value: ' bye' },
    ])
  })
})
