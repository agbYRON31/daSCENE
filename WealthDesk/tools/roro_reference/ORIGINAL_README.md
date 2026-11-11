# RoRo Composite — live build

Pulls ~60 series from FRED and Yahoo Finance, scores 37 factors across six buckets, and writes a single-file HTML dashboard: posture navigator, master signal, three horizon dials, bucket decomposition, 24-month history, divergence flags, VIX playbook, breadth, asset-class leadership, sortable factor table, scenario stress tests, and historical analogs with signal-vs-buy-and-hold backtests.

## Setup (once)

```bash
cd roro
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # then paste your FRED key into .env
```

Get a free FRED key at https://fredaccount.stlouisfed.org/apikey (takes about a minute). The key is optional: without one the script falls back to FRED's public CSV endpoint, which works but is slower and less reliable. Yahoo data needs no key.

## Run

```bash
python roro.py --open       # fetch, score, open output/roro_latest.html
python roro.py --offline    # rebuild from the local cache, no network
python roro.py --demo       # synthetic data, to see the layout (watermarked)
```

Each run writes `output/roro_latest.html`, a dated copy, a JSON dump of every number, and appends to `output/runs.csv` (the "last run" marker on the posture bar comes from there). The first run takes a minute or two; FRED and Yahoo downloads are cached in `data_cache/`, and if a source fails the last good copy is used and flagged in the Data Health panel.

## Schedule it (weekdays after the close)

`crontab -e`, then add (1:45 pm Pacific = 4:45 pm ET):

```
45 13 * * 1-5 cd ~/path/to/roro && .venv/bin/python roro.py >> output/cron.log 2>&1
```

## Tune it

Everything lives in `config.py`:

- **FACTORS**: each factor's calc, score map (piecewise-linear `(reading, score)` points), weight, and source.
- **HORIZON_WEIGHTS / HORIZON_SMOOTHING**: how buckets combine into Tactical / Intermediate / Strategic.
- **OFFENSE_LINE / DEFENSE_LINE**: posture thresholds (±20).
- **SCENARIOS**: stress-test shocks, as overrides to raw factor readings.

## How this differs from the PDF mock-up

- **Real data only.** Every reading, score, analog, forward return and VIX-band statistic is computed from the downloaded series.
- **Free-data substitutions.** NAAIM, AAII, CBOE put/call, the Conference Board LEI, ISM and "% of SPX at all-time highs" aren't available from free APIs. They are replaced by CFNAI, building permits, industrial production, VIX term structure, MOVE, SKEW, % of sector ETFs above their 200-DMA, RSP:SPY and NYSE-vs-SPX breadth.
- **Hand-set score maps, not a fitted model.** There's no Bayesian-ridge calibration. The analog backtests replay the rule with today's maps on revised data, so treat them as in-sample illustrations, not out-of-sample evidence.
- **Scenarios carry no probability labels.** Each card is a mechanical re-score under stated shocks.

## Known data quirks

- The ICE BofA OAS series on FRED (HY and IG OAS) may only carry a few years of history. The Credit bucket still has long history through Moody's Baa−10y, and factors re-weight around gaps, so older analog periods lean on fewer credit inputs.
- Yahoo occasionally rate-limits. The run falls back to cache and says so at the top of the page. Re-run in a few minutes.
- `^MOVE`, `^SKEW` and `^VIX3M` come from Yahoo index pages and can lag by a day.

Not investment advice.
