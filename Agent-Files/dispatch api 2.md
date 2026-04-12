$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$session.UserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36"
Invoke-WebRequest -UseBasicParsing -Uri "https://fxg-prod-prod.apigee.net/linehaul/trip/v1/trips?dailyTripLegSequence=272362645&alreadyCalled=false" `
-WebSession $session `
-Headers @{
"Accept"="application/json, text/plain, */*"
  "Accept-Encoding"="gzip, deflate, br, zstd"
  "Accept-Language"="en-US,en;q=0.9"
  "Access-Control-Allow-Origin"="*"
  "Authorization"="Bearer eyJraWQiOiJ4a0J2UThOYnJyR0ttbWFFd3Y2LUo3SUFSOHVaSTUzUzd3aXJhWko4ZmRVIiwiYWxnIjoiUlMyNTYifQ.eyJ2ZXIiOjEsImp0aSI6IkFULnlVR2UwM3BmR1JQMFdGalZXMXZ5eV9oQTNQQ2tTR3pvbFVBLW9wM0RaSlEiLCJpc3MiOiJodHRwczovL3B1cnBsZWlkLm9rdGEuY29tL29hdXRoMi9hdXM1bzZkNXd0TnBjRXNVSDM1NyIsImF1ZCI6IkFQUDM1MzY4NTkiLCJpYXQiOjE3NzU5OTUxMzgsImV4cCI6MTc3NTk5ODczOCwiY2lkIjoiMG9hNzNmc3NkbHBjbHJmVHkzNTciLCJ1aWQiOiIwMHUxcjYydmg2NWQ4MTdlODM1OCIsInNjcCI6WyJlbWFpbCIsImdyb3VwcyIsInByb2ZpbGUiLCJvcGVuaWQiXSwiYXV0aF90aW1lIjoxNzc1OTk1MTM3LCJzdWIiOiI2NTQ0OTAwQHZlbmRvci5sZGFwLmZlZGV4LmNvbSIsImdyb3VwcyI6WyJmeGdfbGhsX2V4ZWN1dGVfdHJpcF9kcml2ZXJfZGZfMzUzNjg1OSJdLCJlbXBsb3llZU51bWJlciI6IjY1NDQ5MDAiLCJmZHhfZWFpIjoiTi9BIn0.iIfVuDpNcOf9M5TQUWi44OYF5VHhIS-5bMpDaXCyiRAWywgxtHLdli9p0-xr__KtAoeo2ct39N9pAVVQ_BAikoxpIc2OPsP0txInJ3M8JP0uBYv_k17-AcxV8YKAQBECWF5Bs0WF_r8B2ooN0mU9OQfoJJN8xlFFQDqpUj3UBUEc6ZJIskWJ_emfjcVuxSEMCx-3aiYOdaUJhxwytkWp4nQGqi0g2UyRZA0u0r3gsAxqKztKXVVz46tqvQYnc39ptvdH2mW0tM3oazOd5a5oDj_FgoackG4qBP4i_n3h1KiEjfraFBDTqjz4SyG_hYZOibrZf8x3LHzixe-DF80JXQ"
  "CorrelationId"="MTA_6544900_2026041264018"
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
  "sec-ch-ua"="`"Chromium`";v=`"146`", `"Not-A.Brand`";v=`"24`", `"Google Chrome`";v=`"146`""
  "sec-ch-ua-mobile"="?0"
  "sec-ch-ua-platform"="`"Windows`""
}

//Request Headers
GET /linehaul/trip/v1/trips?dailyTripLegSequence=272362645&alreadyCalled=false HTTP/1.1
Accept: application/json, text/plain, */*
Accept-Encoding: gzip, deflate, br, zstd
Accept-Language: en-US,en;q=0.9
Access-Control-Allow-Origin: *
Authorization: Bearer eyJraWQiOiJ4a0J2UThOYnJyR0ttbWFFd3Y2LUo3SUFSOHVaSTUzUzd3aXJhWko4ZmRVIiwiYWxnIjoiUlMyNTYifQ.eyJ2ZXIiOjEsImp0aSI6IkFULnlVR2UwM3BmR1JQMFdGalZXMXZ5eV9oQTNQQ2tTR3pvbFVBLW9wM0RaSlEiLCJpc3MiOiJodHRwczovL3B1cnBsZWlkLm9rdGEuY29tL29hdXRoMi9hdXM1bzZkNXd0TnBjRXNVSDM1NyIsImF1ZCI6IkFQUDM1MzY4NTkiLCJpYXQiOjE3NzU5OTUxMzgsImV4cCI6MTc3NTk5ODczOCwiY2lkIjoiMG9hNzNmc3NkbHBjbHJmVHkzNTciLCJ1aWQiOiIwMHUxcjYydmg2NWQ4MTdlODM1OCIsInNjcCI6WyJlbWFpbCIsImdyb3VwcyIsInByb2ZpbGUiLCJvcGVuaWQiXSwiYXV0aF90aW1lIjoxNzc1OTk1MTM3LCJzdWIiOiI2NTQ0OTAwQHZlbmRvci5sZGFwLmZlZGV4LmNvbSIsImdyb3VwcyI6WyJmeGdfbGhsX2V4ZWN1dGVfdHJpcF9kcml2ZXJfZGZfMzUzNjg1OSJdLCJlbXBsb3llZU51bWJlciI6IjY1NDQ5MDAiLCJmZHhfZWFpIjoiTi9BIn0.iIfVuDpNcOf9M5TQUWi44OYF5VHhIS-5bMpDaXCyiRAWywgxtHLdli9p0-xr__KtAoeo2ct39N9pAVVQ_BAikoxpIc2OPsP0txInJ3M8JP0uBYv_k17-AcxV8YKAQBECWF5Bs0WF_r8B2ooN0mU9OQfoJJN8xlFFQDqpUj3UBUEc6ZJIskWJ_emfjcVuxSEMCx-3aiYOdaUJhxwytkWp4nQGqi0g2UyRZA0u0r3gsAxqKztKXVVz46tqvQYnc39ptvdH2mW0tM3oazOd5a5oDj_FgoackG4qBP4i_n3h1KiEjfraFBDTqjz4SyG_hYZOibrZf8x3LHzixe-DF80JXQ
Connection: keep-alive
CorrelationId: MTA_6544900_2026041264018
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
sec-ch-ua: "Chromium";v="146", "Not-A.Brand";v="24", "Google Chrome";v="146"
sec-ch-ua-mobile: ?0
sec-ch-ua-platform: "Windows"

//Request Response
{"tripDest":"BETHPAGE - HD","tractorDomicileId":"103","tractorDomicileAbbrv":"SUNY","tripDestNumber":"3117","tripDestAbbrv":"QBTH","currentLocationName":"WOODBRIDGE","currentLocationAbbrv":"WOOD","currentLocationNumber":null,"originLocation":"89","dailyTripLegSequence":272362645,"tripStatus":"DSPCH","driver1Id":"6544900","driver2Id":null,"dollyNumber1":null,"dollyNumber2":null,"dollyEquipmentSequence1":null,"dollyEquipmentSequence2":null,"trailers":[],"tripConfig":"BOB","tractorNumber":"292446","tmsRefNbr":null}