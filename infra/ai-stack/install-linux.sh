#!/usr/bin/env bash
set -euo pipefail

INSTALL_SERVICES="${INSTALL_SERVICES:-0}"
INSTALL_BLOCKRUN_CLAWROUTER="${INSTALL_BLOCKRUN_CLAWROUTER:-0}"
INSTALL_GOOSE="${INSTALL_GOOSE:-1}"
INSTALL_OLLAMA="${INSTALL_OLLAMA:-1}"
PULL_GOOSE_MODEL="${PULL_GOOSE_MODEL:-1}"
LINK_GOOSE_CONTROLLERS="${LINK_GOOSE_CONTROLLERS:-1}"
GOOSE_MODEL="${GOOSE_MODEL:-qwen3:8b}"
OLLAMA_HOST="${OLLAMA_HOST:-http://127.0.0.1:11434}"
XF_GOOSE_WORKSPACE_ROOT="${XF_GOOSE_WORKSPACE_ROOT:-$HOME/xfreedom-agent-workspace}"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
GOOSE_WORKER_DIR="$SCRIPT_DIR/goose-worker"

step() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }
warn() { printf '\033[1;33mWARN: %s\033[0m\n' "$1" >&2; }
has() { command -v "$1" >/dev/null 2>&1; }

export PATH="$HOME/.local/bin:$HOME/bin:$PATH"
export GOOSE_MODEL OLLAMA_HOST XF_GOOSE_WORKSPACE_ROOT

printf '\033[1;32mXFreedom AI Agent Stack - Linux/VPS bootstrap\033[0m\n'
printf '%s\n' 'Installs official runtimes; provider keys, bot tokens and wallet secrets are never written by this script.'

step 'Base tools'
if ! has curl || ! has git; then
  if has apt-get && has sudo; then
    sudo apt-get update
    sudo apt-get install -y curl git ca-certificates
  else
    echo 'curl and git are required. Install them with the host package manager and rerun.' >&2
    exit 1
  fi
fi

step 'OpenClaw'
if ! has openclaw; then
  curl -fsSL --proto '=https' --tlsv1.2 https://openclaw.ai/install.sh | bash -s -- --no-onboard
  export PATH="$HOME/.local/bin:$HOME/bin:$PATH"
fi
if ! has openclaw; then
  echo 'OpenClaw installed but is not on PATH. Start a new login shell and rerun.' >&2
  exit 1
fi
openclaw --version

step 'Hermes Agent'
if ! has hermes; then
  curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash -s -- --skip-setup --non-interactive
  export PATH="$HOME/.local/bin:$HOME/bin:$PATH"
fi
if ! has hermes; then
  echo 'Hermes installed but is not on PATH. Start a new login shell and rerun.' >&2
  exit 1
fi
hermes --help >/dev/null
printf 'Hermes CLI: OK\n'

if [[ "$INSTALL_GOOSE" == "1" ]]; then
  step 'Goose local worker'
  if ! has goose; then
    curl -fsSL --proto '=https' --tlsv1.2 \
      https://github.com/aaif-goose/goose/releases/download/stable/download_cli.sh | CONFIGURE=false bash
    export PATH="$HOME/.local/bin:$HOME/bin:$PATH"
  fi
  if ! has goose; then
    echo 'Goose installed but is not on PATH. Start a new login shell and rerun.' >&2
    exit 1
  fi
  goose --version
fi

if [[ "$INSTALL_OLLAMA" == "1" ]]; then
  step 'Ollama local inference runtime'
  if ! has ollama; then
    curl -fsSL --proto '=https' --tlsv1.2 https://ollama.com/install.sh | sh
    hash -r
  fi
  if ! has ollama; then
    echo 'Ollama install completed but ollama is not on PATH.' >&2
    exit 1
  fi

  ollama_ready() {
    curl -fsS --max-time 3 "${OLLAMA_HOST%/}/api/tags" >/dev/null 2>&1
  }

  if ! ollama_ready && [[ "$OLLAMA_HOST" =~ ^https?://(127\.0\.0\.1|localhost|\[::1\])(:[0-9]+)?/?$ ]]; then
    if has systemctl && systemctl list-unit-files ollama.service >/dev/null 2>&1; then
      if has sudo; then
        sudo systemctl start ollama || warn 'Could not start the Ollama system service.'
      else
        systemctl start ollama || warn 'Could not start the Ollama system service without sudo.'
      fi
    fi

    if ! ollama_ready; then
      mkdir -p "$HOME/.ollama"
      nohup env OLLAMA_HOST="$OLLAMA_HOST" ollama serve >"$HOME/.ollama/xfreedom-serve.log" 2>&1 &
    fi

    for _ in {1..15}; do
      ollama_ready && break
      sleep 1
    done
  fi

  if ! ollama_ready; then
    warn "Ollama is installed but ${OLLAMA_HOST%/} is not reachable. Start it before using Goose."
  elif [[ "$PULL_GOOSE_MODEL" == "1" ]]; then
    OLLAMA_HOST="$OLLAMA_HOST" ollama pull "$GOOSE_MODEL"
  fi
fi

if [[ "$LINK_GOOSE_CONTROLLERS" == "1" ]]; then
  step 'Goose MCP bridge for OpenClaw and Hermes'
  if ! has node || ! has npm; then
    echo 'Node.js 22+ and npm are required for the Goose MCP bridge.' >&2
    exit 1
  fi
  node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
  if (( node_major < 22 )); then
    echo "Node.js 22+ is required for the Goose MCP bridge; found $(node --version)." >&2
    exit 1
  fi

  npm --prefix "$GOOSE_WORKER_DIR" ci --omit=dev --ignore-scripts
  node "$GOOSE_WORKER_DIR/link.mjs" \
    --target all \
    --workspace "$XF_GOOSE_WORKSPACE_ROOT" \
    --no-probe
fi

if [[ "$INSTALL_BLOCKRUN_CLAWROUTER" == "1" ]]; then
  step 'Optional BlockRun ClawRouter package'
  if has npm; then
    if npm install -g '@blockrun/clawrouter'; then
      hash -r
      if has clawrouter; then
        printf 'BlockRun ClawRouter CLI: OK\n'
      else
        warn 'Package installed, but clawrouter is not yet on PATH. Reopen the shell before setup.'
      fi
    else
      warn 'Global npm install failed. The rest of the stack is intact; fix npm prefix/permissions and rerun.'
    fi
  else
    warn 'npm is unavailable; skipping optional BlockRun ClawRouter package.'
  fi
fi

if [[ "$INSTALL_SERVICES" == "1" ]]; then
  step 'Managed gateway services'

  if [[ -f "$HOME/.openclaw/openclaw.json" || -f "$HOME/.openclaw/config.json" ]]; then
    openclaw gateway install
    openclaw gateway status --json || true
  else
    warn 'OpenClaw has not been onboarded. Run: openclaw onboard'
  fi

  if [[ -f "$HOME/.hermes/config.yaml" ]]; then
    hermes gateway install
    hermes gateway status || true
  else
    warn 'Hermes has not been configured. Run: hermes setup'
  fi

  if has loginctl; then
    if has sudo; then
      sudo loginctl enable-linger "$(id -un)" || warn 'Could not enable linger; user services may stop after logout.'
    else
      warn 'sudo unavailable; enable systemd linger manually for always-on VPS operation.'
    fi
  fi
fi

step 'Diagnostics'
openclaw doctor || warn 'openclaw doctor reported an issue; onboarding may still be pending.'
hermes doctor || warn 'hermes doctor reported an issue; setup may still be pending.'
if [[ "$LINK_GOOSE_CONTROLLERS" == "1" ]]; then
  openclaw mcp doctor xfreedom-goose --probe || warn 'OpenClaw could not probe the Goose MCP bridge.'
  hermes mcp test xfreedom_goose || warn 'Hermes could not probe the Goose MCP bridge.'
fi

printf '\n\033[1;32mBootstrap complete.\033[0m\n'
printf '%s\n' 'Next: run "openclaw onboard" and "hermes setup" once.'
printf '%s\n' "Goose worker: local Ollama model '$GOOSE_MODEL', workspace '$XF_GOOSE_WORKSPACE_ROOT'."
printf '%s\n' 'Optional BlockRun routing: rerun with INSTALL_BLOCKRUN_CLAWROUTER=1, then run "clawrouter setup" yourself.'
printf '%s\n' 'After onboarding, run: INSTALL_SERVICES=1 bash infra/ai-stack/install-linux.sh'
