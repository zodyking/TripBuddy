/**
 * Okta OpenID UserInfo (PurpleID) — same endpoint fdxtools uses for profile.
 * Requires an Okta-issued access token (not the Apigee Linehaul JWT).
 */

export const OKTA_USERINFO_URL =
  'https://purpleid.okta.com/oauth2/aus5o6d5wtNpcEsUH357/v1/userinfo'

const ORIGIN = 'https://fdxtools.fedex.com'

/**
 * @param {string} bearerToken raw JWT (no "Bearer " prefix)
 */
export async function oktaUserinfoGet(bearerToken) {
  const res = await fetch(OKTA_USERINFO_URL, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${bearerToken}`,
      Origin: ORIGIN,
      Referer: `${ORIGIN}/`,
    },
  })
  const text = await res.text()
  let body
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = { raw: text }
  }
  return {
    ok: res.ok,
    status: res.status,
    body,
  }
}
