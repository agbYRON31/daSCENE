#!/bin/bash
# Builds, tests and packages Wealth Desk. Requires only the Xcode Command Line Tools.
#
#   ./build_app.sh                 full build: audit, universal app, self-tests, .app + .dmg + .zip in ./dist
#   SKIP_AUDIT=1 ./build_app.sh    skip the 80-second independent accuracy audit
#
# Distribution signing (optional; needs a paid Apple Developer account):
#   SIGN_IDENTITY="Developer ID Application: Your Name (TEAMID)" NOTARY_PROFILE=wealthdesk ./build_app.sh
#   (create the profile once with: xcrun notarytool store-credentials wealthdesk)
# Without SIGN_IDENTITY the app is ad-hoc signed: it runs on this Mac, but other Macs will warn.
set -euo pipefail
cd "$(dirname "$0")"

APP="dist/Wealth Desk.app"
VERSION="2.0.0"
BUILD="20"
IDENTITY="${SIGN_IDENTITY:--}"

echo "→ Generating catalog"
python3 -I tools/build_catalog.py | head -1

if [ -z "${SKIP_AUDIT:-}" ]; then
  echo "→ Independent accuracy audit"
  python3 -I tools/audit.py
fi

echo "→ Building (release, Apple silicon + Intel)"
swift build -c release --triple arm64-apple-macosx13.0 2>&1 | tail -1
swift build -c release --triple x86_64-apple-macosx13.0 2>&1 | tail -1
A=.build/arm64-apple-macosx/release
X=.build/x86_64-apple-macosx/release

echo "→ Self-test (both architectures where runnable)"
"$A/wdcheck" Resources | tail -1
if arch -x86_64 /usr/bin/true 2>/dev/null; then arch -x86_64 "$X/wdcheck" Resources | tail -1; else echo "  (Rosetta not installed; Intel build compiled but not run)"; fi

echo "→ Bundling"
rm -rf dist
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
lipo -create "$A/WealthDesk" "$X/WealthDesk" -output "$APP/Contents/MacOS/Wealth Desk"
cp Resources/catalog.json Resources/taxdata.json Resources/roro_template.html "$APP/Contents/Resources/"

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
  <key>CFBundleVersion</key><string>${BUILD}</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.finance</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSPrincipalClass</key><string>NSApplication</string>
  <key>NSHumanReadableCopyright</key><string>Independent educational software. Not affiliated with or endorsed by Morgan Stanley.</string>
</dict>
</plist>
PLIST

echo "→ Signing (sandboxed, hardened runtime) with: ${IDENTITY/#-/ad-hoc signature}"
codesign --force --options runtime --entitlements Resources/WealthDesk.entitlements --sign "$IDENTITY" "$APP"
codesign --verify --deep --strict "$APP" && echo "  signature verifies"

echo "→ Packaging"
STAGE="$(mktemp -d)/Wealth Desk"
mkdir -p "$STAGE"
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
cp docs/INSTALL.txt "$STAGE/Read Me First.txt"
hdiutil create -quiet -volname "Wealth Desk" -srcfolder "$STAGE" -ov -format UDZO "dist/Wealth Desk.dmg"
ditto -c -k --keepParent "$APP" "dist/Wealth Desk.zip"
[ "$IDENTITY" != "-" ] && codesign --force --sign "$IDENTITY" "dist/Wealth Desk.dmg"

if [ -n "${NOTARY_PROFILE:-}" ] && [ "$IDENTITY" != "-" ]; then
  echo "→ Notarizing with Apple"
  xcrun notarytool submit "dist/Wealth Desk.dmg" --keychain-profile "$NOTARY_PROFILE" --wait
  xcrun stapler staple "dist/Wealth Desk.dmg"
  xcrun stapler staple "$APP"
  ditto -c -k --keepParent "$APP" "dist/Wealth Desk.zip"
else
  echo "  NOT notarized (no Developer ID credentials). Other Macs will show a Gatekeeper warning."
fi
lipo -archs "$APP/Contents/MacOS/Wealth Desk"
ls -lh dist | tail -3
echo "✓ Built dist/Wealth Desk.app, .dmg and .zip (version ${VERSION})"
