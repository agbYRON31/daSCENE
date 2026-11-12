# Wealth Desk 2.0

A native macOS app for financial education and illustration. Independent software: not affiliated with, endorsed by, or approved by Morgan Stanley or any other firm.

- **Client Mode:** five plain-language tools with sliders and charts (growth, retirement, risk, decisions, taxes and inflation).
- **Advisor Mode:** 109 calculators with formulas, assumptions, Excel equivalents and sources; a scientific calculator; Markets (Treasury curve, watchlist); the native RoRo Composite dashboard.
- **Privacy by design:** calculators open blank. Typed numbers live in memory only and are erased on quit. Nothing typed is ever transmitted. Scenario files (optionally AES-256 password-protected) and PDF reports are written only when the user chooses, where they choose. The app is sandboxed: network client access and user-selected files only.
- **Accuracy:** every calculator is independently audited (`docs/ACCURACY_AUDIT.md`), and the shipped engine is checked against the reference on every build (`wdcheck`).

Documents: `docs/QA_REPORT.md` (what was tested, what wasn't), `docs/ACCURACY_AUDIT.md`, `docs/DATA_SOURCES.md`, `docs/INSTALL.txt`.

## Build

Requires only the Xcode Command Line Tools (Swift 5.9+), macOS 13+.

```bash
./build_app.sh            # audit, universal build, self-tests, sandboxed signing, dist/Wealth Desk.app + .dmg + .zip
open "dist/Wealth Desk.app"
```

During development: `swift run WealthDesk` (app) and `swift run wdcheck` (self-test).

## Web version (Windows, Linux, phones)

`web/` is a browser version for people without a Mac, laid out like the app: the start screen, Advisor Mode (sidebar, all 109 calculators, Calculator, Markets, RoRo Composite, session scenarios and history) and Client Mode. It reads the same `catalog.json` and `taxdata.json`, and `web/engine.js` is a line-by-line port of `Sources/WealthCore`.

How it's checked:

| Check | What it proves |
| --- | --- |
| `web/check.mjs` | The web `wdcheck`: every catalog example matches its Python-computed expected value (Monte Carlo included: same SplitMix64 stream), plus parser and IRS bracket checks. |
| `web/parity.mjs` | Thousands of generated inputs per run across all 109 calculators (variations, every input style, invalid and edge-case entries) give the same field errors, rule errors, outputs and tables as the Swift engine (`swift run wdparity`). |
| `web/scenario-check.mjs` | Scenario files, plain and password-protected, open both ways between the web and the app. |

Browsers can't reach Yahoo, FRED or Treasury.gov directly, so RoRo and Markets on the web come from a scheduled build: each weekday after the US close, GitHub Actions runs the app's own engine (`roro fetch/build/meta/markets`) on a Mac runner and publishes the results with the site. The Mac app still fetches live and lets you add watchlist symbols. PDF reports use the browser's print dialog. Preferences (favorites, tax year, calculator mode) are kept in the browser; calculator inputs are memory-only and gone when the tab closes.

```bash
web/build.sh                  # self-test, then assemble dist/web
web/build.sh --full           # also parity, scenario interop, live RoRo and Markets data (needs Swift)
web/build.sh --full --serve   # then serve at http://localhost:8765
```

Pushing to `main` (or the weekday schedule) publishes it to GitHub Pages (`.github/workflows/wealthdesk-web.yml`).

## How it fits together

| Piece | What it does |
| --- | --- |
| `tools/build_catalog.py` | **Single source of every calculator.** Defines fields, formulas, Excel templates, text, and computes each expected answer with an independent Python implementation. Writes `Resources/catalog.json`. |
| `Resources/taxdata.json` | Federal figures by tax year (currently 2026 and 2027): brackets, deductions, LTCG/NIIT thresholds, 401(k)/IRA limits, RMD table, estate/gift, each with its IRS sources and verification date. |
| `Sources/WealthCore` | Formula language (parser/evaluator), finance functions, tax lookups, projections (retirement timeline, Monte Carlo), input parsing, Excel grid export. |
| `Sources/WealthDesk` | SwiftUI app: sidebar + search, calculator view, charts, scenarios, history, menu-bar extra, pin-on-top, export/import. |
| `Sources/wdcheck` | Self-test: Swift must reproduce every Python-computed expected value, plus IRS bracket, RoRo-vs-Python parity, parser, calculator and market-data checks (381 checks). |

## RoRo port and parity

`Sources/WealthCore/RoRo` is a line-by-line port of `config.py`, `data.py` and `engine.py`, including pandas semantics (business-day alignment, forward-fill limits, `pct_change`, rolling windows, `ewm(adjust=True)`, banker's rounding).

`wdcheck` checks the port against the original Python engine. It runs both on a fixed data snapshot (`Tests/roro_fixture`, 2020–Jun 2026) as of two dates, and every value in the dashboard model must match the expected JSON the Python engine produced (`Tests/roro_expected*.json`). During the port the two engines also matched exactly on live data as of 15 dates from 2002 to 2026.

To change the model, edit `RoRoConfig.swift`, mirror the change in `tools/roro_reference/config.py`, and regenerate the expected files:

```bash
python3 -m venv .venv && .venv/bin/pip install pandas numpy
.venv/bin/python tools/roro_reference/py_model.py tools/roro_reference Tests/roro_fixture Tests/roro_expected.json
```

(`truncate.py` makes the 2022-06-16 snapshot; `compare.py` diffs two model files; `swift run roro fetch|build` is the Swift CLI.)

## Tax data and the IRS

Every figure in `taxdata.json` was checked against the IRS documents listed in its `sources` on its `verifiedOn` date:

- **2026:** Rev. Proc. 2025-32, Notice 2025-67, Pub. 590-B App. B, and the IRS NIIT page.
- **2027:** Rev. Proc. 2026-35 (IR-2026-133, Nov 5, 2026). The IRS hadn't announced 2027 401(k)/IRA limits as of Nov 10, 2026, so the 2027 table uses the 2026 limits and says so in the app.

`wdcheck` checks the bracket tables against the IRS's printed base amounts ("$206,583.50 plus 37%…") for every year and filing status.

**At launch** (at most once a day, toggle in Settings) the app reads the IRS.gov newsroom and inflation-adjustment pages. If the IRS has published a newer tax year or newer 401(k)/IRA limits than `taxdata.json` contains, it warns on every tax calculator and in Settings. To update:

1. Add a table for the new year from the new Rev. Proc. and retirement-limit notice, with `sources` and `verifiedOn`.
2. Add that year's base amounts to the IRS check in `Sources/wdcheck/main.swift`.
3. Run `./build_app.sh`.

The tax year defaults to the current calendar year. You can pick another year on any tax calculator or in Settings.

## Adding a calculator

1. Add a `calc(...)` entry in `tools/build_catalog.py` (example inputs are required: they become the self-test).
2. `./build_app.sh`. If the Swift and Python implementations disagree, the build stops.

Formula language: `+ - * / ^`, comparisons, `if(c,a,b)`, element-wise list math, and `fv pv pmt nper rate npv irr bondprice bondytm macdur bondconvexity min max abs sqrt ln exp floor ceil sum count avg sumproduct topsum median var sd cov corr dw normcdf norminv tcdf tinv fcdf binompmf binomcdf nan pi`, plus the scientific functions above plus tax-table lookups (`incometax margrate bracketroom stddeduction ltcgtax niitthreshold niitrate rmdfactor limit401k limitira giftexclusion estateexemption estaterate`).

## Data and privacy

Preferences only (no calculator inputs) are stored in the app's sandbox container. The only network calls are the Markets page (Treasury.gov and Yahoo Finance), the RoRo page (FRED and Yahoo), both on open or Refresh, and the daily IRS.gov check for newer tax figures; sources open in the browser only when clicked. Calculations only, not investment, tax or legal advice.
