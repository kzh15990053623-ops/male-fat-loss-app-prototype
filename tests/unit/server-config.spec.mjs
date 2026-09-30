import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const temporaryDirectories = [];

async function readIsolatedConfig({ dotEnv, externalPort } = {}) {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "fitness-config-test-"));
  temporaryDirectories.push(temporaryRoot);

  const temporaryServerDirectory = join(temporaryRoot, "server");
  await mkdir(temporaryServerDirectory);
  await Promise.all(
    ["config.mjs", "env.mjs"].map((fileName) => copyFile(join(projectRoot, "server", fileName), join(temporaryServerDirectory, fileName))),
  );
  if (dotEnv !== undefined) await writeFile(join(temporaryRoot, ".env"), dotEnv, "utf8");

  const childEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== "PORT"));
  if (externalPort !== undefined) childEnv.PORT = String(externalPort);

  const configUrl = pathToFileURL(join(temporaryServerDirectory, "config.mjs")).href;
  const script = `
    const config = await import(${JSON.stringify(configUrl)});
    process.stdout.write(JSON.stringify({ port: config.port, root: config.root }));
  `;
  const { stdout } = await execFileAsync(process.execPath, ["--input-type=module", "--eval", script], {
    cwd: dirname(temporaryRoot),
    env: childEnv,
  });
  return JSON.parse(stdout);
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("服务端端口配置", () => {
  it("外部未设置 PORT 时消费临时项目 .env 中的端口", async () => {
    const config = await readIsolatedConfig({ dotEnv: "PORT=8123\n" });
    expect(config.port).toBe(8123);
  });

  it("外部 PORT 优先于临时项目 .env", async () => {
    const config = await readIsolatedConfig({ dotEnv: "PORT=8123\n", externalPort: 9000 });
    expect(config.port).toBe(9000);
  });

  it("没有任何 PORT 配置时使用 5173", async () => {
    const config = await readIsolatedConfig();
    expect(config.port).toBe(5173);
  });
});
