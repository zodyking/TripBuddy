import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * Fastify request object (set in onRequest via `run`).
 * Authenticated routes set `credentialAccountKey` on the request in preHandler.
 */
export const requestAsyncLocalStorage = new AsyncLocalStorage()

/**
 * Run async work scoped to a user credential file (e.g. Playwright during login).
 * @param {string} accountKey
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 * @template T
 */
export function runWithCredentialAccountKey(accountKey, fn) {
  const fakeReq = { credentialAccountKey: accountKey }
  return requestAsyncLocalStorage.run(fakeReq, fn)
}
