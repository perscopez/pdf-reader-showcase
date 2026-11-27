#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$ANDROID_HOME}"
GRADLE_BIN="${GRADLE_BIN:-}"
if [ -z "$GRADLE_BIN" ]; then
  if [ -x ./gradlew ]; then GRADLE_BIN="./gradlew";
  elif command -v gradle >/dev/null 2>&1; then GRADLE_BIN="gradle";
  elif [ -x /tmp/gradle-9.5.0/bin/gradle ]; then GRADLE_BIN="/tmp/gradle-9.5.0/bin/gradle";
  else echo "Gradle not found. Use Android Studio or set GRADLE_BIN."; exit 1; fi
fi
"$GRADLE_BIN" assembleDebug --no-daemon
printf '\nAPK: %s\n' "$PWD/app/build/outputs/apk/debug/app-debug.apk"
