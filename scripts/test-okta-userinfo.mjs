/**
 * Local test: GET Okta OpenID userinfo (same URL as fdxtools browser).
 * Usage:
 *   OKTA_ACCESS_TOKEN="eyJ..." node scripts/test-okta-userinfo.mjs
 *   node scripts/test-okta-userinfo.mjs eyJ...
 *   node scripts/test-okta-userinfo.mjs --append   (append result to Agent-Files doc on 200)
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const USERINFO =
  'https://purpleid.okta.com/oauth2/aus5o6d5wtNpcEsUH357/v1/userinfo'
const DOC = path.join(__dirname, '..', 'Agent-Files', 'fedex user details api')

const args = process.argv.slice(2)
const appendDoc = args.includes('--append')
const tokenArg = args.find((a) => a !== '--append')

const token =
  process.env.OKTA_ACCESS_TOKEN?.trim() ||
  (tokenArg && !tokenArg.startsWith('--') ? tokenArg.trim() : '')

if (!token) {
  console.error(
    'Set OKTA_ACCESS_TOKEN or pass the JWT as the first argument.\n' +
      'Example: OKTA_ACCESS_TOKEN=eyJ... node scripts/test-okta-userinfo.mjs',
  )
  process.exit(1)
}

const res = await fetch(USERINFO, {
  headers: {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
    Origin: 'https://fdxtools.fedex.com',
    Referer: 'https://fdxtools.fedex.com/',
  },
})
const text = await res.text()
let body
try {
  body = text ? JSON.parse(text) : null
} catch {
  body = { raw: text }
}

console.log('status', res.status)
console.log(JSON.stringify(body, null, 2))

const block = `

---

## Local test run (scripts/test-okta-userinfo.mjs)

- Date: ${new Date().toISOString()}
- HTTP status: ${res.status}
- given_name / family_name: ${body && typeof body === 'object' ? JSON.stringify({ given_name: body.given_name, family_name: body.family_name }) : 'n/a'}

Response body (truncated if huge):

\`\`\`json
${JSON.stringify(body, null, 2).slice(0, 8000)}
\`\`\`
`

if (appendDoc && res.ok) {
  try {
    await fs.appendFile(DOC, block, 'utf8')
    console.log('Appended to', DOC)
  } catch (e) {
    console.error('Append failed:', e.message)
  }
} else if (appendDoc && !res.ok) {
  console.error('Not appending (--append only writes on HTTP 2xx)')
}

process.exit(res.ok ? 0 : 1)
