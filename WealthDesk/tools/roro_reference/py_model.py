"""Run the original RoRo engine (unmodified) on a cache folder and dump its JSON model.
usage: py_model.py <roro_dir> <cache_dir> <out.json>"""
import sys, json, math
from pathlib import Path
roro_dir, cache_dir, out = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
sys.path.insert(0, str(roro_dir))
import data as data_mod
import engine

data_mod.CACHE = cache_dir
fred, yahoo, health = {}, {}, []
for sid in data_mod.FRED_SERIES:
    s = data_mod._load("fred", sid); fred[sid] = s
    health.append(dict(source="FRED", id=sid, status="ok" if s is not None else "missing",
                       last=None if s is None else s.index[-1].strftime("%Y-%m-%d")))
for t in data_mod.YF_TICKERS:
    s = data_mod._load("yf", t); yahoo[t] = s
    health.append(dict(source="Yahoo", id=t, status="ok" if s is not None else "missing",
                       last=None if s is None else s.index[-1].strftime("%Y-%m-%d")))
D = data_mod.Data(fred, yahoo, health)

def clean(o):
    if isinstance(o, float): return None if math.isnan(o) or math.isinf(o) else o
    if isinstance(o, dict): return {k: clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)): return [clean(v) for v in o]
    if hasattr(o, "item"): return clean(o.item())
    return o
model = clean(engine.build(D, None))
out.write_text(json.dumps(model, indent=1))
print("python model:", model["asof"], model["posture"]["band"], [h["value"] for h in model["horizons"]])
