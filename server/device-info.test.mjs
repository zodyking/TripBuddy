import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  parseDeviceFromUserAgent,
  detectBrowser,
  formatDeviceClassLabel,
} from '../src/utils/deviceInfo.js'

const IPHONE_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.153 Mobile/15E148 Safari/604.1'

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'

const IPAD_DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'

const ANDROID_PHONE =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'

const ANDROID_TABLET =
  'Mozilla/5.0 (Linux; Android 13; SM-X900) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36'

const MAC_SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'

const WINDOWS_CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

test('detects iPhone Chrome (CriOS) not Safari on macOS', () => {
  const p = parseDeviceFromUserAgent(IPHONE_CHROME, {
    maxTouchPoints: 5,
    platform: 'iPhone',
    screenMinCssPx: 393,
  })
  assert.equal(p.deviceClass, 'iphone')
  assert.equal(p.browser, 'Chrome')
  assert.equal(p.formFactor, 'mobile')
  assert.match(p.os, /^iOS/)
  assert.equal(p.defaultName, 'Chrome on iPhone')
})

test('detects iPhone Safari', () => {
  const p = parseDeviceFromUserAgent(IPHONE_SAFARI, {
    maxTouchPoints: 5,
    platform: 'iPhone',
    screenMinCssPx: 393,
  })
  assert.equal(p.deviceClass, 'iphone')
  assert.equal(p.browser, 'Safari')
})

test('detects iPad from desktop Macintosh UA with touch', () => {
  const p = parseDeviceFromUserAgent(IPAD_DESKTOP_UA, {
    maxTouchPoints: 5,
    platform: 'MacIntel',
    screenMinCssPx: 820,
  })
  assert.equal(p.deviceClass, 'ipad')
  assert.equal(p.formFactor, 'tablet')
  assert.match(p.os, /^iPadOS/)
})

test('detects MacBook vs iPhone from Macintosh UA using screen size', () => {
  const mac = parseDeviceFromUserAgent(MAC_SAFARI, {
    maxTouchPoints: 0,
    platform: 'MacIntel',
    screenMinCssPx: 900,
  })
  assert.equal(mac.deviceClass, 'mac')
  assert.equal(mac.formFactor, 'desktop')
  assert.match(mac.os, /^macOS/)

  const phone = parseDeviceFromUserAgent(IPAD_DESKTOP_UA, {
    maxTouchPoints: 5,
    platform: 'iPhone',
    screenMinCssPx: 390,
  })
  assert.equal(phone.deviceClass, 'iphone')
})

test('detects Android phone and tablet', () => {
  const phone = parseDeviceFromUserAgent(ANDROID_PHONE, {})
  assert.equal(phone.deviceClass, 'android-phone')
  assert.equal(phone.browser, 'Chrome')
  assert.equal(formatDeviceClassLabel(phone.deviceClass), 'Android phone')

  const tablet = parseDeviceFromUserAgent(ANDROID_TABLET, {})
  assert.equal(tablet.deviceClass, 'android-tablet')
  assert.equal(formatDeviceClassLabel(tablet.deviceClass), 'Android tablet')
})

test('detects Windows PC', () => {
  const p = parseDeviceFromUserAgent(WINDOWS_CHROME, { maxTouchPoints: 0 })
  assert.equal(p.deviceClass, 'windows-pc')
  assert.equal(p.browser, 'Chrome')
  assert.match(p.os, /^Windows/)
})

test('detectBrowser prioritizes iOS browser tokens', () => {
  assert.equal(detectBrowser(IPHONE_CHROME), 'Chrome')
  assert.equal(detectBrowser(IPHONE_SAFARI), 'Safari')
})
