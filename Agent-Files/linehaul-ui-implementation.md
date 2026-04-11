# Linehaul UI implementation (apply in Agent mode)

**Purpose:** Username/Driver ID + tractor drive both APIs; Settings: poll interval (minutes) + manual fetch; Home: card shows API output + match.

**Blocked in Plan mode:** Copy these edits into the repo when Agent mode is on, or apply manually.

---

## 1. `server/credentials-store.mjs`

- Add `linehaulPollMinutes` to `readFileRaw` / `saveCredentials` / `clearCredentials` (0–1440, 0 = no auto poll).
- Extend `getCredentialsMeta()` with `linehaulPollMinutes` (default 0).
- Add:

```js
const DIGITS_ONLY = /^\d+$/

/** Driver API path id: Username/Driver ID (`username`) when all digits. Legacy: employeeNumber only if present until user saves merged credentials. */
export async function getLinehaulDriverId() {
  const raw = await readFileRaw()
  const u = typeof raw.username === 'string' ? raw.username.trim() : ''
  if (u && DIGITS_ONLY.test(u)) return u
  const emp = typeof raw.employeeNumber === 'string' ? raw.employeeNumber.trim() : ''
  if (emp && DIGITS_ONLY.test(emp)) return emp
  return ''
}
```

**Merged field (required):** Settings shows **one** field labeled **Username / Driver ID** — no separate “Employee / driver ID” row. On save, send `employeeNumber: ''` (or equivalent) so `saveCredentials` clears `employeeNumber` in `credentials.json` after migration.

- In `saveCredentials`, merge `linehaulPollMinutes` from body (integer clamp 0..1440).

---

## 2. `server/index.mjs`

- Import `getLinehaulDriverId` instead of using only `getEmployeeNumber` for `/api/fedex/linehaul/driver`.
- Replace default driver id resolution with `await getLinehaulDriverId()`.
- Update 400 error text: mention Username/Driver ID (digits) or optional `?driver=`.

---

## 3. New `src/stores/linehaulSnapshotStore.js`

- `ref`s: `tractorBody`, `driverBody`, `tractorError`, `driverError`, `lastFetchAt`, `fetching`.
- `refreshLinehaulApis()`: `Promise.all` or sequential `getFedexLinehaulTractor` / `getFedexLinehaulDriver` from `api.js`, catch per-call, set `lastFetchAt = Date.now()`.

---

## 4. `src/views/SettingsView.vue`

- Label **Username** → **Username/Driver ID**; hint: FedEx employee number (digits) — used for Linehaul `GET .../driver/{id}` and for Okta sign-in username.
- **Remove** the **Employee / driver ID** input entirely (do not duplicate the same value).
- Remove `credEmployee` / `employeeNumber` from save payload unless clearing: prefer **`employeeNumber: ''`** on each save so legacy `employeeNumber` in JSON is cleared once username holds the driver id.
- Add `credPollMinutes` ref; `loadCredentials` sets from `credMeta.linehaulPollMinutes ?? 0`.
- Save body includes `linehaulPollMinutes: Number(credPollMinutes)`.
- After Linehaul token section: **Linehaul auto-refresh every [number] minutes** (min 0, max 1440; 0 = off).
- **Manual fetch** button → `refreshLinehaulApis()` + `pushLiveLog` success/error.
- Meta line: include `linehaulPollMinutes` when > 0 (“every N min on Home”).

---

## 5. `src/views/MainDashboard.vue`

- Import store + `getCredentials`.
- Replace **Tractor location** panel (or merge) with **FedEx Linehaul** card:
  - Last fetch time
  - Tractor row: `locationId`, domicile abbr, status fields from `tractorBody`
  - Driver row: `driverLocation`, stats from `driverBody`
  - **Match**: compare `String(tractorBody.locationId)` to `String(driverBody.driverLocation)` when both OK
  - Errors from `tractorError` / `driverError`
- `let linehaulPollTimer = null`
- `async function setupLinehaulPolling()`:
  - `clearInterval(linehaulPollTimer); linehaulPollTimer = null`
  - `await refreshLinehaulApis()`
  - `const { linehaulPollMinutes } = await getCredentials()`
  - if `linehaulPollMinutes > 0`: `linehaulPollTimer = setInterval(refreshLinehaulApis, linehaulPollMinutes * 60 * 1000)`
- Call `setupLinehaulPolling()` from `onMounted` and `onActivated`
- `onUnmounted`: clear `linehaulPollTimer`

---

## 6. Styling

- Reuse `.panel`, `.kv` or compact `<dl>` for Linehaul card; `.hint` for “from FedEx APIs; refresh in Settings”.

---

**Security:** Bearer token unchanged; no tokens in this card—only JSON fields returned by your proxy.
