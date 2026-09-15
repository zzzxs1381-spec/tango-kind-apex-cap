#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const policyPath = path.join(here, 'policy.json');
const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
const rules = policy.rules.map((r) => ({ ...r, re: new RegExp(r.pattern, 'i') }));
const ignoredDirs = new Set(['.git', 'node_modules', '.venv', 'venv', 'dist', 'build', '.next']);
const ignoredExt = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.gz', '.7z', '.woff', '.woff2']);
const maxFileBytes = Number(process.env.XF_AUDIT_MAX_FILE_BYTES || 2 * 1024 * 1024);

function usage() {
  console.log('Usage: node audit-mcp.mjs <path> [--json] [--fail-on review|high|critical]');
  console.log('       node audit-mcp.mjs --self-test');
}

function classify(score) {
  if (score >= policy.thresholds.critical) return 'critical';
  if (score >= policy.thresholds.high) return 'high';
  if (score >= policy.thresholds.review) return 'review';
  return 'low';
}

function thresholdFor(level) {
  if (level === 'critical') return policy.thresholds.critical;
  if (level === 'high') return policy.thresholds.high;
  return policy.thresholds.review;
}

function scanText(text, file) {
  const findings = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    for (const rule of rules) {
      if (rule.re.test(lines[i])) {
        findings.push({ file, line: i + 1, rule: rule.id, capability: rule.capability, score: rule.score });
      }
    }
  }
  return findings;
}

function walk(root) {
  const files = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    const st = fs.lstatSync(current);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) {
      for (const name of fs.readdirSync(current)) {
        if (ignoredDirs.has(name)) continue;
        stack.push(path.join(current, name));
      }
      continue;
    }
    if (!st.isFile() || st.size > maxFileBytes || ignoredExt.has(path.extname(current).toLowerCase())) continue;
    files.push(current);
  }
  return files;
}

function audit(target) {
  const root = path.resolve(target);
  if (!fs.existsSync(root)) throw new Error(`Path not found: ${root}`);
  const files = fs.statSync(root).isDirectory() ? walk(root) : [root];
  const findings = [];
  for (const file of files) {
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    if (text.includes('\u0000')) continue;
    findings.push(...scanText(text, path.relative(root, file) || path.basename(file)));
  }
  const score = findings.reduce((sum, f) => sum + f.score, 0);
  const capabilities = [...new Set(findings.map((f) => f.capability))].sort();
  return { target: root, filesScanned: files.length, score, risk: classify(score), capabilities, findings };
}

function selfTest() {
  const safe = scanText('export const add = (a,b) => a+b;', 'safe.js');
  const risky = scanText("const cp=require('child_process'); const h=process.env.HOME;", 'risky.js');
  if (safe.length !== 0) throw new Error('self-test: safe sample produced findings');
  if (!risky.some((x) => x.rule === 'shell-exec') || !risky.some((x) => x.rule === 'env-access')) {
    throw new Error('self-test: risky sample was not detected');
  }
  console.log('audit-mcp self-test: OK');
}

const args = process.argv.slice(2);
if (args.includes('--self-test')) {
  selfTest();
  process.exit(0);
}
if (!args.length || args[0].startsWith('-')) {
  usage();
  process.exit(64);
}
const target = args[0];
const json = args.includes('--json');
const failIndex = args.indexOf('--fail-on');
const failOn = failIndex >= 0 ? args[failIndex + 1] : 'review';
if (!['review', 'high', 'critical'].includes(failOn)) throw new Error(`Invalid --fail-on: ${failOn}`);

const report = audit(target);
if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`XFreedom MCP audit: ${report.risk.toUpperCase()} (${report.score})`);
  console.log(`Files: ${report.filesScanned}; capabilities: ${report.capabilities.join(', ') || 'none detected'}`);
  for (const f of report.findings) console.log(`- ${f.file}:${f.line} ${f.rule} -> ${f.capability} (+${f.score})`);
  if (report.findings.length) console.log('Heuristic result only: review source and runtime behavior before trust.');
}
process.exit(report.score >= thresholdFor(failOn) ? 2 : 0);
