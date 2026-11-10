# Wealth Desk

A native macOS calculator desk for wealth management and economics coursework: 99 formulas, each with assumptions, Excel equivalents and self-tests. Modeled on the CRE Desk design.

| Group | Count | Highlights |
| --- | --- | --- |
| Growth & time value | 11 | future value, CAGR, real return, years to goal |
| Retirement & income | 13 | nest egg, retirement timeline, Monte Carlo, RMDs, Social Security break-even |
| Tax | 10 | federal brackets, LTCG, NIIT, Roth conversion, tax-loss harvesting |
| Portfolio & risk | 10 | Sharpe/Sortino, rebalancing, IRR, two-asset risk |
| Fees & costs | 5 | fee drag, AUM vs. flat, tiered fees |
| Stocks & bonds | 9 | bond price/YTM, duration & convexity, T-bill yields, P/E, position P&L, DDM |
| Statistics & econometrics | 18 | descriptive stats, CIs, t-tests, correlation, OLS with SEs and p-values, prediction intervals, F-test, Durbin–Watson, log-model interpretation, binomial |
| Economics | 15 | elasticity, supply/demand with tax incidence and DWL, CPI, GDP deflator, multipliers, money, Taylor rule, Okun, monopoly, cost curves, HHI, Cobb–Douglas/Solow, comparative advantage |
| Planning & protection | 8 | net worth, 529, life insurance, estate exposure |

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
| `Resources/taxdata.json` | Dated federal figures (brackets, deductions, LTCG/NIIT thresholds, 401(k)/IRA limits, RMD table, estate/gift). **Update every tax year.** |
| `Sources/WealthCore` | Formula language (parser/evaluator), finance functions, tax lookups, projections (retirement timeline, Monte Carlo), input parsing, Excel grid export. |
| `Sources/WealthDesk` | SwiftUI app: sidebar + search, calculator view, charts, scenarios, history, menu-bar extra, pin-on-top, export/import. |
| `Sources/wdcheck` | Self-test: Swift must reproduce every Python-computed expected value, plus parser and market-data checks (321 checks). |

## Adding a calculator

1. Add a `calc(...)` entry in `tools/build_catalog.py` (example inputs are required: they become the self-test).
2. `./build_app.sh`. If the Swift and Python implementations disagree, the build stops.

Formula language: `+ - * / ^`, comparisons, `if(c,a,b)`, element-wise list math, and `fv pv pmt nper rate npv irr bondprice bondytm macdur bondconvexity min max abs sqrt ln exp floor ceil sum count avg sumproduct topsum median var sd cov corr dw normcdf norminv tcdf tinv fcdf binompmf binomcdf nan pi` plus tax-table lookups (`incometax margrate bracketroom stddeduction ltcgtax niitthreshold niitrate rmdfactor limit401k limitira giftexclusion estateexemption estaterate`).

## Data and privacy

Saved work: `~/Library/Application Support/Wealth Desk/workspace.json`. The only network calls are the Markets page (Treasury.gov and Yahoo Finance, on open or Refresh); sources open in the browser only when clicked. Calculations only, not investment, tax or legal advice.
