import { EventEmitter } from 'node:events'

export const logBus = new EventEmitter()
logBus.setMaxListeners(100)

export function emitLog(type, message, extra = {}) {
  const payload = { type, message, ts: Date.now(), ...extra }
  logBus.emit('entry', payload)
}
