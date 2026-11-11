#!/bin/bash
# Assembles the web version into dist/web: the page, the engine, and the same
# catalog.json / taxdata.json the macOS app ships. Runs the engine self-test first.
#   web/build.sh            build only
#   web/build.sh --serve    build, then serve at http://localhost:8765
set -euo pipefail
cd "$(dirname "$0")/.."

node web/check.mjs

out=dist/web
rm -rf "$out"
mkdir -p "$out/data"
cp web/index.html web/styles.css web/app.js web/engine.js "$out/"
cp Resources/catalog.json Resources/taxdata.json "$out/data/"
touch "$out/.nojekyll"
echo "Built $out"

if [[ "${1:-}" == "--serve" ]]; then
  cd "$out" && exec python3 -m http.server 8765
fi
