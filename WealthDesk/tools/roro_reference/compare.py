"""Compare two RoRo JSON models. Numbers must match; rounding-boundary differences of one unit are reported separately.
usage: compare.py <python.json> <swift.json>"""
import sys, json
a, b = json.load(open(sys.argv[1])), json.load(open(sys.argv[2]))
diffs, near = [], []
def walk(x, y, path):
    if path in ("$.generated",): return
    if isinstance(x, dict) and isinstance(y, dict):
        for k in set(x) | set(y):
            if k not in x or k not in y: diffs.append(f"{path}.{k}: missing in {'swift' if k not in y else 'python'}"); continue
            walk(x[k], y[k], f"{path}.{k}")
    elif isinstance(x, list) and isinstance(y, list):
        if len(x) != len(y): diffs.append(f"{path}: length {len(x)} vs {len(y)}"); return
        for i, (p, q) in enumerate(zip(x, y)): walk(p, q, f"{path}[{i}]")
    elif isinstance(x, bool) or isinstance(y, bool):
        if x != y: diffs.append(f"{path}: {x!r} vs {y!r}")
    elif isinstance(x, (int, float)) and isinstance(y, (int, float)):
        d = abs(x - y)
        if d <= 1e-9 * max(1, abs(x)): return
        # one unit of the rounding used for this number (r1 rounds to 0, 1 or 3 decimals)
        unit = min(u for u in (1, 0.1, 0.001) if abs(round(x / u) * u - x) < 1e-9) if x == x else 1
        if d <= unit + 1e-9: near.append(f"{path}: {x} vs {y}")
        else: diffs.append(f"{path}: {x!r} vs {y!r}")
    elif x != y:
        diffs.append(f"{path}: {x!r} vs {y!r}")
walk(a, b, "$")
print(f"{len(diffs)} differences, {len(near)} one-unit rounding-boundary differences")
for d in diffs[:60]: print("  DIFF", d)
for d in near[:20]: print("  NEAR", d)
sys.exit(1 if diffs else 0)
