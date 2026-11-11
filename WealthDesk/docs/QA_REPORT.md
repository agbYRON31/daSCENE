# Wealth Desk 2.0 — QA report (2026-11-10)

## Passed

| Area | How it was tested | Result |
| --- | --- | --- |
| Formula accuracy | `tools/audit.py`: independent recomputation of every output, 109 calculators, 360 input cases incl. zero/negative rates, long horizons, bracket edges, depletion | 1,209 comparisons, 0 failures (after fixing one bug it found) |
| Engine parity | `wdcheck`: Swift engine vs. Python reference on every output; run natively on Apple silicon and on Intel under Rosetta | 574 checks pass on both |
| Edge cases and input validation | `wdcheck`: zero/tiny/negative rates, 100-year horizon, solver limits, non-numeric and out-of-range input, blank input shows no numbers for all 109 calculators | Pass |
| Monte Carlo | Zero-volatility limit equals the deterministic projection; percentiles match normal theory within sampling error; generator mean/sd/quantiles; seed reproducibility | Pass |
| Tax tables | 2026 and 2027 brackets vs. IRS printed base amounts (Rev. Proc. 2025-32, 2026-35), all filing statuses; RMD table vs. Pub. 590-B | Pass |
| RoRo integrity | Swift port vs. the original Python engine on a committed data snapshot at two dates (every model value); factor-to-series map complete | Pass |
| Scenario files | Round trip; AES-256-GCM encryption hides contents; wrong/missing password refused | Pass |
| PDF reports | Rendered 7 reports through the app's report engine and inspected pages (assumptions, results, chart, table, method, disclaimer, page numbers) | Pass |
| Packaged app | Universal binary (arm64 + x86_64), sandbox entitlements present, signature verifies; launched the packaged app | Pass |
| Start screen and modes | Launched packaged app: start screen, Advisor home, Client home, mode switching via menu | Pass |
| Client Mode risk tool | Opens blank and lists missing inputs; typed $2,000,000 / 60% / 40% / −20%: shows −$240,000 (−12%), chart updates | Pass |
| No automatic storage | After typing inputs, the app's container held only `preferences.json`; searched the container for the typed value: not found | Pass |
| RoRo in the sandbox | Downloaded 60 series and rendered the native dashboard with source/date/status | Pass |

## Bug found and fixed by the audit
- Supply & demand: "Share of tax paid by buyers" showed the sellers' share (used the supply slope). Fixed.

## Other fixes in 2.0
- IRR, loan-rate and bond-yield solvers returned a search boundary when no answer existed; they now say so.
- Results that were "not a number" could display as "n/a"; they now show an explanation.
- Chart axes for projections started at zero.

## Not tested, or limitations
- **Not notarized, no Developer ID.** No Apple Developer credentials were available, so the app is ad-hoc signed. Other Macs will show a Gatekeeper warning; firm-managed Macs will likely block it. `build_app.sh` signs and notarizes when credentials are supplied.
- **Not tested on a clean Mac** or on macOS 13/14; it was built and run on one Mac (macOS 15.7, Apple silicon). The Intel build passed its self-tests under Rosetta but its UI was not exercised.
- **PDF save dialog:** the dialog opened from the sandboxed app, but the final Save click was not confirmed in UI testing. The report engine itself was verified.
- **Not individually clicked through:** the other four Client Mode tools, password-protected save/open dialogs, and light mode were compiled and are covered by engine tests, but were not each exercised by hand in the packaged app.
- **Offline behavior** is implemented (cached data with a warning, or a clear "unavailable" message) but was not tested with the network actually disconnected.
- **Yahoo Finance is an unofficial, unlicensed feed** (see `docs/DATA_SOURCES.md`).
- **Tax scope:** federal only; no state tax, AMT, credits or phase-outs. 2027 retirement-plan limits were unpublished and use 2026 values (flagged in the app).
- **RoRo** is a hand-calibrated model, not validated as a return predictor. The app never converts its scores into return estimates.
- **Removed on purpose:** automatic saving of inputs/history/scenarios, the "export/import saved work" commands (replaced by explicit scenario files), and the always-running menu-bar icon (closing the window now quits and clears the session).
- **No compliance approval.** Nothing here has been reviewed by Morgan Stanley. Real client information should not be entered until the firm approves the tool.
