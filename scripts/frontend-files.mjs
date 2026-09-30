import { readdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));

async function collectJsFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectJsFiles(path)));
    else if (entry.isFile() && entry.name.endsWith(".js")) files.push(path);
  }

  return files;
}

export async function discoverFrontendJsFiles(root = projectRoot) {
  const files = await collectJsFiles(join(root, "src"));
  return files.map((file) => relative(root, file).replaceAll("\\", "/")).sort();
}
