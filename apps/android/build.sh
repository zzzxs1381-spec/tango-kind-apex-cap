#!/usr/bin/env bash
set -euo pipefail
task_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
prepared="$(realpath -- "${1:?Pass the prepared source directory}")"
test -f "$prepared/SOURCE-SHA256.json"
test -n "${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
export ANDROID_NDK_HOME="${ANDROID_NDK_HOME:-${ANDROID_HOME:-$ANDROID_SDK_ROOT}/ndk/28.0.13004108}"
export PATH="$PATH:$(go env GOPATH)/bin"
python3 "$task_root/verify_source.py" "$prepared"
(
  cd "$prepared/sing-box"
  make lib_install
  go run ./cmd/internal/build_libbox -target android -platform android/arm64
)
cp "$prepared/sing-box/libbox.aar" "$prepared/client/app/libs/libbox.aar"
(
  cd "$prepared/client"
  bash gradlew --no-daemon --max-workers=2 :app:assembleOtherDebug
)
python3 "$task_root/package.py" "$prepared"
