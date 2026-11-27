#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
DEVICE_NAME="${DEVICE_NAME:-iPhone 17 Pro}"
DEVICE_ID=$(xcrun simctl list devices available | sed -n "s/.*$DEVICE_NAME *(\([A-F0-9-]*\)).*/\1/p" | head -1)
if [ -z "$DEVICE_ID" ]; then
  echo "Simulator not found: $DEVICE_NAME"
  xcrun simctl list devices available
  exit 1
fi
xcrun simctl boot "$DEVICE_ID" 2>/dev/null || true
xcrun simctl bootstatus "$DEVICE_ID" -b
xcodebuild -project native/apple/PDFReaderNative.xcodeproj -scheme PDFReaderNative-iOS -sdk iphonesimulator -destination "id=$DEVICE_ID" -configuration Debug CODE_SIGNING_ALLOWED=NO build
APP_PATH=$(find "$HOME/Library/Developer/Xcode/DerivedData" -path '*/Build/Products/Debug-iphonesimulator/PDFReaderNative-iOS.app' -type d -print | tail -1)
xcrun simctl install "$DEVICE_ID" "$APP_PATH"
xcrun simctl launch "$DEVICE_ID" com.dijitalkutuphane.pdfreader.native.ios
printf '\nInstalled and launched on simulator %s\n' "$DEVICE_NAME"
