# XFreedom AI Agent Stack

Production-oriented bootstrap for a dual-host agent stack on native Windows and Ubuntu/VPS.

## Roles

- **OpenClaw** — primary control plane, channels, tools, gateway and model-provider selection.
- **Hermes Agent** — specialist/learning agent for long research, reusable skills and independent jobs.
- **ClawRouter / multi-provider routing** — optional routing layer. OpenClaw ships a built-in `clawrouter` provider; BlockRun also publishes a distinct local ClawRouter integration. Do not confuse the two.
- **Your XFreedom panel** remains the product UI. These components are runtime infrastructure, not a replacement UI.

This layout deliberately avoids making OpenClaw and Hermes both own the same Telegram/WhatsApp token. Give one gateway ownership of each channel, or use separate bot identities.

## Security contract

1. No provider keys, bot tokens, wallet mnemonics or passwords are committed to Git.
2. Gateway and router ports stay loopback-only unless you intentionally put them behind an authenticated private network/reverse proxy.
3. Never expose ClawRouter port `8402` or OpenClaw Gateway port `18789` directly to the public Internet.
4. Keep OpenClaw and Hermes workspaces separate when both can write files. Use Git branches/PRs as the synchronization boundary.
5. Run third-party skills/plugins only after reviewing their source and requested capabilities.

## Windows

Run PowerShell as your normal user:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\infra\ai-stack\install-windows.ps1
```

The script installs/verifies OpenClaw, Hermes and the optional BlockRun ClawRouter package without inventing credentials. It intentionally does **not** create or fund a wallet and does not write provider secrets.

Finish provider setup once:

```powershell
openclaw onboard
hermes setup
```

For managed OpenClaw startup after onboarding:

```powershell
openclaw gateway install
openclaw gateway status --json
```

Hermes native Windows can be used interactively or through its supported gateway flow after `hermes setup`.

Run health checks:

```powershell
.\infra\ai-stack\healthcheck-windows.ps1
```

## Ubuntu / VPS

Run as the unprivileged account that should own the agents:

```bash
bash infra/ai-stack/install-linux.sh
```

Then configure providers/channels once:

```bash
openclaw onboard
hermes setup
```

After configuration, rerun the installer with service activation:

```bash
INSTALL_SERVICES=1 bash infra/ai-stack/install-linux.sh
```

This uses the projects' own supported service installers instead of hand-written process supervisors. On Linux, OpenClaw installs a systemd user unit. Hermes installs its managed gateway service. The script enables systemd linger when `loginctl` and passwordless/interactive `sudo` are available.

Run health checks:

```bash
bash infra/ai-stack/healthcheck-linux.sh
```

## Router choices

### A. OpenClaw built-in ClawRouter provider

Use this when you have a scoped `CLAWROUTER_API_KEY`. Configure through OpenClaw's onboarding/provider flow; the plugin is bundled with OpenClaw.

### B. BlockRun ClawRouter local proxy

The bootstrap installs the npm package when npm is available, but stops before financial/wallet setup. To opt in later:

```bash
clawrouter setup
```

The local OpenAI-compatible proxy normally listens on `127.0.0.1:8402`. Hermes can then be pointed to the local endpoint or configured with the published Hermes plugin. Keep the mnemonic/private key out of this repository.

### C. Direct provider routing

If you already have OpenAI/Anthropic/Google/etc. credentials, configure them directly in OpenClaw/Hermes and add routing only after a single-provider chat passes. This is the easiest path to debug.

## Why two agents instead of one giant agent

OpenClaw is the orchestration/control surface. Hermes is an independent specialist that can learn reusable skills and run longer jobs. Keeping them as separate processes gives you isolation, independent restart/health state, and a clean rollback path. Model routing is a separate layer so changing models does not require replacing either agent runtime.

## Expected ports

| Component | Default | Exposure |
|---|---:|---|
| OpenClaw Gateway | `18789` | loopback/private only |
| BlockRun ClawRouter proxy | `8402` | loopback only |

## Files

- `install-windows.ps1` — idempotent Windows bootstrap.
- `install-linux.sh` — idempotent Ubuntu/VPS bootstrap.
- `healthcheck-windows.ps1` — command/version/gateway checks.
- `healthcheck-linux.sh` — command/version/gateway/service checks.
- `stack.env.example` — non-secret defaults only.
