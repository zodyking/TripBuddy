import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  matchCameraLocation,
  findBest511CameraForMapping,
  pickBestCameraView,
  NY511_BRIDGE_CAMERAS,
} from './ny511-bridge-cameras.mjs'

describe('matchCameraLocation', () => {
  it('matches substring locations case-insensitively', () => {
    assert.equal(matchCameraLocation('I-278 at 92nd Street', 'I-278 at 92nd Street'), true)
    assert.equal(matchCameraLocation('I-278 AT 92ND ST', '92nd', '92nd Street'), true)
  })
})

describe('pickBestCameraView', () => {
  it('prefers a playable video view over a disabled first view', () => {
    const cam = {
      Views: [
        { Status: 'Disabled', Url: null, VideoUrl: null },
        { Status: 'Enabled', Url: 'https://img', VideoUrl: 'https://vid.m3u8' },
      ],
    }
    const view = pickBestCameraView(cam)
    assert.equal(view?.VideoUrl, 'https://vid.m3u8')
  })
})

describe('Verrazzano-ToNJ mapping', () => {
  const mapping = NY511_BRIDGE_CAMERAS.find((m) => m.bridge === 'Verrazzano-ToNJ')
  if (!mapping) throw new Error('missing mapping')

  it('selects Fingerboard Road camera for ToNJ', () => {
    const all = [
      {
        Id: 1,
        Location: 'I-278 at 92nd Street',
        Roadway: 'I-278',
        Views: [{ Status: 'Disabled', Url: 'x', VideoUrl: null }],
      },
      {
        Id: 2,
        Location: 'I-278 at Fingerboard Road',
        Roadway: 'I-278',
        Views: [{ Status: 'Enabled', Url: 'y', VideoUrl: 'https://live' }],
      },
    ]
    const cam = findBest511CameraForMapping(all, mapping)
    assert.equal(cam && typeof cam === 'object' ? /** @type {any} */ (cam).Id : null, 2)
  })
})
