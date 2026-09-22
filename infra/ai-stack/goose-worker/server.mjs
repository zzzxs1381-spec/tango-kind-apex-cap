#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, open, readFile, realpath, stat, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";

const DEFAULT_TIMEOUT_SECONDS = 900;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_MAX_TASK_CHARS = 20_000;
const HARD_MAX_TIMEOUT_SECONDS = 3600;

const SAFE_PARENT_ENV = new Set([
  "PATH",
  "Path",
  "SystemRoot",
  "SYSTEMROOT",
  "windir",
  "WINDIR",
  "COMSPEC",
  "PATHEXT",
  "TMP",
  "TEMP",
  "TMPDIR",
  "LANG",
  "LANGUAGE",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "COLORTERM",
  "NO_COLOR",
  "SHELL",
  "USER",
  "USERNAME",
]);

function integerFromEnv(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function getConfig(env = process.env) {
  const workspaceRoot = path.resolve(
    env.XF_GOOSE_WORKSPACE_ROOT || path.join(os.homedir(), "xfreedom-agent-workspace"),
  );
  if (workspaceRoot === path.parse(workspaceRoot).root || workspaceRoot === path.resolve(os.homedir())) {
    throw new Error("XF_GOOSE_WORKSPACE_ROOT cannot be a filesystem root or the entire user home.");
  }
  const stateDirName = env.XF_GOOSE_STATE_DIR || ".goose-worker-state";
  if (
    stateDirName === "." ||
    stateDirName === ".." ||
    !/^[A-Za-z0-9._-]{1,128}$/.test(stateDirName)
  ) {
    throw new Error("XF_GOOSE_STATE_DIR must be one directory name inside the workspace root.");
  }
  const stateDir = path.join(workspaceRoot, stateDirName);

  return {
    workspaceRoot,
    stateDir,
    gooseCommand: env.XF_GOOSE_COMMAND || "goose",
    containerId: env.XF_GOOSE_CONTAINER || null,
    provider: env.GOOSE_PROVIDER || "ollama",
    model: env.GOOSE_MODEL || "qwen3:8b",
    ollamaHost: env.OLLAMA_HOST || "http://127.0.0.1:11434",
    maxTurns: integerFromEnv(env.GOOSE_MAX_TURNS, 50, { min: 1, max: 200 }),
    timeoutSeconds: integerFromEnv(env.XF_GOOSE_TIMEOUT_SECONDS, DEFAULT_TIMEOUT_SECONDS, {
      min: 30,
      max: HARD_MAX_TIMEOUT_SECONDS,
    }),
    maxOutputBytes: integerFromEnv(env.XF_GOOSE_MAX_OUTPUT_BYTES, DEFAULT_MAX_OUTPUT_BYTES, {
      min: 4096,
      max: 10 * 1024 * 1024,
    }),
    maxTaskChars: integerFromEnv(env.XF_GOOSE_MAX_TASK_CHARS, DEFAULT_MAX_TASK_CHARS, {
      min: 100,
      max: 100_000,
    }),
  };
}

export function assertLocalProvider(config) {
  if (config.provider !== "ollama") {
    throw new Error(
      `GOOSE_PROVIDER must be "ollama" for the bounded local worker; received "${config.provider}".`,
    );
  }
}

export function buildChildEnv(sourceEnv = process.env, config = getConfig(sourceEnv)) {
  const childEnv = {};

  for (const name of SAFE_PARENT_ENV) {
    if (sourceEnv[name] !== undefined) childEnv[name] = sourceEnv[name];
  }

  const stateDir = config.stateDir || path.join(config.workspaceRoot, ".goose-worker-state");
  return {
    ...childEnv,
    HOME: stateDir,
    USERPROFILE: stateDir,
    APPDATA: path.join(stateDir, "config"),
    LOCALAPPDATA: path.join(stateDir, "data"),
    XDG_CONFIG_HOME: path.join(stateDir, "config"),
    XDG_DATA_HOME: path.join(stateDir, "data"),
    XDG_CACHE_HOME: path.join(stateDir, "cache"),
    TEMP: path.join(stateDir, "tmp"),
    TMP: path.join(stateDir, "tmp"),
    TMPDIR: path.join(stateDir, "tmp"),
    GOOSE_PROVIDER: "ollama",
    GOOSE_MODEL: config.model,
    GOOSE_MODE: "auto",
    GOOSE_MAX_TURNS: String(config.maxTurns),
    GOOSE_CONTEXT_STRATEGY: "summarize",
    GOOSE_DISABLE_SESSION_NAMING: "true",
    OLLAMA_HOST: config.ollamaHost,
  };
}

function pathEscapes(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

async function prepareStateDirectory(config) {
  const resolvedRoot = path.resolve(config.workspaceRoot);
  const resolvedState = path.resolve(config.stateDir);
  if (path.dirname(resolvedState) !== resolvedRoot) {
    throw new Error("XF_GOOSE_STATE_DIR must be a direct child of XF_GOOSE_WORKSPACE_ROOT.");
  }

  const canonicalRoot = await realpath(resolvedRoot);
  const canonicalTarget = path.join(canonicalRoot, path.basename(resolvedState));
  let canonicalState;
  try {
    canonicalState = await realpath(canonicalTarget);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    try {
      await mkdir(canonicalTarget, { recursive: false, mode: 0o700 });
    } catch (mkdirError) {
      if (mkdirError.code !== "EEXIST") throw mkdirError;
    }
    canonicalState = await realpath(canonicalTarget);
  }
  if (pathEscapes(canonicalRoot, canonicalState)) {
    throw new Error("XF_GOOSE_STATE_DIR resolves outside XF_GOOSE_WORKSPACE_ROOT.");
  }
  await Promise.all(
    ["config", "data", "cache", "tmp"].map((name) =>
      mkdir(path.join(canonicalState, name), { recursive: true, mode: 0o700 }),
    ),
  );
  return canonicalState;
}

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}

async function acquireRunLock(stateDir) {
  const lockPath = path.join(stateDir, "run.lock");
  const staleAfterMs = (HARD_MAX_TIMEOUT_SECONDS + 120) * 1000;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      await handle.writeFile(
        JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
        "utf8",
      );
      return async () => {
        await handle.close().catch(() => {});
        await unlink(lockPath).catch((error) => {
          if (error.code !== "ENOENT") throw error;
        });
      };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;

      let lockStat;
      let owner = null;
      try {
        [lockStat, owner] = await Promise.all([
          stat(lockPath),
          readFile(lockPath, "utf8").then((body) => JSON.parse(body)).catch(() => null),
        ]);
      } catch (inspectError) {
        if (inspectError.code === "ENOENT") continue;
        throw inspectError;
      }

      const stale = Date.now() - lockStat.mtimeMs > staleAfterMs;
      if (!stale && (owner === null || processIsAlive(owner.pid))) {
        throw new Error("Another Goose task is already running across OpenClaw or Hermes.");
      }
      await unlink(lockPath).catch((unlinkError) => {
        if (unlinkError.code !== "ENOENT") throw unlinkError;
      });
    }
  }

  throw new Error("Could not acquire the shared Goose task lock.");
}

export async function resolveWorkspace(workspaceRoot, requestedWorkspace = ".") {
  if (typeof requestedWorkspace !== "string" || requestedWorkspace.includes("\0")) {
    throw new Error("workspace must be a valid relative path.");
  }
  if (path.isAbsolute(requestedWorkspace)) {
    throw new Error("workspace must be relative to XF_GOOSE_WORKSPACE_ROOT.");
  }

  const canonicalRoot = await realpath(workspaceRoot);
  const candidate = path.resolve(canonicalRoot, requestedWorkspace || ".");
  const canonicalCandidate = await realpath(candidate);
  const relative = path.relative(canonicalRoot, canonicalCandidate);

  if (pathEscapes(canonicalRoot, canonicalCandidate)) {
    throw new Error("workspace escapes XF_GOOSE_WORKSPACE_ROOT.");
  }

  const candidateStat = await stat(canonicalCandidate);
  if (!candidateStat.isDirectory()) throw new Error("workspace must resolve to an existing directory.");
  return canonicalCandidate;
}

function terminateChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  const forceKill = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }, 1500);
  forceKill.unref?.();
}

export function runCommand(command, args, options = {}) {
  const {
    cwd,
    env,
    timeoutMs = 10_000,
    maxOutputBytes = 64 * 1024,
  } = options;

  return new Promise((resolve) => {
    const startedAt = Date.now();
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let timedOut = false;
    let outputLimitHit = false;
    let spawnError = null;

    const child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const append = (target, chunk) => {
      const used = stdout.length + stderr.length;
      const available = Math.max(0, maxOutputBytes - used);
      const accepted = chunk.subarray(0, available);
      if (target === "stdout") stdout = Buffer.concat([stdout, accepted]);
      else stderr = Buffer.concat([stderr, accepted]);

      if (accepted.length < chunk.length) {
        outputLimitHit = true;
        terminateChild(child);
      }
    };

    child.stdout.on("data", (chunk) => append("stdout", chunk));
    child.stderr.on("data", (chunk) => append("stderr", chunk));
    child.on("error", (error) => {
      spawnError = error;
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      terminateChild(child);
    }, timeoutMs);
    timeout.unref?.();

    child.on("close", (exitCode, signal) => {
      clearTimeout(timeout);
      resolve({
        exitCode,
        signal,
        stdout: stdout.toString("utf8"),
        stderr: stderr.toString("utf8"),
        timedOut,
        outputLimitHit,
        durationMs: Date.now() - startedAt,
        spawnError: spawnError?.message || null,
      });
    });
  });
}

export async function runGoose({ task, workspace = ".", timeoutSeconds }, config = getConfig()) {
  assertLocalProvider(config);

  const normalizedTask = task?.trim();
  if (!normalizedTask) throw new Error("task must not be empty.");
  if (normalizedTask.length > config.maxTaskChars) {
    throw new Error(`task exceeds the ${config.maxTaskChars}-character limit.`);
  }

  if (config.containerId && !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(config.containerId)) {
    throw new Error("XF_GOOSE_CONTAINER contains an invalid container name or ID.");
  }

  const stateDir = await prepareStateDirectory(config);
  const runtimeConfig = { ...config, stateDir };
  const cwd = await resolveWorkspace(config.workspaceRoot, workspace);
  const effectiveTimeout = Math.min(
    config.timeoutSeconds,
    integerFromEnv(timeoutSeconds, config.timeoutSeconds, {
      min: 30,
      max: HARD_MAX_TIMEOUT_SECONDS,
    }),
  );

  const taskWithBoundary = [
    "XFreedom worker boundary: operate only inside the current working directory and its descendants. Do not read or modify parent directories, absolute paths outside it, controller configuration, credentials, or secret stores.",
    "",
    normalizedTask,
  ].join("\n");
  const gooseArgs = ["run", "--no-session"];
  if (config.containerId) gooseArgs.push("--container", config.containerId);
  gooseArgs.push("--with-builtin", "developer", "-t", taskWithBoundary);

  const releaseLock = await acquireRunLock(stateDir);
  try {
    const result = await runCommand(config.gooseCommand, gooseArgs, {
      cwd,
      env: buildChildEnv(process.env, runtimeConfig),
      timeoutMs: effectiveTimeout * 1000,
      maxOutputBytes: config.maxOutputBytes,
    });

    return {
      ok:
        result.exitCode === 0 &&
        !result.timedOut &&
        !result.outputLimitHit &&
        !result.spawnError,
      workspace: path.relative(config.workspaceRoot, cwd) || ".",
      provider: config.provider,
      model: config.model,
      container: config.containerId,
      ...result,
    };
  } finally {
    await releaseLock();
  }
}

async function probeOllama(config) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  timer.unref?.();

  try {
    const endpoint = new URL("/api/tags", config.ollamaHost);
    const response = await fetch(endpoint, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    const models = Array.isArray(body.models)
      ? body.models.map((entry) => entry?.name).filter(Boolean)
      : [];
    const modelReady = models.some(
      (name) => name === config.model || name === `${config.model}:latest`,
    );
    return { ok: true, endpoint: endpoint.origin, models, modelReady };
  } catch (error) {
    return { ok: false, endpoint: config.ollamaHost, error: error.message, models: [], modelReady: false };
  } finally {
    clearTimeout(timer);
  }
}

export async function checkHealth(config = getConfig()) {
  assertLocalProvider(config);
  const stateDir = await prepareStateDirectory(config);
  const childEnv = buildChildEnv(process.env, { ...config, stateDir });
  const [gooseVersion, ollama] = await Promise.all([
    runCommand(config.gooseCommand, ["--version"], {
      cwd: config.workspaceRoot,
      env: childEnv,
      timeoutMs: 10_000,
      maxOutputBytes: 64 * 1024,
    }),
    probeOllama(config),
  ]);

  const gooseReady = gooseVersion.exitCode === 0 && !gooseVersion.spawnError;
  return {
    ok: gooseReady && ollama.ok && ollama.modelReady,
    workspaceRoot: config.workspaceRoot,
    provider: config.provider,
    model: config.model,
    container: config.containerId,
    goose: {
      ok: gooseReady,
      version: gooseVersion.stdout.trim() || gooseVersion.stderr.trim() || null,
      error: gooseVersion.spawnError,
    },
    ollama,
  };
}

function renderRunResult(result) {
  const lines = [
    `status: ${result.ok ? "ok" : "failed"}`,
    `workspace: ${result.workspace}`,
    `provider: ${result.provider}`,
    `model: ${result.model}`,
    `container: ${result.container ?? "host-user"}`,
    `exit_code: ${result.exitCode ?? "none"}`,
    `signal: ${result.signal ?? "none"}`,
    `timed_out: ${result.timedOut}`,
    `output_limit_hit: ${result.outputLimitHit}`,
    `duration_ms: ${result.durationMs}`,
  ];

  if (result.spawnError) lines.push(`spawn_error: ${result.spawnError}`);
  if (result.stdout.trim()) lines.push("", "stdout:", result.stdout.trimEnd());
  if (result.stderr.trim()) lines.push("", "stderr:", result.stderr.trimEnd());
  return lines.join("\n");
}

export function createServer(config = getConfig()) {
  const server = new McpServer({ name: "xfreedom-goose-worker", version: "1.0.0" });
  let activeRun = false;

  server.registerTool(
    "goose_health",
    {
      description:
        "Check the local Goose worker, its Ollama endpoint, configured model, and workspace root.",
      inputSchema: {},
      annotations: {
        title: "Check Goose worker",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        const health = await checkHealth(config);
        return {
          isError: !health.ok,
          content: [{ type: "text", text: JSON.stringify(health, null, 2) }],
        };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: error.message }] };
      }
    },
  );

  server.registerTool(
    "goose_run",
    {
      description:
        "Delegate one bounded implementation task to the local Goose CLI. The workspace must be relative to the configured root.",
      inputSchema: {
        task: z.string().min(1).max(config.maxTaskChars).describe("Complete task and success criteria."),
        workspace: z
          .string()
          .default(".")
          .describe("Existing relative directory under XF_GOOSE_WORKSPACE_ROOT."),
        timeout_seconds: z
          .number()
          .int()
          .min(30)
          .max(config.timeoutSeconds)
          .optional()
          .describe("Per-task timeout, capped by the server policy."),
      },
      annotations: {
        title: "Run Goose worker",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ task, workspace, timeout_seconds: timeoutSeconds }) => {
      if (activeRun) {
        return {
          isError: true,
          content: [{ type: "text", text: "A Goose task is already running in this MCP process." }],
        };
      }

      activeRun = true;
      try {
        const result = await runGoose({ task, workspace, timeoutSeconds }, config);
        return { isError: !result.ok, content: [{ type: "text", text: renderRunResult(result) }] };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: error.message }] };
      } finally {
        activeRun = false;
      }
    },
  );

  return server;
}

async function main() {
  const server = createServer();
  await server.connect(new StdioServerTransport());
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(`[xfreedom-goose-worker] ${error.stack || error.message}`);
    process.exitCode = 1;
  });
}
