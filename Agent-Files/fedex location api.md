$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$session.UserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36"
Invoke-WebRequest -UseBasicParsing -Uri "https://fxg-prod-prod.apigee.net/linehaul/trip/v2/transportation-network/locations/89" `
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

//Request Headers
GET /linehaul/trip/v2/transportation-network/locations/89 HTTP/1.1
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
Date: Sat, 11 Apr 2026 00:19:34 GMT
Content-Type: application/json
Content-Length: 615
Connection: keep-alive
Server: nginx/1.19.0
Access-Control-Allow-Origin: *
Cache-Control: no-cache, no-store, max-age=0, must-revalidate
Expires: 0
Last-Modified: Mon, 30 Mar 2026 14:15:16 GMT
Pragma: no-cache
Strict-Transport-Security: max-age=31536000 ; includeSubDomains
Vary: Origin
Vary: Access-Control-Request-Method
Vary: Access-Control-Request-Headers
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-Vcap-Request-Id: b7b612ef-fb16-417e-7df2-eedc733449e8
X-Xss-Protection: 1; mode=block
messageid: rrt-1405794849766731036-d-gea1-3210261-40312313-2

---

## FedExTool proxy

**`GET /api/fedex/linehaul/locations/:locationId`** — `locationId` must be digits (e.g. trip `tripDestNumber`). Optional query **`?originId=`**; if omitted, the server uses the tractor API `locationId` for the `originId` header (same idea as `/trips`). Requires saved Linehaul bearer in Settings. Response envelope: `{ ok, status, body }`.

Home: click **Destination** on the dispatch row (when trip details are loaded) to open a modal with formatted address / phone / coordinates from this API.

