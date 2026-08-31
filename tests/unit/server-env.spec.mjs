import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { applyDotEnv, loadDotEnv, parseDotEnv } from "../../server/env.mjs";

describe(".env 解析边界", () => {
  it("剥离未加引号值的行内注释并保留引号内的 #", () => {
    expect(
      parseDotEnv(`
        PLAIN=value # comment
        HASH=value#keep
        DOUBLE="value # keep"
        SINGLE='single # keep'
      `),
    ).toEqual({ PLAIN: "value", HASH: "value#keep", DOUBLE: "value # keep", SINGLE: "single # keep" });
  });

  it("已定义的外部环境变量包括空字符串都不被覆盖", () => {
    const targetEnv = { EXISTING: "", UNDEFINED: undefined };
    applyDotEnv({ EXISTING: "from-dotenv", UNDEFINED: "from-dotenv", NEW_VALUE: "loaded" }, targetEnv);
    expect(targetEnv).toEqual({ EXISTING: "", UNDEFINED: "from-dotenv", NEW_VALUE: "loaded" });
  });

  it("可从临时文件加载而不触碰项目根 .env", async () => {
    const directory = await mkdtemp(join(tmpdir(), "fitness-env-test-"));
    const filePath = join(directory, ".env");
    try {
      await writeFile(filePath, "FROM_FILE=ok # comment\n", "utf8");
      const targetEnv = {};
      expect(loadDotEnv(filePath, targetEnv)).toEqual({ FROM_FILE: "ok" });
      expect(loadDotEnv(join(directory, "missing.env"), targetEnv)).toEqual({ FROM_FILE: "ok" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
