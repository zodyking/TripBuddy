import test from 'node:test'
import assert from 'node:assert/strict'
import { pickEnglishVoice, speakUtterance } from './speechSynthesisSpeak.js'

test('pickEnglishVoice is null in Node (no speechSynthesis)', () => {
  assert.equal(pickEnglishVoice(), null)
})

test('speakUtterance is a no-op without speechSynthesis', () => {
  assert.equal(speakUtterance('Tractor details updated.'), null)
})
