---
name: xfreedom-goose-worker
description: Delegate bounded implementation tasks to the local Goose worker shared by Hermes and OpenClaw.
version: 1.0.0
metadata:
  openclaw:
    requires:
      bins:
        - goose
        - node
---

# XFreedom Goose worker

Use this skill when a concrete coding, repository-inspection, or command-line task can be delegated to the local Goose worker.

## Procedure

1. Call `goose_health` when worker readiness is unknown or after a failed run.
2. State one bounded task with explicit completion checks. Include relevant filenames, constraints, and commands to run.
3. Call `goose_run` with that task and an existing workspace path relative to `XF_GOOSE_WORKSPACE_ROOT`.
4. Treat the response as a worker report, not proof of success. Inspect the resulting diff or files and independently run the relevant checks before reporting completion.

## Safety rules

- Never include credentials, tokens, cookies, private keys, or unrelated personal data in a delegated task.
- Never ask Goose to escape the configured workspace, change host security controls, expose Ollama publicly, or edit controller configuration.
- Expect approval before a write-capable `goose_run` call. Do not bypass it; one approval covers the worker's complete internal task run.
- Treat the workspace rule as behavioral unless `XF_GOOSE_CONTAINER` is configured. Without container mode, Goose's Developer extension retains the permissions of the current OS user.
- Run only one Goose task at a time; the bridge enforces this across both controllers. Split large work into independently verifiable tasks.
- If the current runtime is Goose itself, perform the requested work directly; do not recursively delegate back through this bridge.
- If `goose_health` reports that the configured model is absent, stop and ask the operator to pull or select a local Ollama model.
