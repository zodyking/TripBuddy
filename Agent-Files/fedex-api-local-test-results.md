# FedEx Linehaul API local test results

**Purpose:** Record a local `Invoke-WebRequest` run against the two Apigee endpoints captured from the browser, with request headers (Authorization redacted) and full response headers and bodies.

**Test run:** 2026-04-10 (machine local time aligned with `Date` response headers below).

**Outcome:** Both endpoints returned **HTTP 200** and JSON bodies. The bearer token parsed from [`fedex tractor api`](fedex%20tractor%20api) was still accepted at test time. Tokens expire; repeat the test with a fresh token from an authenticated [fdxtools.fedex.com](https://fdxtools.fedex.com) session if you see 401/403.

---

## 1. Tractor

**Method / URL:** `GET https://fxg-prod-prod.apigee.net/linehaul/trip/v1/tractor/292446`

**Status:** 200

### Request headers (sent)

| Header | Value |
|--------|--------|
| Accept | application/json, text/plain, */* |
| Authorization | Bearer \<redacted\> |
| Origin | https://fdxtools.fedex.com |
| Referer | https://fdxtools.fedex.com/ |

### Response headers (received)

| Header | Value |
|--------|--------|
| Access-Control-Allow-Origin | * |
| Cache-Control | no-cache, no-store, max-age=0, must-revalidate |
| Connection | keep-alive |
| Content-Type | application/json |
| Date | Fri, 10 Apr 2026 23:15:34 GMT |
| Expires | 0 |
| Pragma | no-cache |
| Server | nginx/1.19.0 |
| Strict-Transport-Security | max-age=31536000 ; includeSubDomains |
| Transfer-Encoding | chunked |
| Vary | Origin,Access-Control-Request-Method,Access-Control-Request-Headers |
| X-Content-Type-Options | nosniff |
| X-Frame-Options | DENY |
| X-Vcap-Request-Id | 3bba45df-8a19-4f4d-7efd-d5a49cc01532 |
| X-Xss-Protection | 0 |
| messageid | rrt-7694352103317699956-c-gea1-2313433-99368346-1 |

### Response body (JSON)

```json
{
  "locationId": 3117,
  "tractorNbr": 292446,
  "detlCodeActvStat": "ACT",
  "detlCodeAvailStat": "AVL",
  "tractorDomicileId": "103",
  "tractorDomicileAbbrv": "SUNY"
}
```

---

## 2. Driver (ID)

**Method / URL:** `GET https://fxg-prod-prod.apigee.net/linehaul/trip/v1/driver/6544900`

**Status:** 200

### Request headers (sent)

Same as tractor (minimal set: Accept, Authorization redacted, Origin, Referer).

### Response headers (received)

| Header | Value |
|--------|--------|
| Access-Control-Allow-Origin | * |
| Cache-Control | no-cache, no-store, max-age=0, must-revalidate |
| Connection | keep-alive |
| Content-Type | application/json |
| Date | Fri, 10 Apr 2026 23:15:35 GMT |
| Expires | 0 |
| Pragma | no-cache |
| Server | nginx/1.19.0 |
| Strict-Transport-Security | max-age=31536000 ; includeSubDomains |
| Transfer-Encoding | chunked |
| Vary | Origin,Access-Control-Request-Method,Access-Control-Request-Headers |
| X-Content-Type-Options | nosniff |
| X-Frame-Options | DENY |
| X-Vcap-Request-Id | 3b3d8ddc-6557-4143-4b7f-ae0d247b6cce |
| X-Xss-Protection | 0 |
| messageid | rrt-7694352103317699956-c-gea1-2313433-99368346-2 |

### Response body (JSON)

```json
{
  "driverId": "6544900",
  "driverActvStat": "ACT",
  "driverAvlStat": "AVL",
  "firstName": "[redacted]",
  "lastName": "[redacted]",
  "driverLocation": "3117"
}
```

---

## Notes

- **Tractor `locationId` 3117** matches **driver `driverLocation` "3117"** in this snapshot, consistent with dispatch location alignment.
- Driver `firstName` / `lastName` in the JSON above are redacted in this file; the live API returned plain-text name fields.
- Do not commit or share live bearer tokens; refresh from browser DevTools when expired.
