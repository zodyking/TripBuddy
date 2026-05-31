import { describe, it, expect } from 'vitest'
import {
  CHAT_IMAGE_LOAD_WINDOW_MS,
  shouldFetchChatMedia,
  shouldShowPhoneMediaPlaceholder,
  shouldRenderInlineMedia,
  getChatMediaDisplayState,
} from './chatMediaPolicy.js'

const now = Date.now()
const recent = now - 60_000
const old = now - CHAT_IMAGE_LOAD_WINDOW_MS - 60_000

describe('chatMediaPolicy', () => {
  it('fetches recent images without url', () => {
    expect(
      shouldFetchChatMedia({
        ts: recent,
        hasMedia: true,
        media: { kind: 'image', url: '' },
      }),
    ).toBe(true)
  })

  it('does not fetch old images', () => {
    expect(
      shouldFetchChatMedia({
        ts: old,
        hasMedia: true,
        media: { kind: 'image', url: '' },
      }),
    ).toBe(false)
  })

  it('never fetches video', () => {
    expect(
      shouldFetchChatMedia({
        ts: recent,
        hasMedia: true,
        media: { kind: 'video', url: '' },
      }),
    ).toBe(false)
  })

  it('shows phone placeholder for video and old images', () => {
    expect(
      shouldShowPhoneMediaPlaceholder({
        ts: recent,
        hasMedia: true,
        media: { kind: 'video', url: 'http://x/y.mp4' },
      }),
    ).toBe(true)
    expect(
      shouldShowPhoneMediaPlaceholder({
        ts: old,
        hasMedia: true,
        media: { kind: 'image', url: '' },
      }),
    ).toBe(true)
  })

  it('renders inline only for recent images with url', () => {
    expect(
      shouldRenderInlineMedia({
        ts: recent,
        hasMedia: true,
        media: { kind: 'image', url: 'http://x/y.jpg' },
      }),
    ).toBe(true)
    expect(
      shouldRenderInlineMedia({
        ts: old,
        hasMedia: true,
        media: { kind: 'image', url: 'http://x/y.jpg' },
      }),
    ).toBe(false)
  })

  it('display state pending vs placeholder', () => {
    expect(
      getChatMediaDisplayState({
        ts: recent,
        hasMedia: true,
        media: { kind: 'image', url: '' },
      }),
    ).toBe('pending')
    expect(
      getChatMediaDisplayState({
        ts: old,
        hasMedia: true,
        media: { kind: 'image', url: '' },
      }),
    ).toBe('placeholder')
  })
})
