#!/bin/bash
# Builds "Wealth Desk.app" into ./dist. Requires only the Xcode Command Line Tools.
#   ./build_app.sh            regenerate catalog, self-test, build, bundle
set -euo pipefail
cd "$(dirname "$0")"

APP="dist/Wealth Desk.app"
VERSION="1.0.0"

echo "→ Generating catalog"
python3 -I tools/build_catalog.py

echo "→ Building (release)"
swift build -c release

echo "→ Self-test"
.build/release/wdcheck Resources

echo "→ Bundling"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp .build/release/WealthDesk "$APP/Contents/MacOS/Wealth Desk"
cp Resources/catalog.json Resources/taxdata.json "$APP/Contents/Resources/"

ICONSET="$(mktemp -d)/WealthDesk.iconset"
mkdir -p "$ICONSET"
swift tools/make_icon.swift "$ICONSET/base.png"
for s in 16 32 128 256 512; do
  sips -z $s $s "$ICONSET/base.png" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  sips -z $((s*2)) $((s*2)) "$ICONSET/base.png" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
rm "$ICONSET/base.png"
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/WealthDesk.icns"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDisplayName</key><string>Wealth Desk</string>
  <key>CFBundleName</key><string>Wealth Desk</string>
  <key>CFBundleExecutable</key><string>Wealth Desk</string>
  <key>CFBundleIdentifier</key><string>local.wealthdesk.finance</string>
  <key>CFBundleIconFile</key><string>WealthDesk</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${VERSION}</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.finance</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSPrincipalClass</key><string>NSApplication</string>
</dict>
</plist>
PLIST

codesign --force --sign - "$APP" >/dev/null 2>&1 || echo "  (ad-hoc signing skipped)"
echo "✓ Built $APP"
