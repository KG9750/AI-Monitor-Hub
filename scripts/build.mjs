import { copyFile, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const distDir = join(rootDir, "dist");
const files = ["index.html", "styles.css", "app.js", "README.md"];

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

for (const file of files) {
  await copyFile(join(rootDir, file), join(distDir, file));
}

console.log(`Built ${files.length} files into ${distDir}`);
