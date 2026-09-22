import assert from "node:assert/strict";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { commonEnvironment, hermesConfig, openClawConfig } from "./link.mjs";
import {
  assertLocalProvider,
  buildChildEnv,
  getConfig,
  resolveWorkspace,
  runGoose,
} from "./server.mjs";

const serverPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "server.mjs");

async function fakeGoose(directory) {
  const fakeRunModule = path.join(directory, "run");
  await writeFile(
    fakeRunModule,
    [
      "const report = () => {",
      '  console.log(`cwd=${process.cwd()}`);',
      '  console.log(`args=${process.argv.slice(2).join(" ")}`);',
      '  console.log(`provider=${process.env.GOOSE_PROVIDER}`);',
      "};",
      'setTimeout(report, process.argv.join(" ").includes("SLOW_TEST") ? 250 : 0);',
    ].join("\n"),
    "utf8",
  );
  return process.execPath;
}

test("child environment excludes controller secrets", () => {
  const source = {
    PATH: "/usr/bin",
    HOME: "/tmp/home",
    OPENAI_API_KEY: "secret",
    TELEGRAM_BOT_TOKEN: "secret",
    GOOSE_PROVIDER: "ollama",
    GOOSE_MODEL: "qwen3:8b",
  };
  const child = buildChildEnv(source, getConfig(source));
  assert.equal(child.PATH, "/usr/bin");
  assert.equal(child.GOOSE_PROVIDER, "ollama");
  assert.notEqual(child.HOME, "/tmp/home");
  assert.match(child.HOME, /\.goose-worker-state$/);
  assert.equal(child.OPENAI_API_KEY, undefined);
  assert.equal(child.TELEGRAM_BOT_TOKEN, undefined);
});

test("only the local Ollama provider is accepted", () => {
  assert.doesNotThrow(() => assertLocalProvider({ provider: "ollama" }));
  assert.throws(() => assertLocalProvider({ provider: "openai" }), /must be "ollama"/);
});

test("state directory must be one safe name under the workspace root", () => {
  assert.throws(
    () =>
      getConfig({
        XF_GOOSE_WORKSPACE_ROOT: "/tmp/workspace",
        XF_GOOSE_STATE_DIR: "../outside",
      }),
    /one directory name/,
  );
  assert.throws(
    () =>
      getConfig({
        XF_GOOSE_WORKSPACE_ROOT: "/tmp/workspace",
        XF_GOOSE_STATE_DIR: "nested/state",
      }),
    /one directory name/,
  );
});

test("workspace root cannot grant the whole filesystem or user home", () => {
  assert.throws(
    () => getConfig({ XF_GOOSE_WORKSPACE_ROOT: path.parse(process.cwd()).root }),
    /cannot be a filesystem root/,
  );
  assert.throws(
    () => getConfig({ XF_GOOSE_WORKSPACE_ROOT: os.homedir() }),
    /cannot be a filesystem root/,
  );
});

test("workspace resolution blocks traversal and symlink escapes", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "goose-worker-"));
  const root = path.join(temp, "root");
  const inside = path.join(root, "inside");
  const outside = path.join(temp, "outside");
  await mkdir(inside, { recursive: true });
  await mkdir(outside, { recursive: true });
  await symlink(outside, path.join(root, "escape"), "dir");

  assert.equal(await resolveWorkspace(root, "inside"), inside);
  await assert.rejects(resolveWorkspace(root, "../outside"), /escapes/);
  await assert.rejects(resolveWorkspace(root, "escape"), /escapes/);
  await assert.rejects(resolveWorkspace(root, outside), /must be relative/);
});

test("state directory symlinks cannot escape the workspace root", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "goose-state-"));
  const workspaceRoot = path.join(temp, "workspace");
  const outside = path.join(temp, "outside");
  await mkdir(workspaceRoot);
  await mkdir(outside);
  const stateDir = path.join(workspaceRoot, ".goose-worker-state");
  await symlink(outside, stateDir, "dir");

  const config = {
    workspaceRoot,
    stateDir,
    gooseCommand: "goose",
    containerId: null,
    provider: "ollama",
    model: "qwen3:8b",
    ollamaHost: "http://127.0.0.1:11434",
    maxTurns: 12,
    timeoutSeconds: 30,
    maxOutputBytes: 64 * 1024,
    maxTaskChars: 1000,
  };
  await assert.rejects(runGoose({ task: "Do nothing." }, config), /resolves outside/);
});

test("runGoose invokes a direct, bounded local process", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "goose-run-"));
  const workspaceRoot = path.join(temp, "workspace");
  await mkdir(workspaceRoot);
  const gooseCommand = await fakeGoose(workspaceRoot);
  const config = {
    workspaceRoot,
    stateDir: path.join(workspaceRoot, ".goose-worker-state"),
    gooseCommand,
    containerId: null,
    provider: "ollama",
    model: "qwen3:8b",
    ollamaHost: "http://127.0.0.1:11434",
    maxTurns: 12,
    timeoutSeconds: 30,
    maxOutputBytes: 64 * 1024,
    maxTaskChars: 1000,
  };

  const result = await runGoose({ task: "Create the file safely." }, config);
  assert.equal(result.ok, true);
  assert.match(result.stdout, /provider=ollama/);
  assert.match(result.stdout, /--no-session --with-builtin developer/);
  assert.match(result.stdout, /Create the file safely\./);
});

test("shared state lock prevents simultaneous controller runs", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "goose-lock-"));
  const workspaceRoot = path.join(temp, "workspace");
  await mkdir(workspaceRoot);
  const gooseCommand = await fakeGoose(workspaceRoot);
  const config = {
    workspaceRoot,
    stateDir: path.join(workspaceRoot, ".goose-worker-state"),
    gooseCommand,
    containerId: null,
    provider: "ollama",
    model: "qwen3:8b",
    ollamaHost: "http://127.0.0.1:11434",
    maxTurns: 12,
    timeoutSeconds: 30,
    maxOutputBytes: 64 * 1024,
    maxTaskChars: 1000,
  };

  const first = runGoose({ task: "SLOW_TEST" }, config);
  await new Promise((resolve) => setTimeout(resolve, 50));
  await assert.rejects(
    runGoose({ task: "Second controller task." }, config),
    /already running across OpenClaw or Hermes/,
  );
  assert.equal((await first).ok, true);
});

test("controller configs require approval and disable parallel Goose tasks", () => {
  const workspace = path.resolve("/tmp/xfreedom-workspace");
  const shared = commonEnvironment(workspace, {});
  const openclaw = openClawConfig(workspace, {});
  const hermes = hermesConfig(workspace, {});

  assert.equal(shared.GOOSE_PROVIDER, "ollama");
  assert.equal(shared.XF_GOOSE_STATE_DIR, ".goose-worker-state");
  assert.equal(openclaw.supportsParallelToolCalls, false);
  assert.equal(openclaw.codex.defaultToolsApprovalMode, "prompt");
  assert.equal(hermes.trust, "untrusted");
  assert.equal(hermes.supports_parallel_tool_calls, false);
  assert.deepEqual(hermes.tools.include, ["goose_health", "goose_run"]);
  assert.equal(hermes.tools.resources, false);
  assert.equal(hermes.tools.prompts, false);

  const clamped = commonEnvironment(workspace, {
    XF_GOOSE_TIMEOUT_SECONDS: "not-a-number",
    GOOSE_MAX_TURNS: "9999",
  });
  assert.equal(clamped.XF_GOOSE_TIMEOUT_SECONDS, "900");
  assert.equal(clamped.GOOSE_MAX_TURNS, "200");
});

test("MCP server advertises only the health and run tools", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "goose-mcp-"));
  const workspaceRoot = path.join(temp, "workspace");
  await mkdir(workspaceRoot);
  const gooseCommand = await fakeGoose(workspaceRoot);

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    env: {
      ...process.env,
      XF_GOOSE_COMMAND: gooseCommand,
      XF_GOOSE_WORKSPACE_ROOT: workspaceRoot,
      GOOSE_PROVIDER: "ollama",
      GOOSE_MODEL: "qwen3:8b",
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "goose-worker-test", version: "1.0.0" });

  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.deepEqual(
      tools.tools.map((tool) => tool.name).sort(),
      ["goose_health", "goose_run"],
    );
    const runTool = tools.tools.find((tool) => tool.name === "goose_run");
    assert.equal(runTool.annotations.readOnlyHint, false);
    assert.equal(runTool.annotations.destructiveHint, true);
    assert.equal(runTool.annotations.openWorldHint, true);
    const result = await client.callTool({
      name: "goose_run",
      arguments: { task: "Report the current directory." },
    });
    assert.notEqual(result.isError, true);
    assert.match(result.content[0].text, /status: ok/);
  } finally {
    await client.close();
  }
});
