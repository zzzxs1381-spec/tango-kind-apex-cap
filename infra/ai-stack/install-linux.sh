#!/usr/bin/env bash
set -euo pipefail

INSTALL_SERVICES="${INSTALL_SERVICES:-0}"
INSTALL_BLOCKRUN_CLAWROUTER="${INSTALL_BLOCKRUN_CLAWROUTER:-1}"

step() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }
warn() { printf '\033[1;33mWARN: %s\033[0m\n' "$1" >&2; }
has() { command -v "$1" >/dev/null 2>&1; }

export PATH="$HOME/.local/bin:$HOME/bin:$PATH"

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

printf '\n\033[1;32mBootstrap complete.\033[0m\n'
printf '%s\n' 'Next: run "openclaw onboard" and "hermes setup" once.'
printf '%s\n' 'Optional BlockRun routing: run "clawrouter setup" yourself. It may create/import wallet credentials and is intentionally not automated.'
printf '%s\n' 'After onboarding, run: INSTALL_SERVICES=1 bash infra/ai-stack/install-linux.sh'
