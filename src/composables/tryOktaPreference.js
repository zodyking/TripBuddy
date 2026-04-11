const KEY = 'fedextool_try_okta_login'

export function readTryOktaPreference() {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function writeTryOktaPreference(value) {
  try {
    localStorage.setItem(KEY, value ? '1' : '0')
  } catch {
    /* ignore quota / private mode */
  }
}
