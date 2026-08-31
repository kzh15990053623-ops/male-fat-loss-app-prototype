import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalAuthService } from "../../server/local-auth.mjs";
import { stateRevision, stateWriteRevision, storedStateForWrite } from "../../server/data.mjs";

let dataDirectory;
let service;
let userId;

beforeEach(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), "fitness-cas-"));
  service = createLocalAuthService({ filePath: join(dataDirectory, "local-auth.json"), enabled: true });
  const session = await service.signup("cas@example.com", "secure-pass-01");
  userId = session.user.id;
});

afterEach(async () => {
  await rm(dataDirectory, { recursive: true, force: true });
});

describe("stateRevision 版本号解析", () => {
  it("缺失/非法输入一律视为 0", () => {
    expect(stateRevision(null)).toBe(0);
    expect(stateRevision(undefined)).toBe(0);
    expect(stateRevision("junk")).toBe(0);
    expect(stateRevision({ syncRevision: "junk" })).toBe(0);
    expect(stateRevision({ syncRevision: -1 })).toBe(0);
    expect(stateRevision({ syncRevision: 1.5 })).toBe(0);
  });

  it("合法非负整数按原值返回", () => {
    expect(stateRevision({})).toBe(0);
    expect(stateRevision({ syncRevision: 0 })).toBe(0);
    expect(stateRevision({ syncRevision: 7 })).toBe(7);
  });
});

describe("stateWriteRevision 写入版本契约", () => {
  it("只接受显式非负整数", () => {
    expect(stateWriteRevision({ revision: 0 })).toEqual({ ok: true, missing: false, revision: 0 });
    expect(stateWriteRevision({ revision: 7 })).toEqual({ ok: true, missing: false, revision: 7 });
    expect(stateWriteRevision({})).toEqual({ ok: false, missing: true, revision: null });
    expect(stateWriteRevision({ revision: "0" })).toEqual({ ok: false, missing: false, revision: null });
    expect(stateWriteRevision({ revision: -1 })).toEqual({ ok: false, missing: false, revision: null });
    expect(stateWriteRevision({ revision: 1.5 })).toEqual({ ok: false, missing: false, revision: null });
  });
});

describe("服务端墓碑规范化", () => {
  it("用服务端 updatedAt 覆盖客户端时间并剥离全部旧业务数据", () => {
    const updatedAt = "2026-08-30T08:00:00.000Z";
    expect(
      storedStateForWrite(
        {
          schemaVersion: 3,
          clearedAt: "2036-08-30T00:00:00.000Z",
          weight: 99,
          dailyRecords: { "2026-08-29": { waterMl: 500 } },
        },
        7,
        updatedAt,
      ),
    ).toEqual({ schemaVersion: 3, clearedAt: updatedAt, syncRevision: 7 });
  });

  it("普通写入剥离陈旧或非法 clear marker", () => {
    expect(
      storedStateForWrite({ schemaVersion: 3, clearedAt: "not-a-date", weight: 88, syncRevision: 99 }, 4, "2026-08-30T08:00:00.000Z"),
    ).toEqual({
      schemaVersion: 3,
      weight: 88,
      syncRevision: 4,
    });
  });
});

describe("writeAppState 乐观并发", () => {
  it("首次写入把版本号嵌入状态并返回 revision 1", async () => {
    const result = await service.writeAppState({ state: { schemaVersion: 3, weight: 85.6 }, meals: [], revision: 0 }, userId);
    expect(result.revision).toBe(1);
    const read = await service.readAppState(userId);
    expect(read.revision).toBe(1);
    expect(read.state.weight).toBe(85.6);
  });

  it("携带匹配 revision 的写入成功且版本递增", async () => {
    const first = await service.writeAppState({ state: { weight: 85 }, meals: [], revision: 0 }, userId);
    const second = await service.writeAppState({ state: { weight: 84 }, meals: [], revision: first.revision }, userId);
    expect(second.revision).toBe(2);
    expect((await service.readAppState(userId)).state.weight).toBe(84);
  });

  it("过期 revision 的写入被拒绝且不覆盖已有记录（并发丢数据回归）", async () => {
    const base = await service.writeAppState(
      { state: { weight: 85, dailyRecords: { "2026-08-28": { waterMl: 100 } } }, meals: [], revision: 0 },
      userId,
    );
    // 会话 B 基于最新版本写入（客户端已按天合并，包含 8 月 28 日）
    await service.writeAppState(
      {
        state: { weight: 85, dailyRecords: { "2026-08-28": { waterMl: 100 }, "2026-08-29": { waterMl: 200 } } },
        meals: [],
        revision: base.revision,
      },
      userId,
    );
    // 会话 C 仍基于过期 revision 写入（未见过 B 的 8 月 29 日记录）：
    // 无条件覆盖语义下 C 会静默抹掉 B 的记录，必须改为拒绝
    await expect(
      service.writeAppState(
        {
          state: { weight: 85, dailyRecords: { "2026-08-28": { waterMl: 100 }, "2026-08-30": { waterMl: 300 } } },
          meals: [],
          revision: base.revision,
        },
        userId,
      ),
    ).rejects.toMatchObject({ status: 409, code: "STATE_CONFLICT" });

    const read = await service.readAppState(userId);
    expect(read.state.dailyRecords["2026-08-28"].waterMl).toBe(100);
    expect(read.state.dailyRecords["2026-08-29"].waterMl).toBe(200, "并发先写入的记录必须存活");
    expect(read.state.dailyRecords["2026-08-30"]).toBe(undefined, "过期 revision 的写入不得落盘");
  });

  it("409 冲突载荷携带服务端当前状态与版本，供客户端合并重试", async () => {
    const first = await service.writeAppState({ state: { weight: 85 }, meals: [], revision: 0 }, userId);
    await service.writeAppState({ state: { weight: 84 }, meals: [], revision: first.revision }, userId);

    let conflictError = null;
    await service.writeAppState({ state: { weight: 83 }, meals: [], revision: first.revision }, userId).catch((error) => {
      conflictError = error;
    });
    expect(conflictError).not.toBe(null);
    expect(conflictError.conflict.revision).toBe(2);
    expect(conflictError.conflict.state.weight).toBe(84);

    const retry = await service.writeAppState({ state: { weight: 83 }, meals: [], revision: conflictError.conflict.revision }, userId);
    expect(retry.revision).toBe(3);
  });

  it("缺失 revision 的旧客户端以 409 失败且不覆盖数据", async () => {
    await service.writeAppState({ state: { weight: 85 }, meals: [], revision: 0 }, userId);
    await expect(service.writeAppState({ state: { weight: 84 }, meals: [] }, userId)).rejects.toMatchObject({
      status: 409,
      code: "STATE_REVISION_REQUIRED",
      conflict: { revision: 1 },
    });
    expect((await service.readAppState(userId)).state.weight).toBe(85);
  });

  it.each(["0", -1, 1.5, null])("非法 revision=%j 以 400 失败且不落盘", async (revision) => {
    await expect(service.writeAppState({ state: { weight: 84 }, meals: [], revision }, userId)).rejects.toMatchObject({
      status: 400,
      code: "STATE_REVISION_INVALID",
    });
    expect((await service.readAppState(userId)).revision).toBe(0);
  });

  it("两个 revision 0 首写竞争时仅一个成功", async () => {
    const results = await Promise.allSettled([
      service.writeAppState({ state: { weight: 85 }, meals: [], revision: 0 }, userId),
      service.writeAppState({ state: { weight: 84 }, meals: [], revision: 0 }, userId),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected.reason).toMatchObject({ status: 409, code: "STATE_CONFLICT" });
    expect((await service.readAppState(userId)).revision).toBe(1);
  });

  it("过期版本的清空 tombstone 被拒绝并保留现有数据", async () => {
    const first = await service.writeAppState({ state: { weight: 85 }, meals: [], revision: 0 }, userId);
    await service.writeAppState({ state: { weight: 84 }, meals: [], revision: first.revision }, userId);
    await expect(
      service.writeAppState(
        { state: { schemaVersion: 3, clearedAt: "2026-08-30T00:00:00.000Z" }, meals: null, revision: first.revision },
        userId,
      ),
    ).rejects.toMatchObject({ status: 409, code: "STATE_CONFLICT" });
    expect((await service.readAppState(userId)).state.weight).toBe(84);
  });

  it("成功清空使用服务端同一时间写入 clearedAt 与 updatedAt", async () => {
    const first = await service.writeAppState({ state: { weight: 85 }, meals: [], revision: 0 }, userId);
    const result = await service.writeAppState(
      {
        state: { schemaVersion: 3, clearedAt: "2036-08-30T00:00:00.000Z", weight: 999 },
        meals: null,
        revision: first.revision,
      },
      userId,
    );
    expect(result.revision).toBe(2);
    expect(result.state).toEqual({ schemaVersion: 3, clearedAt: result.updatedAt, syncRevision: 2 });
    expect(result.state.clearedAt).not.toBe("2036-08-30T00:00:00.000Z");
    expect(result.meals).toBe(null);
  });
});
