# Wealth Desk

A native macOS calculator desk for wealth management and economics coursework: a basic/scientific calculator plus 105 formulas, each with assumptions, Excel equivalents and self-tests. Modeled on the CRE Desk design.

| Group | Count | Highlights |
| --- | --- | --- |
| Everyday math | 6 | percentages, tip & split, discount & sales tax, unit price, weighted average (grades), final-exam score needed |
| Growth & time value | 11 | future value, CAGR, real return, years to goal |
| Retirement & income | 13 | nest egg, retirement timeline, Monte Carlo, RMDs, Social Security break-even |
| Tax | 10 | federal brackets, LTCG, NIIT, Roth conversion, tax-loss harvesting |
| Portfolio & risk | 10 | Sharpe/Sortino, rebalancing, IRR, two-asset risk |
| Fees & costs | 5 | fee drag, AUM vs. flat, tiered fees |
| Stocks & bonds | 9 | bond price/YTM, duration & convexity, T-bill yields, P/E, position P&L, DDM |
| Statistics & econometrics | 18 | descriptive stats, CIs, t-tests, correlation, OLS with SEs and p-values, prediction intervals, F-test, Durbin–Watson, log-model interpretation, binomial |
| Economics | 15 | elasticity, supply/demand with tax incidence and DWL, CPI, GDP deflator, multipliers, money, Taylor rule, Okun, monopoly, cost curves, HHI, Cobb–Douglas/Solow, comparative advantage |
| Planning & protection | 8 | net worth, 529, life insurance, estate exposure |

**Calculator page:** Basic and Scientific keypads (or just type), degrees/radians, `ans`, named variables (`x = 5`), and a history tape. Functions: `sin cos tan asin acos atan sinh cosh tanh ln log log2 log(x, b) sqrt cbrt exp abs round mod fact ncr npr pi e`.

**RoRo page:** the RoRo risk-on/risk-off composite, ported from the original Python tool (`tools/roro_reference`). It downloads ~60 series from FRED (public CSV feed, no key) and Yahoo, scores 37 factors in six buckets into Tactical / Intermediate / Strategic dials, and renders the original dashboard: posture, master signal, bucket decomposition, history, flags, VIX playbook, leadership, factor table, scenarios and historical analogs. It refreshes when opened if the last run was on an earlier day, or on ⌘R. Files (dashboard, JSON, data cache, `runs.csv`) live in `~/Library/Application Support/Wealth Desk/RoRo`. Not investment advice.

**Markets page:** the live U.S. Treasury yield curve (official, Treasury.gov) with 10Y−2Y and 10Y−3M spreads, plus a stock/ETF watchlist (Yahoo Finance's unofficial feed). Data is fetched only when you open Markets or press Refresh. Click a yield to price a bond at it; click a price to open Position gain/loss with it filled in. Every calculator works offline.

## Build

Requires only the Xcode Command Line Tools (Swift 5.9+), macOS 13+.

```bash
./build_app.sh            # regenerates catalog, runs self-test, builds dist/Wealth Desk.app
open "dist/Wealth Desk.app"
```

During development: `swift run WealthDesk` (app) and `swift run wdcheck` (self-test).

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

Saved work: `~/Library/Application Support/Wealth Desk/workspace.json`. The only network calls are the Markets page (Treasury.gov and Yahoo Finance), the RoRo page (FRED and Yahoo), both on open or Refresh, and the daily IRS.gov check for newer tax figures; sources open in the browser only when clicked. Calculations only, not investment, tax or legal advice.
