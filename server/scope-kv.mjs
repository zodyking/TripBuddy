import { accountKeyForUsername } from './account-identity.mjs'
import { getLastActiveAccountKey } from './active-account.mjs'
import { isAuthEnabled } from './auth-session.mjs'
import { requestAsyncLocalStorage } from './request-context.mjs'

const G = (suffix) => `g:${suffix}`

/**
 * Stable account id: session, last active, env, or (auth off) `single_user` for single-tenant dev.
 * @returns {string}
 */
export function getDataAccountKey() {
  const fromEnv = (process.env.FEDEX_TOOL_DATA_ACCOUNT_KEY || '').trim()
  if (fromEnv) return fromEnv
  const req = requestAsyncLocalStorage.getStore()
  if (req && typeof req === 'object' && req.credentialAccountKey) {
    return String(req.credentialAccountKey)
  }
  const last = getLastActiveAccountKey()
  if (last) return last
  if (isAuthEnabled() === false) {
    return 'single_user'
  }
  return ''
}

/**
 * @param {string} suffix e.g. `directory`, `access:log`
 * @param {string} [forceAccount] explicit account key (e.g. from `accountKeyForUsername` on pre-login)
 */
export function userScopeKey(suffix, forceAccount) {
  const ak =
    forceAccount && String(forceAccount).length > 0
      ? String(forceAccount)
      : getDataAccountKey()
  if (!ak) {
    throw new Error(
      'No data account: log in, or set FEDEX_TOOL_DATA_ACCOUNT_KEY (disabling auth uses built-in `single_user` scope).',
    )
  }
  return `u:${ak}:${suffix}`
}

/**
 * For access log on login (before session): key by normalized username.
 * @param {string} username
 */
export function keyForLoginAccessLog(username) {
  const t = String(username || '').trim()
  const ak = accountKeyForUsername(t)
  if (!ak) {
    return G('access:log:anonymous')
  }
  return userScopeKey('access:log', ak)
}

/**
 * Explicit user key (when you have `accountKey` and want `u:…:suffix`).
 * @param {string} accountKey
 * @param {string} suffix
 */
export function keyForUser(accountKey, suffix) {
  if (!accountKey) {
    throw new Error('keyForUser: accountKey required')
  }
  return `u:${accountKey}:${suffix}`
}

export { G }
