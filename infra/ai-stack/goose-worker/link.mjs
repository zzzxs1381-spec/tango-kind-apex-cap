#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { cp, mkdir, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const stackDir = path.dirname(scriptDir);
const repoRoot = path.resolve(stackDir, "../..");
const skillSource = path.join(repoRoot, ".agents", "skills", "xfreedom-goose-worker");
const serverPath = path.join(scriptDir, "server.mjs");

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function has(name) {
  return process.argv.includes(name);
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function stateDirectoryName(env = process.env) {
  const name = env.XF_GOOSE_STATE_DIR || ".goose-worker-state";
  if (name === "." || name === ".." || !/^[A-Za-z0-9._-]{1,128}$/.test(name)) {
    throw new Error("XF_GOOSE_STATE_DIR must be one directory name inside the workspace root.");
  }
  return name;
}

export function commonEnvironment(workspaceRoot, env = process.env) {
  const timeoutSeconds = boundedInteger(env.XF_GOOSE_TIMEOUT_SECONDS, 900, 30, 3600);
  const values = {
    XF_GOOSE_WORKSPACE_ROOT: workspaceRoot,
    XF_GOOSE_STATE_DIR: stateDirectoryName(env),
    XF_GOOSE_TIMEOUT_SECONDS: String(timeoutSeconds),
    XF_GOOSE_MAX_OUTPUT_BYTES: String(
      boundedInteger(env.XF_GOOSE_MAX_OUTPUT_BYTES, 1_048_576, 4096, 10 * 1024 * 1024),
    ),
    XF_GOOSE_MAX_TASK_CHARS: String(
      boundedInteger(env.XF_GOOSE_MAX_TASK_CHARS, 20_000, 100, 100_000),
    ),
    GOOSE_PROVIDER: "ollama",
    GOOSE_MODEL: env.GOOSE_MODEL || "qwen3:8b",
    GOOSE_MAX_TURNS: String(boundedInteger(env.GOOSE_MAX_TURNS, 50, 1, 200)),
    OLLAMA_HOST: env.OLLAMA_HOST || "http://127.0.0.1:11434",
  };
  if (env.XF_GOOSE_CONTAINER) values.XF_GOOSE_CONTAINER = env.XF_GOOSE_CONTAINER;
  return values;
}

export function openClawConfig(workspaceRoot, env = process.env) {
  const values = commonEnvironment(workspaceRoot, env);
  return {
    transport: "stdio",
    command: process.execPath,
    args: [serverPath],
    cwd: scriptDir,
    env: values,
    enabled: true,
    connectionTimeoutMs: 15_000,
    requestTimeoutMs: Number(values.XF_GOOSE_TIMEOUT_SECONDS) * 1000 + 10_000,
    supportsParallelToolCalls: false,
    toolFilter: { include: ["goose_health", "goose_run"] },
    codex: { defaultToolsApprovalMode: "prompt" },
  };
}

export function hermesConfig(workspaceRoot, env = process.env) {
  const values = commonEnvironment(workspaceRoot, env);
  return {
    command: process.execPath,
    args: [serverPath],
    env: values,
    enabled: true,
    timeout: Number(values.XF_GOOSE_TIMEOUT_SECONDS) + 10,
    connect_timeout: 15,
    supports_parallel_tool_calls: false,
    trust: "untrusted",
    tools: {
      include: ["goose_health", "goose_run"],
      resources: false,
      prompts: false,
    },
  };
}

function run(command, args, { optional = false } = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    stdio: "inherit",
  });

  if (result.error?.code === "ENOENT" && optional) {
    console.warn(`[goose-link] ${command} is not installed; skipped.`);
    return false;
  }
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}.`);
  return true;
}

async function replaceDirectory(source, destination) {
  await rm(destination, { recursive: true, force: true });
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true });
}

function pathEscapes(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

async function ensureWorkerState(workspaceRoot) {
  const canonicalRoot = await realpath(workspaceRoot);
  const target = path.join(canonicalRoot, stateDirectoryName());
  let canonicalState;
  try {
    canonicalState = await realpath(target);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    try {
      await mkdir(target, { recursive: false, mode: 0o700 });
    } catch (mkdirError) {
      if (mkdirError.code !== "EEXIST") throw mkdirError;
    }
    canonicalState = await realpath(target);
  }
  if (pathEscapes(canonicalRoot, canonicalState)) {
    throw new Error("XF_GOOSE_STATE_DIR resolves outside XF_GOOSE_WORKSPACE_ROOT.");
  }
  return canonicalState;
}

async function installSkills(workspaceRoot) {
  const home = os.homedir();
  const agentSkill = path.join(home, ".agents", "skills", "xfreedom-goose-worker");
  const hermesHome = process.env.HERMES_HOME || path.join(home, ".hermes");
  const hermesSkill = path.join(hermesHome, "skills", "xfreedom-goose-worker");
  const workerState = await ensureWorkerState(workspaceRoot);
  const workerSkill = path.join(
    workerState,
    ".agents",
    "skills",
    "xfreedom-goose-worker",
  );
  await replaceDirectory(skillSource, agentSkill);
  await replaceDirectory(skillSource, hermesSkill);
  await replaceDirectory(skillSource, workerSkill);
  console.log(
    `[goose-link] Installed shared skill in ${agentSkill}, ${hermesSkill}, and ${workerSkill}.`,
  );
}

async function main() {
  const workspaceRoot = path.resolve(
    option("--workspace", process.env.XF_GOOSE_WORKSPACE_ROOT || path.join(os.homedir(), "xfreedom-agent-workspace")),
  );
  if (workspaceRoot === path.parse(workspaceRoot).root || workspaceRoot === path.resolve(os.homedir())) {
    throw new Error("The Goose workspace root cannot be a filesystem root or the entire user home.");
  }
  const target = option("--target", "all");
  if (!new Set(["all", "openclaw", "hermes"]).has(target)) {
    throw new Error("--target must be all, openclaw, or hermes.");
  }

  if (has("--print-config")) {
    console.log(
      JSON.stringify(
        {
          workspaceRoot,
          openclaw: openClawConfig(workspaceRoot),
          hermes: hermesConfig(workspaceRoot),
        },
        null,
        2,
      ),
    );
    return;
  }

  await mkdir(workspaceRoot, { recursive: true });
  await installSkills(workspaceRoot);

  if (target === "all" || target === "openclaw") {
    const installed = run(
      "openclaw",
      ["mcp", "set", "xfreedom-goose", JSON.stringify(openClawConfig(workspaceRoot))],
      { optional: target === "all" },
    );
    if (installed && !has("--no-probe")) {
      run("openclaw", ["mcp", "doctor", "xfreedom-goose", "--probe"]);
    }
  }

  if (target === "all" || target === "hermes") {
    const installed = run(
      "hermes",
      [
        "config",
        "set",
        "mcp_servers.xfreedom_goose",
        JSON.stringify(hermesConfig(workspaceRoot)),
        "--force",
      ],
      { optional: target === "all" },
    );
    if (installed && !has("--no-probe")) {
      run("hermes", ["mcp", "test", "xfreedom_goose"]);
    }
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(`[goose-link] ${error.stack || error.message}`);
    process.exitCode = 1;
  });
}
