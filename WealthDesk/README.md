# Wealth Desk

A native macOS calculator desk for wealth management: 57 formulas across growth, retirement, tax, portfolio, fees and planning, each with assumptions, Excel equivalents and self-tests. Modeled on the CRE Desk design. Runs fully offline.

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
| `Sources/wdcheck` | Self-test: Swift must reproduce every Python-computed expected value (141 checks). |

## Adding a calculator

1. Add a `calc(...)` entry in `tools/build_catalog.py` (example inputs are required: they become the self-test).
2. `./build_app.sh`. If the Swift and Python implementations disagree, the build stops.

Formula language: `+ - * / ^`, comparisons, `if(c,a,b)`, element-wise list math, and `fv pv pmt nper rate npv irr min max abs sqrt ln exp sum count avg sumproduct` plus tax-table lookups (`incometax margrate bracketroom stddeduction ltcgtax niitthreshold niitrate rmdfactor limit401k limitira giftexclusion estateexemption estaterate`).

## Data and privacy

Saved work: `~/Library/Application Support/Wealth Desk/workspace.json`. No network calls; sources open in the browser only when clicked. Calculations only, not investment, tax or legal advice.
