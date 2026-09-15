#!/usr/bin/env bash
set -Eeuo pipefail

fail=0
warn=0

echo "XFreedom Agent Security Check (Linux)"

if command -v openclaw >/dev/null 2>&1; then
  doctor="$(openclaw doctor 2>&1 || true)"
  if grep -q 'browser\.extensionRelay\.allowLegacyAuth=true' <<<"$doctor"; then
    echo "[FAIL] OpenClaw legacy Browser Relay authentication is enabled."
    echo "       Update relay clients to Auth v2, then set allowLegacyAuth=false."
    fail=1
  else
    echo "[ OK ] No explicit legacy Browser Relay auth warning detected by doctor."
  fi
else
  echo "[WARN] openclaw command not found; relay auth could not be checked."
  warn=1
fi

if command -v ss >/dev/null 2>&1; then
  listeners="$(ss -ltnH 2>/dev/null || true)"
  for port in 18789 8402; do
    matches="$(grep -E "[:.]${port}[[:space:]]" <<<"$listeners" || true)"
    [[ -z "$matches" ]] && continue
    while IFS= read -r line; do
      local_addr="$(awk '{print $4}' <<<"$line")"
      case "$local_addr" in
        127.0.0.1:${port}|\[::1\]:${port})
          echo "[ OK ] Port $port is loopback-bound: $local_addr"
          ;;
        *)
          echo "[WARN] Port $port is non-loopback: $local_addr"
          echo "       Confirm it is reachable only through an authenticated private network."
          warn=1
          ;;
      esac
    done <<<"$matches"
  done
else
  echo "[WARN] ss not available; listener exposure was not checked."
  warn=1
fi

if [[ $fail -ne 0 ]]; then exit 2; fi
if [[ $warn -ne 0 ]]; then exit 1; fi
exit 0
