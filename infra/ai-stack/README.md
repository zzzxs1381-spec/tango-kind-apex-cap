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
6. Unknown MCP servers and skills start in quarantine with no host secrets, no host HOME and no network.
7. A model never receives credential-store access directly; privileged actions belong behind a separate approval boundary.

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

Run health and security checks:

```powershell
.\infra\ai-stack\healthcheck-windows.ps1
.\infra\ai-stack\security\security-check-windows.ps1
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

Run health and security checks:

```bash
bash infra/ai-stack/healthcheck-linux.sh
bash infra/ai-stack/security/security-check-linux.sh
```

## XFreedom Agent Security Gateway

The `security/` directory is the admission boundary for unknown MCP servers, skills and agent stacks.

### 1. Static preflight

```bash
node infra/ai-stack/security/audit-mcp.mjs /path/to/plugin --json
```

It flags capabilities associated with environment/credential access, shell execution, outbound networking, SSH material, browser profiles, host HOME and secret stores. The score is a heuristic triage signal, not proof that code is safe or malicious.

Risk gates are defined in `security/policy.json`. `credential_read`, `ssh_key_read`, `browser_profile_read`, `secret_store_read` and host-home access are deny/high-risk capabilities by default.

### 2. Quarantine execution

Linux:

```bash
bash infra/ai-stack/security/quarantine-linux.sh /path/to/plugin npm test
```

Windows / Docker Desktop:

```powershell
.\infra\ai-stack\security\quarantine-windows.ps1 C:\path\to\plugin npm test
```

The default quarantine uses a read-only bind mount, `--network none`, no Linux capabilities, `no-new-privileges`, no host HOME, isolated `/tmp`, and CPU/RAM/PID limits. Use `XF_SANDBOX_IMAGE` when the plugin needs a runtime other than Node 22 Alpine.

Do not pass real API keys or mount `%USERPROFILE%`, `$HOME`, browser profiles, `.ssh`, cloud credential directories or production `.env` files into quarantine.

### 3. Promotion

A plugin leaves quarantine only after source review, declared-capability review, a clean/understood static report and a runtime test. Give each promoted integration the minimum filesystem, network and OAuth scopes it needs; do not share one privileged token across unrelated MCP servers.

### 4. OpenClaw relay hardening

`security-check-*` runs `openclaw doctor` and fails when `browser.extensionRelay.allowLegacyAuth=true` is reported. Update paired Chrome/extensions or CDP clients to Browser Relay Authentication v2 before disabling legacy auth. The check also warns when ports `18789` or `8402` listen on a non-loopback address.

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
- `security/audit-mcp.mjs` — static capability/risk preflight.
- `security/policy.json` — default deny/review/high policy.
- `security/quarantine-*.{sh,ps1}` — no-network read-only quarantine runners.
- `security/security-check-*.{sh,ps1}` — relay-auth and listener-exposure checks.
- `stack.env.example` — non-secret defaults only.
