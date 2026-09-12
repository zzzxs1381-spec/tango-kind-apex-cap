import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

const sourceDir = join(process.cwd(), "node_modules", ".nitro", "vite", "services", "ssr", "assets");
const targetDir = join(process.cwd(), ".output", "public", "assets");

if (!existsSync(sourceDir)) {
  console.log("[sync-ssr-styles] no Nitro SSR asset directory; nothing to sync");
  process.exit(0);
}

mkdirSync(targetDir, { recursive: true });
const styles = readdirSync(sourceDir).filter((name) => name.endsWith(".css"));

for (const name of styles) {
  copyFileSync(join(sourceDir, name), join(targetDir, name));
}

console.log(`[sync-ssr-styles] copied ${styles.length} SSR stylesheet(s) into .output/public/assets`);
