# Check-in and Arrive automation — overview

This note explains the two run paths and the “connection” error. **Graphs below are [Mermaid](https://mermaid.js.org/)** — the same diagram language Cursor uses in **Plan mode** (flowcharts render when you open Markdown preview in Cursor, VS Code with a Mermaid extension, or GitHub).

**Single combined chart (copy into [mermaid.live](https://mermaid.live)):** see [`automation-checkin-arrive-unified.mermaid`](automation-checkin-arrive-unified.mermaid) in this folder, or the fenced block below.

### One diagram — check-in + arrive logic together

`POST /api/run` with `check_in` always continues down the **check-in** branch after `ensureDispatchAppReady` (the diamond is only choosing arrive vs check-in for **preset** runs; the runner never takes the arrive branch).

```mermaid
flowchart TD
  subgraph entry [1 How the run starts]
    S([Start])
    S --> Q{Which API?}
    Q -->|POST /api/automations/:id/run| PA[goto dispatch_entry]
    PA --> DLY[sleep 1500ms preset only]
    DLY --> PIK{preset action}
    PIK -->|check_in_full| EG
    PIK -->|arrive_full| EG
    Q -->|POST /api/run scenario check_in| PB[goto dispatch no preset delay]
    PB --> EG
  end

  EG[ensureDispatchAppReady Okta plus stable fdxtools]

  EG --> BR{Next: check-in E2E or arrive E2E?}

  subgraph ci [2 Check-in runCheckInEndToEnd]
    BR -->|check-in path| FL[fetchDriverLocation API]
    FL --> FULL[runFullCheckIn forms banners]
    FULL --> MM{location mismatch banner?}
    MM -->|yes| WAIT[wait retry location user API]
    WAIT --> RETRY[retryCheckInWithNewLocation]
    RETRY --> FULL
    MM -->|no| OK{success?}
    OK -->|yes| PH[phone modal and sign out]
    OK -->|no| BAD[return payload failure]
    PH --> OUTOK[return success signedOut]
  end

  subgraph ar [3 Arrive runArriveEndToEnd]
    BR -->|arrive path| RFA[runFullArrive UI steps]
    RFA --> GEO{geofence already arrived?}
    GEO -->|yes| SO[sign out only]
    GEO -->|no| PHA[phone modal and sign out]
    SO --> OUTA[return arrivePayload]
    PHA --> OUTA
  end

  subgraph er [4 Timeout to user message]
    TOUT[Playwright waitFor timeout]
    FMT[formatRunErrorForUser]
    UX["User: app took too long check connection"]
    TOUT --> FMT --> UX
  end

  FULL -.-> TOUT
  RFA -.-> TOUT
  PH -.-> TOUT
  PHA -.-> TOUT
```

---

## 0. Visual graphs (Mermaid — Plan-style flowcharts)

### How the user-facing “connection” error is produced

```mermaid
flowchart LR
  subgraph play [Playwright]
    wait[locator waitFor times out]
  end
  subgraph ui [Client]
    fmt[formatRunErrorForUser]
    msg["The app took too long... Check your connection"]
  end
  wait --> errRaw[raw Error message string]
  errRaw --> fmt
  fmt --> msg
```

### Path A — Block automation preset (Check-in or Arrive)

```mermaid
flowchart TD
  apiA["POST /api/automations/:id/run"]
  blocks["blocks.mjs runAutomation"]
  goto["action: goto dispatch_entry"]
  delay["action: delay 1500ms fixed sleep"]
  pick{"preset: which action?"}
  ci["action: checkInEndToEnd"]
  ar["action: arriveEndToEnd"]
  doneA["Return ok + ctx.variables"]

  apiA --> blocks --> goto --> delay --> pick
  pick -->|check_in_full| ci --> doneA
  pick -->|arrive_full| ar --> doneA
```

### Path B — Scenario runner check_in only

```mermaid
flowchart TD
  apiB["POST /api/run scenario check_in"]
  run["runner.mjs runScenario"]
  nav["page.goto DISPATCH domcontentloaded"]
  builtin["runBuiltinScenarioBody check_in"]
  same["runCheckInEndToEnd same orchestration as Path A"]
  out["Return checkIn payload"]

  apiB --> run --> nav --> builtin --> same --> out
```

### Inside checkInEndToEnd (both paths share this)

```mermaid
flowchart TD
  startNode["runCheckInEndToEnd"]
  gate["ensureDispatchAppReady Okta plus stable fdxtools"]
  fetchLoc["fetchDriverLocation API"]
  full["runFullCheckIn clicks forms banners"]
  ban{banner location mismatch?}
  waitRetry["wait for user retry location via API"]
  retry["retryCheckInWithNewLocation"]
  ok{success?}
  phone["runPhoneModalUntilMissionComplete"]
  endNode["return checkInPayload"]

  startNode --> gate --> fetchLoc --> full --> ban
  ban -->|yes| waitRetry --> retry --> full
  ban -->|no| ok
  ok -->|yes| phone --> endNode
  ok -->|no| endNode
```

### Inside arriveEndToEnd

```mermaid
flowchart TD
  a0["runArriveEndToEnd"]
  g["ensureDispatchAppReady"]
  rfa["runFullArrive UI steps"]
  geo{geofence banner?}
  done1["mission complete no post steps"]
  pm["runPhoneModalWithoutSignOut"]
  endA["return arrivePayload"]

  a0 --> g --> rfa --> geo
  geo -->|yes| done1 --> endA
  geo -->|no| pm --> endA
```

### Path A vs Path B — what differs for check-in

```mermaid
flowchart TB
  subgraph aPath [Path A preset]
    dly["Fixed delay 1500ms after goto"]
    blkRetry["Block waitForBlockRetryLocation"]
  end
  subgraph bPath [Path B runner]
    noDly["No preset delay"]
    runRetry["waitForCheckInRetryLocation"]
  end
  shared["runCheckInEndToEnd + runFullCheckIn"]

  dly --> shared
  noDly --> shared
  blkRetry -.->|"same retry idea"| shared
  runRetry -.->|"same retry idea"| shared
```

---

## 1. Why the app says “check your connection” so often

The UI text **“The app took too long to load. Check your connection and try again.”** is shown when Playwright throws a **timeout while waiting for a button, banner, or other element**. That is wired in `src/utils/runErrorFormat.js`: it is **not** a network test. Slow Wi‑Fi can contribute, but the same message appears when:

- The FedEx page is still loading or Angular has not painted the control yet.
- An XPath or selector no longer matches the real page.
- A modal or banner is blocking the next step.
- You are still on PurpleID / Okta sign-in (different error in some paths, but timeouts still map to this friendly line).

So treat that message as **“something in the browser automation did not become ready in time,”** not necessarily a broken connection.

---

## 2. Two different ways a check-in or arrive run starts

**Path A — Automation from the dashboard (saved automation / preset)**  
Server: `POST /api/automations/:id/run` → code in `server/playwright/blocks.mjs`.

**Path B — Built-in scenario runner**  
Server: `POST /api/run` with body `scenario: "check_in"` → code in `server/playwright/runner.mjs`.

Both paths eventually call the **same core check-in logic** (`runCheckInEndToEnd` in `server/playwright/checkInOrchestration.mjs`) when you want a **full** check-in. They differ in **how the browser page is opened** and **how “retry with a new location”** is wired (two separate wait helpers: one for the scenario runner, one for block automations).

**Full Arrive** (tractor selection, confirm, phone, sign-out) is implemented as the block action **`arriveEndToEnd`** in `blocks.mjs`, not as the tiny **`scenario: "arrive"`** step in the runner (that scenario only tries to click “Arrive” from the menu once).

---

## 3. Path A — Block automation (typical preset: Full Check-In or Full Arrive)

Order of steps as defined in `server/automation-presets.mjs`:

1. **goto** — Open the dispatch home URL (`dispatch_entry`), wait until `domcontentloaded`, long navigation timeout.
2. **delay** — Wait a **fixed number of milliseconds** (1500 in the presets). This is a plain timer. It does **not** wait for a specific button to exist.
3. **checkInEndToEnd** or **arriveEndToEnd** — Runs the real flow (see sections 5 and 6 below).

Inside **checkInEndToEnd** (orchestration file `checkInOrchestration.mjs`):

1. **ensureDispatchAppReady** — Waits until you are on the real FedEx dispatch app (and can drive Okta sign-in if configured). This part is “content aware” (URL and stability), not a single fixed delay for the whole page.
2. Read **tractor** from saved credentials; read **driver location** from the Linehaul API (not only from a saved assignment field).
3. **runFullCheckIn** (`checkInFlow.mjs`) — Clicks through Begin New Check In, Check In, fills form, submits. Uses **waitFor visible** timeouts and polling for banners (see section 5).
4. If the FedEx banner indicates **location mismatch**, the run can **pause** and wait for the user to submit a **new location** via the API (retry), then retry check-in with that location.
5. On success, run **`runPhoneModalUntilMissionComplete`** (`postCheckInFlow.mjs`) — phone / Linehaul / assistance as needed, poll for mission-complete text; **no** automated sign-out.

Inside **arriveEndToEnd** (`arriveOrchestration.mjs`):

1. **ensureDispatchAppReady** (same idea as check-in).
2. **runFullArrive** (`arriveFlow.mjs`) — Arrive button, select tractor, fill number, continue, then confirm arrival or detect geofence message.
3. If **geofence** already arrived: **no** post steps (no automated sign-out). Else: require **phone** in assignment and run **phone modal → Linehaul → assistance** via `runPhoneModalWithoutSignOut` (no automated sign-out; session may stay signed in).

---

## 4. Path B — POST /api/run with scenario check_in

Order of steps in `runner.mjs`:

1. Start browser context and open the dispatch **entry URL** once (`page.goto`, `domcontentloaded`).
2. Call the built-in body for **`check_in`**, which calls **`runCheckInWithLocationRetries`** → same **`runCheckInEndToEnd`** as Path A (including **ensureDispatchAppReady** inside it).
3. Location retry uses the **runner’s** pending “wait for retry location” helper (not the block runner’s), but the **business steps** match.

There is **no** preset-style **1500 ms delay** in this path before check-in starts; only the navigation wait.

---

## 5. What “content aware” means in checkInFlow (runFullCheckIn)

Not a chart—just the idea:

- Waits use **Playwright** `waitFor` on locators (visible / attached) with **time limits** (often tens of seconds).
- “Begin new check-in” has a **loop** that polls until the control looks disabled (session ready), up to a cap.
- After submit, the code **polls the banner** for a short window to read success vs location mismatch text.
- XPath strings can be **customized** from stored flow settings (`check-in-flow-store`), so behavior depends on **selectors matching the live FedEx UI**.

Fixed **sleep** calls exist in places (short waits between steps). The **preset delay** before `checkInEndToEnd` is entirely **not** tied to a specific element.

---

## 6. What runFullArrive does differently

- Many steps use **waitFor visible** on XPath-based locators, with fallbacks (e.g. menu click if the main button is not found).
- There are **explicit short sleeps** (for example after navigation) so the next screen can render; those are **time-based**, not “wait until this exact selector is stable.”
- Geofence is detected by reading **body text** for a known phrase.

---

## 7. Where to look in the repo

| Topic | File |
|-------|------|
| Friendly “connection” error mapping | `src/utils/runErrorFormat.js` |
| Block actions: goto, delay, checkInEndToEnd, arriveEndToEnd | `server/playwright/blocks.mjs` |
| Preset action order | `server/automation-presets.mjs` |
| Scenario run (check_in) | `server/playwright/runner.mjs` |
| Check-in orchestration | `server/playwright/checkInOrchestration.mjs` |
| Check-in UI steps | `server/playwright/checkInFlow.mjs` |
| Arrive orchestration | `server/playwright/arriveOrchestration.mjs` |
| Arrive UI steps | `server/playwright/arriveFlow.mjs` |
| Dispatch / Okta gate | `server/playwright/dispatchAuthGate.mjs` |
| After check-in: phone → mission text (no sign-out); arrive: `runPhoneModalWithoutSignOut` | `server/playwright/postCheckInFlow.mjs` |

---

## 8. Short summary

- **Path A (dashboard automation)** adds a **fixed delay** after load, then the same end-to-end check-in or arrive logic as **Path B** for check-in.
- **“Connection” errors** usually mean **automation timed out waiting for the page or a control**, not a verified network fault.
- Improving reliability generally means **stronger waits tied to real UI state** and **accurate selectors**, not only longer blind delays.
