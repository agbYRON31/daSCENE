#!/usr/bin/env python3
"""
RoRo Composite — pull live data, score the model, write the dashboard.

  python roro.py              # fetch live data, write output/roro_latest.html
  python roro.py --open       # ...and open it in your browser
  python roro.py --offline    # rebuild from the local cache only
  python roro.py --demo       # synthetic data (pipeline test; clearly watermarked)
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import sys
import webbrowser
from pathlib import Path

ROOT = Path(__file__).parent
sys.path.insert(0, str(ROOT))

import data as data_mod  # noqa: E402
import engine  # noqa: E402


def clean(o):
    if isinstance(o, float):
        return None if math.isnan(o) or math.isinf(o) else o
    if isinstance(o, dict):
        return {k: clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [clean(v) for v in o]
    if hasattr(o, "item"):          # numpy scalars
        return clean(o.item())
    return o


def last_run(log: Path, today_iso: str):
    if not log.exists():
        return None
    rows = [r for r in csv.DictReader(log.open()) if r["date"] < today_iso]
    if not rows:
        return None
    r = rows[-1]
    return dict(date=r["date"], intermediate=float(r["intermediate"]))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--demo", action="store_true", help="use synthetic data")
    ap.add_argument("--offline", action="store_true", help="use cached data only")
    ap.add_argument("--open", action="store_true", help="open the dashboard when done")
    ap.add_argument("--out", default=str(ROOT / "output"), help="output folder")
    a = ap.parse_args()

    data_mod.load_env(ROOT / ".env")
    D = data_mod.load_demo() if a.demo else data_mod.load_live(offline=a.offline)

    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    log = out / "runs.csv"
    model = engine.build(D, None if a.demo else last_run(log, D.index[-1].strftime("%Y-%m-%d")))
    model = clean(model)

    html = (ROOT / "template.html").read_text()
    html = html.replace("/*__DATA__*/null", json.dumps(model, separators=(",", ":")))
    tag = "demo" if a.demo else model["asof_iso"]
    dated = out / f"roro_{tag}.html"
    latest = out / ("roro_demo.html" if a.demo else "roro_latest.html")
    dated.write_text(html)
    if latest != dated:
        latest.write_text(html)
    (out / f"roro_{tag}.json").write_text(json.dumps(model, indent=1))

    if not a.demo:
        new = not log.exists()
        rows = []
        if not new:
            rows = [r for r in csv.DictReader(log.open()) if r["date"] != model["asof_iso"]]
        p = model["posture"]
        hz = {h["key"]: h["value"] for h in model["horizons"]}
        rows.append(dict(date=model["asof_iso"], tactical=hz["tactical"], intermediate=hz["intermediate"],
                         strategic=hz["strategic"], posture=p["band"]))
        with log.open("w", newline="") as fh:
            w = csv.DictWriter(fh, fieldnames=["date", "tactical", "intermediate", "strategic", "posture"])
            w.writeheader()
            w.writerows(rows)

    p, m = model["posture"], model["master"]
    print(f"\nRoRo · as of {model['asof']} · {model['n_live']}/{model['n_factors']} factors live")
    for h in model["horizons"]:
        print(f"  {h['label']:<13} {h['value']:+4.0f}   {h['band']}")
    print(f"  Posture: {p['band']} {p['lean']}  ·  Master: {m['head']} ({m['confidence']})")
    if model["stale"]:
        print(f"  ⚠ {len(model['stale'])} series missing or from cache — see the Data Health panel")
    print(f"\n→ {latest}")
    if a.open:
        webbrowser.open(latest.resolve().as_uri())


if __name__ == "__main__":
    main()
