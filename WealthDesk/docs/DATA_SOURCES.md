# Wealth Desk data sources

Every figure that does not come from the user's own typing comes from one of the sources below. Requests contain series names or ticker symbols only; nothing typed into a calculator is ever transmitted.

| Data | Source | Official? | How current | Where the app shows it |
| --- | --- | --- | --- | --- |
| Federal tax brackets, standard deduction, capital-gains thresholds, gift and estate amounts, 2026 | IRS Rev. Proc. 2025-32 | Yes | Verified 2026-11-10 against the PDF | Banner on every tax calculator; Settings ▸ Tax data |
| Same, 2027 | IRS Rev. Proc. 2026-35 (IR-2026-133) | Yes | Verified 2026-11-10 | Same |
| 401(k) and IRA limits, 2026 | IRS Notice 2025-67 / IR-2025-111 | Yes | Verified 2026-11-10. **2027 limits were not yet published**, so the 2027 table uses 2026 limits and says so | Same |
| RMD Uniform Lifetime Table | IRS Publication 590-B, Appendix B | Yes | All 49 factors (ages 72–120) compared with the publication | RMD calculator |
| Net investment income tax thresholds | IRS NIIT page (statutory, not indexed) | Yes | Verified 2026-11-10 | NIIT calculator |
| Check for newer IRS figures | irs.gov newsroom pages | Yes | Once a day at launch (optional) | Warning on tax calculators when the IRS has published something newer |
| Treasury par yield curve | U.S. Treasury daily rates CSV | Yes | End of day; observation date shown | Markets page |
| 18 economic, rate and credit series for RoRo | FRED public CSV (Federal Reserve Bank of St. Louis) | Yes (FRED republishes agency data; ICE BofA spread series are licensed to FRED) | Latest published; per-series date shown | RoRo ▸ Factors and Data status |
| 42 index, ETF, futures and FX price series for RoRo; watchlist quotes | Yahoo Finance chart feed | **No. Unofficial and unlicensed** | Delayed; can lag a day; may stop working | RoRo ▸ Data status; Markets watchlist (each quote shows its time) |

## Known limitations

- **Yahoo Finance is not a licensed data provider for this use.** It is acceptable for a prototype evaluation. A production or client-facing version should replace it with a licensed feed (for example the firm's own market-data entitlements). The feed is isolated in `MarketParsers` and `RoRoFetcher`, so the swap is contained.
- **Nothing is real-time.** The app labels data as "latest published", "latest close (delayed)", "cached" or "unavailable". When a download fails it shows the cached copy with a warning, or no figure at all; it never invents values.
- **State taxes are not implemented.** All tax calculators are federal only and say so.
- **Tax tables need a yearly update** (`Resources/taxdata.json`, then the IRS base-amount check in `Sources/wdcheck/main.swift` and `tools/audit.py`).
