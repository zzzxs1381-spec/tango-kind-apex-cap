#!/usr/bin/env bash
set -u

ok=0
fail=0

check_cmd() {
  if command -v "$1" >/dev/null 2>&1; then
    printf '\033[1;32m[ OK ]\033[0m %-12s %s\n' "$1" "$(command -v "$1")"
    ok=$((ok+1))
    return 0
  fi
  printf '\033[1;31m[FAIL]\033[0m %-12s not found\n' "$1"
  fail=$((fail+1))
  return 1
}

probe_port() {
  local name="$1" port="$2"
  if command -v bash >/dev/null 2>&1 && timeout 2 bash -c "</dev/tcp/127.0.0.1/$port" >/dev/null 2>&1; then
    printf '\033[1;32m[LISTEN]\033[0m %s on 127.0.0.1:%s\n' "$name" "$port"
  else
    printf '\033[1;33m[DOWN ]\033[0m %s on 127.0.0.1:%s\n' "$name" "$port"
  fi
}

printf '\033[1;36mXFreedom AI Agent Stack health check\033[0m\n'

if check_cmd openclaw; then
  openclaw --version || true
  openclaw gateway status --json || true
fi

if check_cmd hermes; then
  hermes doctor || true
fi

check_cmd node && node --version || true
check_cmd npm && npm --version || true
if check_cmd clawrouter; then
  printf '[INFO] BlockRun ClawRouter CLI is installed; wallet/login secrets are not inspected.\n'
fi

probe_port 'OpenClaw Gateway' 18789
probe_port 'ClawRouter proxy' 8402

if command -v systemctl >/dev/null 2>&1; then
  printf '\nManaged user services:\n'
  systemctl --user --no-pager --full status openclaw-gateway.service 2>/dev/null | sed -n '1,8p' || true
  systemctl --user --no-pager --full status hermes-gateway.service 2>/dev/null | sed -n '1,8p' || true
fi

printf '\nCommands present: %d OK, %d missing\n' "$ok" "$fail"
[[ "$fail" -eq 0 ]]
