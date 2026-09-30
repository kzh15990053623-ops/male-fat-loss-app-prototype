import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const SKIP_DIRECTORIES = new Set(["node_modules", "test-results", "playwright-report", "docs", "supabase", ".git", "data", ".trae-cn"]);
const ROOT_FILES = ["server.mjs", "sw.js", "vitest.config.mjs", "playwright.config.mjs", "eslint.config.mjs"];
const SCAN_DIRECTORIES = ["src", "server", "scripts", "tests"];

async function collectJsFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      files.push(...(await collectJsFiles(path)));
    } else if (entry.isFile() && /\.(js|mjs)$/.test(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

function run(command, args, { cwd = root } = {}) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("error", (error) => resolve({ ok: false, output: String(error), ms: Date.now() - startedAt }));
    child.on("close", (code) => resolve({ ok: code === 0, output, ms: Date.now() - startedAt }));
  });
}

async function runPool(tasks, limit = 8) {
  // Results stay index-aligned with the task list even when tasks finish out
  // of order, so failure details always name the right file.
  const results = new Array(tasks.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (nextIndex < tasks.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await tasks[index]();
    }
  });
  await Promise.all(workers);
  return results;
}

function report(label, results, renderDetail) {
  const failures = results.filter((result) => !result.ok);
  const seconds = (results.reduce((total, result) => total + result.ms, 0) / 1000).toFixed(1);
  console.log(`${failures.length === 0 ? "PASS" : "FAIL"}  ${label} (${results.length} 项, 累计 ${seconds}s)`);
  for (const failure of failures) {
    console.error(`\n── ${renderDetail(failure)} 失败 ──`);
    console.error(failure.output.trim().split("\n").slice(-20).join("\n") || "(无输出)");
  }
  return failures.length === 0;
}

const stages = [];

// 阶段 A：语法检查（目录自动发现，新增文件无需登记）
const syntaxFiles = [
  ...(await Promise.all(SCAN_DIRECTORIES.map((directory) => collectJsFiles(join(root, directory))))).flat(),
  ...ROOT_FILES.map((file) => join(root, file)),
].map((path) => relative(root, path));
const syntaxResults = await runPool(syntaxFiles.map((file) => () => run(process.execPath, ["--check", file])));
stages.push([
  "语法检查 node --check",
  report(
    "语法检查 node --check",
    syntaxResults.map((r, i) => ({ ...r, file: syntaxFiles[i] })),
    (failure) => failure.file,
  ),
]);

// 阶段 B：静态校验脚本（互相独立，并行）
const validateScripts = [
  "validate-data-model.mjs",
  "validate-auth-readiness.mjs",
  "validate-local-auth.mjs",
  "validate-nutrition-contract.mjs",
  "validate-version-sync.mjs",
  "validate-frontend-manifest.mjs",
];
const validateResults = await runPool(validateScripts.map((script) => () => run(process.execPath, [join("scripts", script)])));
stages.push([
  "静态校验 validate-*",
  report(
    "静态校验 validate-*",
    validateResults.map((r, i) => ({ ...r, script: validateScripts[i] })),
    (failure) => failure.script,
  ),
]);

// 阶段 C：单测 + lint + 格式（只读操作，并行）
const vitestPath = join("node_modules", "vitest", "vitest.mjs");
const eslintPath = join("node_modules", "eslint", "bin", "eslint.js");
const prettierPath = join("node_modules", "prettier", "bin", "prettier.cjs");
const [vitestResult, eslintResult, prettierResult] = await Promise.all([
  run(process.execPath, [vitestPath, "run", "--coverage"]),
  run(process.execPath, [eslintPath, "."]),
  run(process.execPath, [prettierPath, "--check", "."]),
]);
stages.push(["vitest + coverage", report("vitest + coverage", [vitestResult], () => "vitest run --coverage")]);
stages.push(["eslint", report("eslint", [eslintResult], () => "eslint .")]);
stages.push(["prettier", report("prettier", [prettierResult], () => "prettier --check .")]);

// 阶段 D：应用回归门禁（自带本地服务器，串行收尾）
const regressionResult = await run(process.execPath, [join("scripts", "app-regression-checks.mjs")]);
stages.push(["应用回归门禁", report("应用回归门禁", [regressionResult], () => "app-regression-checks.mjs")]);

console.log("");
const failed = stages.filter(([, ok]) => !ok).map(([name]) => name);
if (failed.length) {
  console.error(`✖ 门禁未通过：${failed.join("、")}`);
  process.exit(1);
}
console.log(
  `✔ 全部门禁通过（语法 ${syntaxFiles.length} 文件 / 校验 ${validateScripts.length} 项 / vitest+coverage / eslint / prettier / 回归门禁）`,
);
