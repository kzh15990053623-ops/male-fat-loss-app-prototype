import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
export const root = fileURLToPath(new URL("..", import.meta.url));
export const PROJECT_ID = "fitness-app-integration";
export const API_PORT = "55321";
export const DB_PORT = "55322";
const CLI_VERSION = "2.108.0";

export function assertExpectedLocalUrl(value, expectedPort, label) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    throw new Error(`${label} is not a valid dedicated local URL`);
  }
  assert.equal(url.protocol, label === "database" ? "postgresql:" : "http:", `${label} must use a local-only protocol`);
  assert.ok(new Set(["127.0.0.1", "localhost", "[::1]"]).has(url.hostname), `${label} must use loopback`);
  assert.equal(url.port, expectedPort, `${label} must use the dedicated integration-test port ${expectedPort}`);
  return url;
}

export function parseStatusJson(stdout) {
  const text = String(stdout || "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Supabase CLI did not return local status JSON");
  return JSON.parse(text.slice(start, end + 1));
}

export async function assertDedicatedProject() {
  const config = await readFile(new URL("../supabase/config.toml", import.meta.url), "utf8");
  assert.match(config, /^project_id\s*=\s*"fitness-app-integration"\s*$/m, "Unexpected local test project identity");
}

export async function runLocalSupabaseCli(args) {
  await assertDedicatedProject();
  // npm supplies the JS entry point, avoiding .cmd execution and shell quoting
  // on Windows. This also uses the same Node runtime as the invoking npm run.
  assert.ok(process.env.npm_execpath, "Run this command through npm run, not directly with node");
  return execFileAsync(
    process.execPath,
    [process.env.npm_execpath, "exec", "--yes", `--package=supabase@${CLI_VERSION}`, "--", "supabase", ...args],
    {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      timeout: 15 * 60 * 1000,
      windowsHide: true,
    },
  );
}

export async function localSupabaseStatus() {
  const { stdout } = await runLocalSupabaseCli(["status", "--output", "json"]);
  const status = parseStatusJson(stdout);
  assertExpectedLocalUrl(status.API_URL, API_PORT, "API");
  assertExpectedLocalUrl(status.DB_URL, DB_PORT, "database");
  return status;
}

export async function assertDockerReady() {
  try {
    await execFileAsync("docker", ["info", "--format", "{{.ServerVersion}}"], { timeout: 15000, windowsHide: true });
  } catch {
    throw new Error("NOT RUN: Docker is missing or its daemon is unavailable. No database was started or changed.");
  }
}
