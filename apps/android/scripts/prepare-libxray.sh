#!/usr/bin/env bash
set -euo pipefail

LIBXRAY_VERSION="v26.9.9"
LIBXRAY_SHA256="4998a8b56e4a78a164b5359d5690036f83da3b575465cea57ddf29c0149c345f"
LIBXRAY_URL="https://github.com/XTLS/libXray/releases/download/${LIBXRAY_VERSION}/libxray-android.zip"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ANDROID_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
LIB_DIR="${ANDROID_DIR}/app/libs"
WORK_DIR="${ANDROID_DIR}/.native-cache/libxray/${LIBXRAY_VERSION}"
ARCHIVE="${WORK_DIR}/libxray-android.zip"
EXTRACTED="${WORK_DIR}/extracted"
OUTPUT="${LIB_DIR}/libxray-${LIBXRAY_VERSION}.aar"

mkdir -p "${LIB_DIR}" "${WORK_DIR}"

if [[ -f "${OUTPUT}" ]]; then
  echo "libXray already prepared: ${OUTPUT}"
  exit 0
fi

if [[ ! -f "${ARCHIVE}" ]]; then
  curl --fail --location --retry 3 --retry-all-errors \
    --output "${ARCHIVE}" \
    "${LIBXRAY_URL}"
fi

echo "${LIBXRAY_SHA256}  ${ARCHIVE}" | sha256sum --check --strict

rm -rf "${EXTRACTED}"
mkdir -p "${EXTRACTED}"
unzip -q "${ARCHIVE}" -d "${EXTRACTED}"

AAR="$(find "${EXTRACTED}" -type f -name '*.aar' -print -quit)"
if [[ -z "${AAR}" ]]; then
  echo "No .aar found in pinned libXray Android release archive" >&2
  exit 2
fi

cp "${AAR}" "${OUTPUT}"
echo "Prepared ${OUTPUT}"
