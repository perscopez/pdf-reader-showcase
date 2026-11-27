#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
swift build -c release
APP="dist/Dijital Kutuphane Native.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp .build/release/PDFReaderNative "$APP/Contents/MacOS/PDFReaderNative"
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>PDFReaderNative</string>
  <key>CFBundleIdentifier</key><string>com.dijitalkutuphane.pdfreader.native</string>
  <key>CFBundleName</key><string>Dijital Kütüphane</string>
  <key>CFBundleDisplayName</key><string>Dijital Kütüphane</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST
codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || true
echo "$PWD/$APP"
