import { access, copyFile, mkdir, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";

const sourceDir = join(process.cwd(), "node_modules", ".nitro", "vite", "services", "ssr", "assets");
const targetDir = join(process.cwd(), ".output", "public", "assets");

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

if (!(await exists(sourceDir))) {
  console.log(`[sync-nitro-assets] no SSR assets at ${sourceDir}; nothing to copy`);
  process.exit(0);
}

await mkdir(targetDir, { recursive: true });

let copied = 0;
for (const entry of await readdir(sourceDir, { withFileTypes: true })) {
  if (!entry.isFile()) continue;
  const source = join(sourceDir, entry.name);
  const target = join(targetDir, entry.name);
  if (await exists(target)) continue;
  await copyFile(source, target);
  copied += 1;
  console.log(`[sync-nitro-assets] copied ${entry.name}`);
}

console.log(`[sync-nitro-assets] completed; copied ${copied} missing asset(s)`);
