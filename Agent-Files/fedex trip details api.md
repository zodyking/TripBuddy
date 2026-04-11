$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$session.UserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36"
Invoke-WebRequest -UseBasicParsing -Uri "https://fxg-prod-prod.apigee.net/linehaul/trip/v1/trips?driverId=6544900&locationId=3117&tractorNbr=292446&status=APRVD&alreadyCalled=false" `
-WebSession $session `
-Headers @{
"Accept"="application/json, text/plain, */*"
  "Accept-Encoding"="gzip, deflate, br, zstd"
  "Accept-Language"="en-US,en;q=0.9"
  "Access-Control-Allow-Origin"="*"
  "Authorization"="Bearer eyJraWQiOiJ4a0J2UThOYnJyR0ttbWFFd3Y2LUo3SUFSOHVaSTUzUzd3aXJhWko4ZmRVIiwiYWxnIjoiUlMyNTYifQ.eyJ2ZXIiOjEsImp0aSI6IkFULldSa1M2T0pMX0U1eE85NWNkT3NuQXg0b0t5eXM3OEpTNkhkWFhnWWJGNlkiLCJpc3MiOiJodHRwczovL3B1cnBsZWlkLm9rdGEuY29tL29hdXRoMi9hdXM1bzZkNXd0TnBjRXNVSDM1NyIsImF1ZCI6IkFQUDM1MzY4NTkiLCJpYXQiOjE3NzU4NjUzNjMsImV4cCI6MTc3NTg2ODk2MywiY2lkIjoiMG9hNzNmc3NkbHBjbHJmVHkzNTciLCJ1aWQiOiIwMHUxcjYydmg2NWQ4MTdlODM1OCIsInNjcCI6WyJlbWFpbCIsImdyb3VwcyIsIm9wZW5pZCIsInByb2ZpbGUiXSwiYXV0aF90aW1lIjoxNzc1ODY1MzYyLCJzdWIiOiI2NTQ0OTAwQHZlbmRvci5sZGFwLmZlZGV4LmNvbSIsImdyb3VwcyI6WyJmeGdfbGhsX2V4ZWN1dGVfdHJpcF9kcml2ZXJfZGZfMzUzNjg1OSJdLCJlbXBsb3llZU51bWJlciI6IjY1NDQ5MDAiLCJmZHhfZWFpIjoiTi9BIn0.ppbka0RlqN1V5ECBLkDg2BL8aDRZEg-7YgY-fdvXgyyD5aBGFXIsEi-ky6esfOD3TFJJdUACwo1w0UKSEXjwPg-MHbGtzaTqmfGQTBiYyREszX0penj_yOW267kza2eeezFnEUq9IGAdc8Hm1uDqBVkdgoo6U3MncmguroRjDjMfiMjPvVzZI8yXPNiAqVtB6ahlYweroYVWVMJpmk49_AW5YyWAWk8biaWT19Iol-qKLGjow9U4iFxejkbLaw9Fn00U6LpEduARknK2KzI23ETFxZnL7yXneWLdOitj-ZMk07lBDqK2VsuGyQu8u48grmrMo-Q82FCOpnphJHPN9Q"
  "CorrelationId"="MTA_6544900_2026041019568"
  "Origin"="https://fdxtools.fedex.com"
  "Referer"="https://fdxtools.fedex.com/"
  "Sec-Fetch-Dest"="empty"
  "Sec-Fetch-Mode"="cors"
  "Sec-Fetch-Site"="cross-site"
  "Timeout"="7500"
  "clientDeviceModel"=""
  "clientDeviceType"=""
  "clientDeviceVendor"=""
  "clientOS"="Windows"
  "clientOSVersion"="10"
  "originId"="3117"
  "sec-ch-ua"="`"Chromium`";v=`"146`", `"Not-A.Brand`";v=`"24`", `"Google Chrome`";v=`"146`""
  "sec-ch-ua-mobile"="?0"
  "sec-ch-ua-platform"="`"Windows`""
}

//Request Header
GET /linehaul/trip/v1/trips?driverId=6544900&locationId=3117&tractorNbr=292446&status=APRVD&alreadyCalled=false HTTP/1.1
Accept: application/json, text/plain, */*
Accept-Encoding: gzip, deflate, br, zstd
Accept-Language: en-US,en;q=0.9
Access-Control-Allow-Origin: *
Authorization: Bearer eyJraWQiOiJ4a0J2UThOYnJyR0ttbWFFd3Y2LUo3SUFSOHVaSTUzUzd3aXJhWko4ZmRVIiwiYWxnIjoiUlMyNTYifQ.eyJ2ZXIiOjEsImp0aSI6IkFULldSa1M2T0pMX0U1eE85NWNkT3NuQXg0b0t5eXM3OEpTNkhkWFhnWWJGNlkiLCJpc3MiOiJodHRwczovL3B1cnBsZWlkLm9rdGEuY29tL29hdXRoMi9hdXM1bzZkNXd0TnBjRXNVSDM1NyIsImF1ZCI6IkFQUDM1MzY4NTkiLCJpYXQiOjE3NzU4NjUzNjMsImV4cCI6MTc3NTg2ODk2MywiY2lkIjoiMG9hNzNmc3NkbHBjbHJmVHkzNTciLCJ1aWQiOiIwMHUxcjYydmg2NWQ4MTdlODM1OCIsInNjcCI6WyJlbWFpbCIsImdyb3VwcyIsIm9wZW5pZCIsInByb2ZpbGUiXSwiYXV0aF90aW1lIjoxNzc1ODY1MzYyLCJzdWIiOiI2NTQ0OTAwQHZlbmRvci5sZGFwLmZlZGV4LmNvbSIsImdyb3VwcyI6WyJmeGdfbGhsX2V4ZWN1dGVfdHJpcF9kcml2ZXJfZGZfMzUzNjg1OSJdLCJlbXBsb3llZU51bWJlciI6IjY1NDQ5MDAiLCJmZHhfZWFpIjoiTi9BIn0.ppbka0RlqN1V5ECBLkDg2BL8aDRZEg-7YgY-fdvXgyyD5aBGFXIsEi-ky6esfOD3TFJJdUACwo1w0UKSEXjwPg-MHbGtzaTqmfGQTBiYyREszX0penj_yOW267kza2eeezFnEUq9IGAdc8Hm1uDqBVkdgoo6U3MncmguroRjDjMfiMjPvVzZI8yXPNiAqVtB6ahlYweroYVWVMJpmk49_AW5YyWAWk8biaWT19Iol-qKLGjow9U4iFxejkbLaw9Fn00U6LpEduARknK2KzI23ETFxZnL7yXneWLdOitj-ZMk07lBDqK2VsuGyQu8u48grmrMo-Q82FCOpnphJHPN9Q
Connection: keep-alive
CorrelationId: MTA_6544900_2026041019568
Host: fxg-prod-prod.apigee.net
Origin: https://fdxtools.fedex.com
Referer: https://fdxtools.fedex.com/
Sec-Fetch-Dest: empty
Sec-Fetch-Mode: cors
Sec-Fetch-Site: cross-site
Timeout: 7500
User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36
clientDeviceModel: 
clientDeviceType: 
clientDeviceVendor: 
clientOS: Windows
clientOSVersion: 10
originId: 3117
sec-ch-ua: "Chromium";v="146", "Not-A.Brand";v="24", "Google Chrome";v="146"
sec-ch-ua-mobile: ?0
sec-ch-ua-platform: "Windows"

//Request Response
HTTP/1.1 200 OK
Date: Fri, 10 Apr 2026 23:58:02 GMT
Content-Type: application/json
Transfer-Encoding: chunked
Connection: keep-alive
Server: nginx/1.19.0
Access-Control-Allow-Origin: *
Cache-Control: no-cache, no-store, max-age=0, must-revalidate
Expires: 0
Pragma: no-cache
Strict-Transport-Security: max-age=31536000 ; includeSubDomains
Vary: Origin
Vary: Access-Control-Request-Method
Vary: Access-Control-Request-Headers
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-Vcap-Request-Id: a6818b62-4226-4339-79f5-3cc9ce0faffb
X-Xss-Protection: 0
messageid: rrt-1405794849766731036-d-gea1-3210260-40293148-6

---

## Local test / response shape (FedExTool)

**Test:** `GET http://127.0.0.1:3847/api/fedex/linehaul/trips` (saved Linehaul bearer + driver/tractor; server fills `locationId` from tractor API when omitted).

**HTTP:** 200 — `Content-Type: application/json` (via proxy envelope `{ ok, status, body }`).

### `body` shape (example; IDs/names redacted)

Typical top-level fields used in the app:

- **Origin / current stop:** `originLocation`, `currentLocationNumber`, `currentLocationName`, `currentLocationAbbrv`
- **Destination:** `tripDestNumber`, `tripDest`, `tripDestAbbrv`, `tripDest` (name)
- **Trip meta:** `tripStatus`, `tripConfig`, `dailyTripLegSequence`, `tractorDomicileId`, `tractorDomicileAbbrv`, `tractorNumber`, `driver1Id`, `driver2Id`
- **Dolly (optional):** `dollyNumber1`, `dollyNumber2`, `dollyEquipmentSequence1`, `dollyEquipmentSequence2`
- **Trailers:** `trailers` — array of objects with e.g. `trlrOrder`, `emptyFlag`, `pkgWeight`, `sealNumber`, `trlrNbr`, `loadNumber`, `dailyTripLegConfigSeq`, etc.

```json
{
  "tripDest": "WOODBRIDGE",
  "tractorDomicileId": "103",
  "tractorDomicileAbbrv": "SUNY",
  "tripDestNumber": "89",
  "tripDestAbbrv": "WOOD",
  "currentLocationName": "BETHPAGE - HD",
  "currentLocationAbbrv": "QBTH",
  "currentLocationNumber": "3117",
  "originLocation": "3117",
  "dailyTripLegSequence": 272281173,
  "tripStatus": "APRVD",
  "driver1Id": "<redacted>",
  "driver2Id": null,
  "dollyNumber1": null,
  "dollyNumber2": null,
  "dollyEquipmentSequence1": null,
  "dollyEquipmentSequence2": null,
  "trailers": [
    {
      "emptyFlag": "Y",
      "pkgWeight": "0",
      "trlrOrder": "1",
      "dailyTripLegConfigSeq": 466307768,
      "sealNumber": null
    },
    {
      "emptyFlag": "Y",
      "pkgWeight": "0",
      "trlrOrder": "2",
      "dailyTripLegConfigSeq": 466307769,
      "sealNumber": null
    }
  ],
  "tripConfig": "2X",
  "tractorNumber": "292446",
  "tmsRefNbr": null
}
```

**FedExTool proxy:** `GET /api/fedex/linehaul/trips` — optional query overrides `driverId`, `locationId`, `tractorNbr`, `status` (default `APRVD`), `alreadyCalled` (default `false`), `originId` (defaults to `locationId`).

