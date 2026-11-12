#!/bin/bash
# Assembles the web version into dist/web: the page, the engine, and the same
# catalog.json / taxdata.json the macOS app ships. Runs the engine self-test first.
#   web/build.sh             build only
#   web/build.sh --full      also: parity test against the Swift engine, live RoRo model,
#                            RoRo report, and the Markets snapshot (needs Swift; macOS)
#   web/build.sh --serve     build, then serve at http://localhost:8765 (PORT=9000 to change)
# Flags combine: web/build.sh --full --serve
set -euo pipefail
cd "$(dirname "$0")/.."

full=0; serve=0
for a in "$@"; do
  case "$a" in
    --full) full=1 ;;
    --serve) serve=1 ;;
    *) echo "unknown option $a" >&2; exit 2 ;;
  esac
done

node web/check.mjs

out=dist/web
rm -rf "$out"
mkdir -p "$out/data"
cp web/index.html web/styles.css web/app.js web/engine.js web/scenario.js "$out/"
cp Resources/catalog.json Resources/taxdata.json "$out/data/"
touch "$out/.nojekyll"

if [[ $full == 1 ]]; then
  swift build -c release --product wdparity --product roro 2>&1 | tail -1
  node web/parity.mjs 80
  node web/scenario-check.mjs

  # RoRo: the app's own engine, on today's published data. A failed download leaves the
  # site without RoRo data rather than failing the whole build.
  cache=dist/roro_cache
  mkdir -p "$cache"
  if .build/release/roro fetch "$cache" && .build/release/roro build "$cache" "$out/data/roro.json"; then
    .build/release/roro meta "$out/data/roro_meta.json"
    node -e '
      const fs = require("fs");
      const t = fs.readFileSync("Resources/roro_template.html", "utf8");
      const m = fs.readFileSync(process.argv[1], "utf8").trim();
      if (!t.includes("/*__DATA__*/null")) throw new Error("template placeholder missing");
      fs.writeFileSync(process.argv[2], t.replace("/*__DATA__*/null", () => JSON.stringify(JSON.parse(m))));
    ' "$out/data/roro.json" "$out/roro_report.html"
  else
    echo "RoRo data unavailable this run; publishing without it." >&2
  fi
  .build/release/roro markets "$out/data/markets.json" SPY VTI BND AGG QQQ IWM EFA TLT GLD ^GSPC ^VIX \
    || echo "Markets snapshot unavailable this run." >&2
fi
echo "Built $out"

if [[ $serve == 1 ]]; then
  port="${PORT:-8765}"
  if lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port $port is already in use (an earlier server?). Try: PORT=9000 web/build.sh --serve" >&2
    exit 1
  fi
  echo "Serving at http://localhost:$port (Ctrl-C to stop)"
  cd "$out" && exec python3 -m http.server "$port"
fi
