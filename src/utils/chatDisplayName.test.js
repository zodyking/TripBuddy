import test from 'node:test'
import assert from 'node:assert/strict'
import { formatChatDisplayName, chatAvatarInitial } from './chatDisplayName.js'

test('formatChatDisplayName puts given name first for Last, First', () => {
  assert.deepEqual(formatChatDisplayName('McRae, Taylor'), {
    firstName: 'Taylor',
    lastName: 'McRae',
    displayTitle: 'Taylor McRae',
    briefingLabel: 'Taylor McRae',
  })
})

test('formatChatDisplayName strips WhatsApp tilde prefix', () => {
  const r = formatChatDisplayName('~Nelfy Santiago')
  assert.equal(r.firstName, 'Nelfy')
  assert.equal(r.lastName, 'Santiago')
  assert.equal(r.displayTitle, 'Nelfy Santiago')
})

test('chatAvatarInitial uses first name letter', () => {
  assert.equal(chatAvatarInitial('McRae, Taylor'), 'T')
})
