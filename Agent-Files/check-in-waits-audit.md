# Check-in waits audit (server Playwright)

Purpose: inventory of **fixed delays / sleeps** in the check-in path after the content-aware pass, for future tuning.

| Location | Mechanism | Notes |
|----------|-----------|--------|
| [`checkInFlow.mjs`](../server/playwright/checkInFlow.mjs) `pollBannerAfterSubmit` | `BANNER_INITIAL_MS = 0` | Banner poll uses 80ms intervals between reads (no blind pre-delay). |
| [`checkInFlow.mjs`](../server/playwright/checkInFlow.mjs) `waitUntilBeginNewDisabled` | 50ms `sleep` loop, 60s cap | Waits until Begin control reads disabled (content predicate). |
| [`checkInFlow.mjs`](../server/playwright/checkInFlow.mjs) `confirmBeginNewIfPresent` | 12s race on Continue | Modal-driven, not a flat page delay. |
| [`dispatchAuthGate.mjs`](../server/playwright/dispatchAuthGate.mjs) `ensureDispatchAppReady` | 400ms step polling, phased budgets | URL stability + Okta; `DISPATCH_STABLE_MS` from env (default 2s). |
| [`postCheckInFlow.mjs`](../server/playwright/postCheckInFlow.mjs) `runPhoneModalUntilMissionComplete` | 400ms poll for mission text | After phone/Linehaul/assistance, polls until “Check In Successful” variants. |
| [`postCheckInFlow.mjs`](../server/playwright/postCheckInFlow.mjs) `runPhoneModalWithoutSignOut` | — | **Arrive** E2E: phone → Linehaul → assistance (or trip-ready shortcut); **no** automated sign-out. |
| Presets | **Removed** blind 1500ms between `goto` and E2E | `check_in_full` / `arrive_full` go straight to E2E after navigation. |
