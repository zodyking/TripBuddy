# FedEx Linehaul — trip session API

**Purpose:** Document `GET …/trip-session/session/drivers/{driverId}` and record what the API returns (FedExTool proxies this as `GET /api/fedex/linehaul/trip-session`).

---

## Endpoint

| | |
|--|--|
| **Method** | `GET` |
| **Apigee URL** | `https://fxg-prod-prod.apigee.net/linehaul/trip/v1/trip-session/session/drivers/{driverId}` |
| **Example** | `…/trip-session/session/drivers/6544900` |
| **Auth** | `Authorization: Bearer <JWT>` (short-lived; copy from fdxtools Network tab) |
| **FedExTool proxy** | `GET http://<api-host>:3847/api/fedex/linehaul/trip-session` — optional query `?driver=<digits>`; uses saved driver id + encrypted Linehaul bearer from Settings. |

---

## Browser capture (reference)

Original PowerShell/DevTools-style capture (Authorization value should be treated as secret; rotate if leaked):

```http
GET /linehaul/trip/v1/trip-session/session/drivers/6544900 HTTP/1.1
Host: fxg-prod-prod.apigee.net
Accept: application/json, text/plain, */*
Origin: https://fdxtools.fedex.com
Referer: https://fdxtools.fedex.com/
Authorization: Bearer <redacted — paste fresh JWT from browser>
```

---

## FedExTool local test results

**Run:** 2026-04-10 (machine local time). **Request:** `GET http://127.0.0.1:3847/api/fedex/linehaul/trip-session` (saved credentials + Linehaul bearer on file).

**HTTP status:** 200

**Response envelope (FedExTool):**

```json
{
  "ok": true,
  "status": 200,
  "body": { "...": "see below" }
}
```

**`body` JSON (Apigee payload):**

```json
{
  "location": "3117",
  "tractor": "292446",
  "dollyNbr": [],
  "status": "CheckedIn",
  "emptyTrailerDetails": [],
  "dailyTripLegSequence": 272281173,
  "correlationId": "MTA_6544900_2026041019568",
  "mtaPrimary": "",
  "mtaSecondary": ""
}
```

### Fields (observed)

| Field | Type | Example / note |
|-------|------|----------------|
| `location` | string (digits) | Dispatch / location id |
| `tractor` | string (digits) | Tractor number |
| `dollyNbr` | array | Often empty `[]` |
| `status` | string | e.g. `NoApprovedTrips`, `CheckedIn` (enum-like; values may vary) |
| `emptyTrailerDetails` | array | Often empty `[]` |
| `dailyTripLegSequence` | number | Present in this snapshot; may be omitted in other states |
| `correlationId` | string | e.g. `MTA_<employee>_…` |
| `mtaPrimary` | string | May be empty |
| `mtaSecondary` | string | May be empty |

**Notes:** Tokens expire; repeat with a fresh JWT from an authenticated [fdxtools.fedex.com](https://fdxtools.fedex.com) session if you see 401/403. Do not commit live bearer tokens to git.

---

## Earlier embedded sample (pre-structure fix)

Older capture had placed the JSON on the `//Response Headers` line; one historical body shape was:

`status`: `NoApprovedTrips`, no `dailyTripLegSequence` in that paste — responses vary by session/state.
