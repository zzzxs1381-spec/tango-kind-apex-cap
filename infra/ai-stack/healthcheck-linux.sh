#!/usr/bin/env bash
set -u

ok=0
fail=0
GOOSE_MODEL="${GOOSE_MODEL:-qwen3:8b}"
OLLAMA_HOST="${OLLAMA_HOST:-http://127.0.0.1:11434}"

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

if check_cmd goose; then
  goose --version || true
fi

if check_cmd ollama; then
  if model_list="$(OLLAMA_HOST="$OLLAMA_HOST" ollama list 2>/dev/null)"; then
    if awk 'NR > 1 { print $1 }' <<<"$model_list" | grep -Fxq "$GOOSE_MODEL"; then
      printf '\033[1;32m[ OK ]\033[0m Ollama model %s is available\n' "$GOOSE_MODEL"
      ok=$((ok+1))
    else
      printf '\033[1;31m[FAIL]\033[0m Ollama model %s is not installed\n' "$GOOSE_MODEL"
      fail=$((fail+1))
    fi
  else
    printf '\033[1;31m[FAIL]\033[0m Ollama endpoint %s is unreachable\n' "$OLLAMA_HOST"
    fail=$((fail+1))
  fi
fi

check_cmd node && node --version || true
check_cmd npm && npm --version || true
if command -v clawrouter >/dev/null 2>&1; then
  printf '\033[1;32m[ OK ]\033[0m %-12s %s\n' 'clawrouter' "$(command -v clawrouter)"
  printf '[INFO] BlockRun ClawRouter CLI is installed; wallet/login secrets are not inspected.\n'
fi

if command -v openclaw >/dev/null 2>&1; then
  if openclaw mcp doctor xfreedom-goose --probe; then
    printf '\033[1;32m[ OK ]\033[0m OpenClaw -> Goose MCP bridge\n'
    ok=$((ok+1))
  else
    printf '\033[1;31m[FAIL]\033[0m OpenClaw -> Goose MCP bridge\n'
    fail=$((fail+1))
  fi
fi

if command -v hermes >/dev/null 2>&1; then
  if hermes mcp test xfreedom_goose; then
    printf '\033[1;32m[ OK ]\033[0m Hermes -> Goose MCP bridge\n'
    ok=$((ok+1))
  else
    printf '\033[1;31m[FAIL]\033[0m Hermes -> Goose MCP bridge\n'
    fail=$((fail+1))
  fi
fi

probe_port 'OpenClaw Gateway' 18789
probe_port 'ClawRouter proxy' 8402
if [[ "$OLLAMA_HOST" =~ ^https?://(127\.0\.0\.1|localhost|\[::1\]):11434/?$ ]]; then
  probe_port 'Ollama API' 11434
else
  printf '\033[1;36m[INFO]\033[0m Ollama endpoint configured as %s\n' "$OLLAMA_HOST"
fi

if command -v systemctl >/dev/null 2>&1; then
  printf '\nManaged user services:\n'
  systemctl --user --no-pager --full status openclaw-gateway.service 2>/dev/null | sed -n '1,8p' || true
  systemctl --user --no-pager --full status hermes-gateway.service 2>/dev/null | sed -n '1,8p' || true
fi

printf '\nCommands present: %d OK, %d missing\n' "$ok" "$fail"
[[ "$fail" -eq 0 ]]
