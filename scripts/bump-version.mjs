import { readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));

// 应用壳版本戳在五处：index.html 三处 ?v=、sw.js 两处 ?v=、sw.js CACHE_NAME。
// 本脚本一次性写入全部位置并自校验，替代"改三处 + 祈祷"的手工流程。
const explicitVersion = process.argv.includes("--shell") ? process.argv[process.argv.indexOf("--shell") + 1] : null;

const [html, serviceWorker] = await Promise.all([readFile(join(root, "index.html"), "utf8"), readFile(join(root, "sw.js"), "utf8")]);

const currentVersion = html.match(/\?v=([0-9a-zA-Z-]+)/)?.[1] || "";
const currentCacheGeneration = Number(serviceWorker.match(/CACHE_NAME = "fitness-fat-loss-app-shell-v(\d+)"/)?.[1] || 0);

function defaultNextVersion() {
  const now = new Date();
  const today = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  // The suffix is only a counter when it is purely numeric: a custom tag like
  // "20260829-beta" must not increment into "20260829-NaN".
  const sameDay = currentVersion.startsWith(`${today}-`);
  const dayCounter = sameDay ? Number(currentVersion.split("-")[1]) : NaN;
  const dayIndex = Number.isInteger(dayCounter) && dayCounter >= 0 ? dayCounter + 1 : 1;
  return `${today}-${dayIndex}`;
}

const nextVersion = explicitVersion || defaultNextVersion();
const nextCacheGeneration = currentCacheGeneration + 1;
if (!/^[0-9a-zA-Z-]+$/.test(nextVersion)) {
  console.error(`非法版本号：${nextVersion}`);
  process.exit(1);
}

const updatedHtml = html.replace(/\?v=[0-9a-zA-Z-]+/g, `?v=${nextVersion}`);
const updatedServiceWorker = serviceWorker
  .replace(/\?v=[0-9a-zA-Z-]+/g, `?v=${nextVersion}`)
  .replace(/CACHE_NAME = "fitness-fat-loss-app-shell-v\d+"/, `CACHE_NAME = "fitness-fat-loss-app-shell-v${nextCacheGeneration}"`);

await writeFile(join(root, "index.html"), updatedHtml, "utf8");
await writeFile(join(root, "sw.js"), updatedServiceWorker, "utf8");

console.log(`应用壳版本：${currentVersion || "(无)"} → ${nextVersion}`);
console.log(`SW 缓存代号：v${currentCacheGeneration} → v${nextCacheGeneration}`);

const validate = spawn(process.execPath, [join("scripts", "validate-version-sync.mjs")], { cwd: root, stdio: "inherit" });
validate.on("close", (code) => {
  if (code !== 0) {
    console.error("写入后校验失败，请检查 index.html 与 sw.js 的版本戳");
    process.exit(1);
  }
  console.log("版本写入完成并已通过 validate-version-sync 校验");
});
