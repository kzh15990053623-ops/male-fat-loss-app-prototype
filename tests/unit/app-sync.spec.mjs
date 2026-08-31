import { beforeEach, describe, expect, it } from "vitest";
import { CURRENT_SCHEMA_VERSION, initialStateSnapshot, initialMealsSnapshot, meals, runtime, state } from "../../src/app-state.js";
import {
  DAILY_RECORD_LIMIT,
  METRIC_LOG_LIMIT,
  createBlankMeals,
  hydrateTodayFromRecords,
  migratePayload,
  mergePayloads,
  normalizeMealList,
  normalizeMetricLogs,
  persistedStateFrom,
  persistedPayload,
  capturePersistedDataFingerprint,
  prepareLocalMutation,
  pruneDailyRecords,
  resetAppData,
  shouldRetainLocalAfterRemoteClear,
  upsertMetricLog,
} from "../../src/app-sync.js";
import { todayKey } from "../../src/app-utils.js";

function resetState() {
  Object.keys(state).forEach((key) => delete state[key]);
  Object.assign(state, structuredClone(initialStateSnapshot));
  meals.splice(0, meals.length, ...structuredClone(initialMealsSnapshot));
  runtime.stateRevision = 0;
  runtime.localUpdatedAt = "";
  runtime.localMutationRevision = 0;
  runtime.dirtyBaseRevision = null;
  runtime.syncBasePayload = null;
  capturePersistedDataFingerprint();
}

beforeEach(() => {
  resetState();
});

describe("常量契约", () => {
  it("记录上限与 schema 版本锁定（与服务端 data.mjs 对齐）", () => {
    expect(METRIC_LOG_LIMIT).toBe(90);
    expect(DAILY_RECORD_LIMIT).toBe(180);
    expect(CURRENT_SCHEMA_VERSION).toBe(3);
  });
});

describe("normalizeMealList", () => {
  it("非数组输入回退到空白餐次", () => {
    const result = normalizeMealList(null);
    expect(result).toHaveLength(4);
    expect(result.map((meal) => meal.id)).toEqual(["breakfast", "lunch", "dinner", "snack"]);
    expect(result.every((meal) => meal.calories === 0 && meal.nutritionSource === "manual" && meal.aiMeta === null)).toBe(true);
  });

  it("空数组同样回退到空白餐次", () => {
    expect(normalizeMealList([])).toHaveLength(4);
  });

  it("过滤非法项并钳制数值", () => {
    const result = normalizeMealList([
      {
        id: "breakfast",
        name: "早餐",
        calories: -50,
        foods: ["鸡蛋", 5],
        macros: { protein: -3, carbs: "x", fat: 2 },
        nutritionSource: "ai",
        aiMeta: { requestId: "r", model: "m", confidence: 2, needsReview: 1, edited: false },
      },
      "junk",
      { id: "custom" },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0].calories).toBe(0);
    expect(result[0].macros).toEqual({ protein: 0, carbs: 0, fat: 2 });
    expect(result[0].foods).toEqual(["鸡蛋", "5"]);
    expect(result[0].nutritionSource).toBe("ai");
    expect(result[0].aiMeta).toMatchObject({ requestId: "r", confidence: 1, needsReview: true });
    expect(result[1].id).toBe("custom");
    // 过滤后的数组索引决定回退餐次，custom 位于第二项 → 回退到午餐模板
    expect(result[1].name).toBe("午餐");
  });

  it("手写来源不带 AI 元数据", () => {
    const result = normalizeMealList([{ id: "lunch", calories: 620, nutritionSource: "manual", aiMeta: { requestId: "r" } }]);
    expect(result[0].nutritionSource).toBe("manual");
    expect(result[0].aiMeta).toBe(null);
  });

  it("食物列表最多保留 20 条", () => {
    const result = normalizeMealList([{ id: "lunch", foods: Array.from({ length: 25 }, (_, index) => `food-${index}`) }]);
    expect(result[0].foods).toHaveLength(20);
  });
});

describe("normalizeMetricLogs", () => {
  it("过滤非记录项与非有限值，按日期升序排序", () => {
    const result = normalizeMetricLogs([
      { date: "2026-08-26", value: 85.7 },
      "junk",
      { date: "2026-08-25", value: "x" },
      { date: "2026-08-24", value: 86.4 },
    ]);
    expect(result).toEqual([
      { date: "2026-08-24", label: "", value: 86.4 },
      { date: "2026-08-26", label: "", value: 85.7 },
    ]);
  });

  it("非法日期串当前会被保留（时间戳按 0 排最前）", () => {
    const result = normalizeMetricLogs([
      { date: "not-a-date", value: 80 },
      { date: "2026-08-24", value: 86.4 },
    ]);
    expect(result.map((item) => item.date)).toEqual(["not-a-date", "2026-08-24"]);
  });

  it("非数组输入返回空数组", () => {
    expect(normalizeMetricLogs(null)).toEqual([]);
    expect(normalizeMetricLogs(undefined)).toEqual([]);
  });

  it("只保留最近 90 条", () => {
    const logs = Array.from({ length: 95 }, (_, index) => {
      const date = new Date(Date.UTC(2026, 0, 1 + index));
      return { date: date.toISOString().slice(0, 10), value: 80 + index };
    });
    const result = normalizeMetricLogs(logs);
    expect(result).toHaveLength(90);
    expect(result[0].date).toBe("2026-01-06");
    expect(result.at(-1).date).toBe("2026-04-05");
  });
});

describe("pruneDailyRecords", () => {
  it("非对象输入返回空对象", () => {
    expect(pruneDailyRecords("junk")).toEqual({});
    expect(pruneDailyRecords(null)).toEqual({});
  });

  it("丢弃非法日期键与非法记录", () => {
    const result = pruneDailyRecords({ "": { waterMl: 1 }, "2026-08-25": "junk", "2026-08-26": { waterMl: 2 } });
    expect(Object.keys(result)).toEqual(["2026-08-26"]);
  });

  it("超出上限时保留最新日期", () => {
    const records = {};
    for (let day = 21; day <= 25; day += 1) {
      records[`2026-08-${day}`] = { waterMl: day };
    }
    const result = pruneDailyRecords(records, 3);
    expect(Object.keys(result).sort()).toEqual(["2026-08-23", "2026-08-24", "2026-08-25"]);
  });
});

describe("migratePayload 迁移链", () => {
  it("非对象输入返回 null", () => {
    expect(migratePayload(null)).toBe(null);
    expect(migratePayload("junk")).toBe(null);
  });

  it("v2 载荷升级到当前 schema 且标记迁移", () => {
    const result = migratePayload({ state: { schemaVersion: 2, baseBurned: 420, chartData: { fake: true } }, meals: [] });
    expect(result.migrated).toBe(true);
    expect(result.state.schemaVersion).toBe(3);
    expect(result.state.baseBurned).toBe(undefined);
    expect(result.state.chartData).toBe(undefined);
  });

  it("缺失 schemaVersion 视为 v2 处理", () => {
    const result = migratePayload({ state: { weight: 88 }, meals: [] });
    expect(result.migrated).toBe(true);
    expect(result.state.schemaVersion).toBe(3);
  });

  it("v2 未设置过 setupCompleted 时迁移视为已完成，显式 false 保持原样", () => {
    const forced = migratePayload({ state: { schemaVersion: 2 }, meals: [] });
    expect(forced.state.setupCompleted).toBe(true);
    const explicit = migratePayload({ state: { schemaVersion: 2, setupCompleted: false }, meals: [] });
    expect(explicit.state.setupCompleted).toBe(false);
  });

  it("v3 载荷不做迁移标记", () => {
    const result = migratePayload({ state: { schemaVersion: 3, setupCompleted: true }, meals: [] });
    expect(result.migrated).toBe(false);
  });

  it("每日记录补齐 date/meals 并回填热量预算", () => {
    const result = migratePayload({
      state: {
        schemaVersion: 2,
        calorieBudget: 1880,
        dailyRecords: {
          "2026-08-25": { waterMl: 800 },
          "2026-08-26": { calorieBudget: 2000, waterMl: 100 },
          "2026-08-27": "junk",
          "": { waterMl: 1 },
        },
      },
      meals: [],
    });
    const records = result.state.dailyRecords;
    expect(Object.keys(records).sort()).toEqual(["2026-08-25", "2026-08-26"]);
    expect(records["2026-08-25"].date).toBe("2026-08-25");
    expect(records["2026-08-25"].calorieBudget).toBe(1880);
    expect(records["2026-08-25"].meals).toHaveLength(4);
    expect(records["2026-08-26"].calorieBudget).toBe(2000);
  });

  it("时间戳字段按 localUpdatedAt > updatedAt > 空字符串回退且保留 revision", () => {
    const explicit = migratePayload({
      state: {},
      meals: [],
      localUpdatedAt: "2026-08-25T08:00:00.000Z",
      updatedAt: "2026-08-25T09:00:00.000Z",
      revision: 4,
      dirtyBaseRevision: 3,
    });
    expect(explicit.localUpdatedAt).toBe("2026-08-25T08:00:00.000Z");
    expect(explicit.updatedAt).toBe("2026-08-25T09:00:00.000Z");
    expect(explicit.revision).toBe(4);
    expect(explicit.dirtyBaseRevision).toBe(3);

    const fromUpdated = migratePayload({ state: {}, meals: [], updatedAt: "2026-08-25T09:00:00.000Z" });
    expect(fromUpdated.localUpdatedAt).toBe("2026-08-25T09:00:00.000Z");

    const fallback = migratePayload({ state: {}, meals: [] });
    expect(fallback.localUpdatedAt).toBe("");
    expect(fallback.updatedAt).toBe(null);
    expect(fallback.revision).toBe(0);
    expect(fallback.dirtyBaseRevision).toBe(null);

    const invalidDirtyBase = migratePayload({ state: {}, meals: [], dirtyBaseRevision: "3" });
    expect(invalidDirtyBase.dirtyBaseRevision).toBe(null);
  });
});

describe("纯序列化与本地变更时钟", () => {
  it("重复 persistedPayload 不修改状态、日记录或时间戳", () => {
    runtime.stateRevision = 7;
    runtime.localUpdatedAt = "2026-08-29T01:00:00.000Z";
    const before = JSON.parse(JSON.stringify(state));
    const first = persistedPayload();
    const second = persistedPayload();

    expect(second).toEqual(first);
    expect(state).toEqual(before);
    expect(first.localUpdatedAt).toBe("2026-08-29T01:00:00.000Z");
    expect(first.revision).toBe(7);
  });

  it("仅水合空白今天时不写入带时间戳的日记录", () => {
    state.dailyRecords = {};
    hydrateTodayFromRecords();
    expect(state.dailyRecords).toEqual({});
  });

  it("包级变更只推进包时间，真实当天字段变化才推进日记录时间", () => {
    const firstAt = "2026-08-30T01:00:00.000Z";
    const packageOnlyAt = "2026-08-30T02:00:00.000Z";
    const dailyChangeAt = "2026-08-30T03:00:00.000Z";
    const date = todayKey();

    state.waterMl = 200;
    prepareLocalMutation(firstAt);
    expect(state.dailyRecords[date].updatedAt).toBe(firstAt);
    state.preferences.reminderTime = "20:30";
    prepareLocalMutation(packageOnlyAt);
    expect(runtime.localUpdatedAt).toBe(packageOnlyAt);
    expect(state.dailyRecords[date].updatedAt).toBe(firstAt);

    state.waterMl = 300;
    prepareLocalMutation(dailyChangeAt);
    expect(runtime.localUpdatedAt).toBe(dailyChangeAt);
    expect(state.dailyRecords[date].updatedAt).toBe(dailyChangeAt);
    expect(runtime.localMutationRevision).toBe(3);
  });

  it("业务内容未变化时不推进包时间、日记录时间或 mutation token", () => {
    runtime.localUpdatedAt = "2026-08-30T00:00:00.000Z";
    const beforeRecords = structuredClone(state.dailyRecords);
    prepareLocalMutation("2026-08-30T05:00:00.000Z");
    expect(runtime.lastMutationChanged).toBe(false);
    expect(runtime.localUpdatedAt).toBe("2026-08-30T00:00:00.000Z");
    expect(runtime.localMutationRevision).toBe(0);
    expect(runtime.dirtyBaseRevision).toBe(null);
    expect(state.dailyRecords).toEqual(beforeRecords);
  });

  it("resetAppData 显式保留服务端同步元数据且不制造今天记录", () => {
    resetAppData({ blank: true, revision: 9, localUpdatedAt: "2026-08-30T04:00:00.000Z" });
    expect(runtime.stateRevision).toBe(9);
    expect(runtime.localUpdatedAt).toBe("2026-08-30T04:00:00.000Z");
    expect(runtime.localMutationRevision).toBe(0);
    expect(runtime.dirtyBaseRevision).toBe(null);
    expect(state.dailyRecords).toEqual({});
  });
});

describe("远端清空版本判定", () => {
  const remoteClear = {
    state: { schemaVersion: 3, clearedAt: "2026-08-30T06:00:00.000Z", syncRevision: 5 },
    meals: null,
    updatedAt: "2026-08-30T06:00:00.000Z",
    revision: 5,
  };

  it("旧 revision 无论本地墙钟早晚都不能越过墓碑", () => {
    for (const localUpdatedAt of ["2026-08-29T00:00:00.000Z", "2036-08-30T00:00:00.000Z"]) {
      expect(
        shouldRetainLocalAfterRemoteClear(
          {
            state: { weight: 88, dailyRecords: { "2026-08-29": { waterMl: 500 } } },
            meals: [],
            revision: 4,
            dirtyBaseRevision: 4,
            localUpdatedAt,
          },
          remoteClear,
        ),
      ).toBe(false);
    }
  });

  it("只有观察过墓碑 revision 后产生的显式脏变更可以上推", () => {
    expect(
      shouldRetainLocalAfterRemoteClear(
        { state: { waterMl: 200 }, meals: [], revision: 5, dirtyBaseRevision: 5, localUpdatedAt: "2026-08-30T06:01:00.000Z" },
        remoteClear,
      ),
    ).toBe(true);
    expect(
      shouldRetainLocalAfterRemoteClear(
        { state: {}, meals: [], revision: 5, dirtyBaseRevision: null, localUpdatedAt: "2036-08-30T00:00:00.000Z" },
        remoteClear,
      ),
    ).toBe(false);
    expect(
      shouldRetainLocalAfterRemoteClear(
        {
          state: { clearedAt: remoteClear.state.clearedAt },
          meals: null,
          revision: 5,
          dirtyBaseRevision: 5,
          localUpdatedAt: "2036-08-30T00:00:00.000Z",
        },
        remoteClear,
      ),
    ).toBe(false);
  });

  it("缺失或不一致的墓碑版本一律 fail closed", () => {
    const local = { state: { waterMl: 200 }, meals: [], revision: 0, dirtyBaseRevision: 0 };
    expect(shouldRetainLocalAfterRemoteClear(local, { ...remoteClear, revision: undefined })).toBe(false);
    expect(
      shouldRetainLocalAfterRemoteClear(local, {
        ...remoteClear,
        revision: 5,
        state: { ...remoteClear.state, syncRevision: 4 },
      }),
    ).toBe(false);
  });
});

describe("persistedStateFrom 持久化清洗", () => {
  it("剥离会话与 UI 临时字段", () => {
    const result = persistedStateFrom({
      weight: 88,
      calorieBudget: 1880,
      toast: "hello",
      appLoading: true,
      authError: "x",
      settingsDraft: { weight: 90 },
      undoActivity: { id: 1 },
      baseBurned: 420,
      chartData: { fake: true },
      streak: 99,
      bestStreak: 120,
      activeTab: "home",
      backendStatus: "online",
      syncPending: true,
    });
    expect(result.weight).toBe(88);
    expect(result.calorieBudget).toBe(1880);
    for (const key of [
      "toast",
      "appLoading",
      "authError",
      "settingsDraft",
      "undoActivity",
      "baseBurned",
      "chartData",
      "streak",
      "bestStreak",
      "activeTab",
      "backendStatus",
      "syncPending",
    ]) {
      expect(result[key]).toBe(undefined);
    }
  });

  it("非法集合字段回退为默认结构", () => {
    const result = persistedStateFrom({
      weight: 88,
      user: "junk",
      preferences: "junk",
      taskOverrides: "junk",
      mealTemplates: "junk",
      weightLogs: "junk",
    });
    expect(result.user).toBe(undefined);
    expect(result.preferences).toBe(undefined);
    expect(result.taskOverrides).toEqual({});
    expect(result.mealTemplates).toEqual([]);
    expect(result.weightLogs).toEqual([]);
    expect(result.schemaVersion).toBe(3);
  });

  it("餐单草稿中的 AI 运行态字段被重置", () => {
    const result = persistedStateFrom({
      mealDraft: {
        food: "鸡胸肉",
        aiResult: { calories: 500 },
        aiStatus: "loading",
        aiError: "x",
        aiErrorCode: "E1",
        aiRequestId: "r",
        aiRetryable: true,
      },
    });
    expect(result.mealDraft.food).toBe("鸡胸肉");
    expect(result.mealDraft.aiResult).toBe(null);
    expect(result.mealDraft.aiStatus).toBe("idle");
    expect(result.mealDraft.aiError).toBe("");
    expect(result.mealDraft.aiErrorCode).toBe("");
    expect(result.mealDraft.aiRequestId).toBe("");
    expect(result.mealDraft.aiRetryable).toBe(false);
  });

  it("非对象输入返回空对象", () => {
    expect(persistedStateFrom(null)).toEqual({});
    expect(persistedStateFrom("junk")).toEqual({});
  });
});

function dailyRecord(date, updatedAt, overrides = {}) {
  return { date, updatedAt, waterMl: 0, ...overrides };
}

describe("mergePayloads 按天合并", () => {
  it("用持久化基线三方合并并保留两台设备修改的不同设置字段", () => {
    const base = {
      state: {
        schemaVersion: 3,
        calorieBudget: 1800,
        preferences: { reminderTime: "20:00", reminders: true },
        dailyRecords: {},
      },
      meals: [],
      updatedAt: "2026-08-30T08:00:00.000Z",
      revision: 1,
    };
    const localPayload = migratePayload({
      ...base,
      state: { ...base.state, preferences: { ...base.state.preferences, reminderTime: "21:00" } },
      localUpdatedAt: "2026-08-30T08:02:00.000Z",
    });
    localPayload.dirtyBaseRevision = 1;
    localPayload.syncBase = base;
    const serverRaw = {
      ...base,
      state: { ...base.state, calorieBudget: 2000 },
      updatedAt: "2026-08-30T08:01:00.000Z",
      revision: 2,
    };

    const result = mergePayloads(localPayload, migratePayload(serverRaw), serverRaw);

    expect(result.safeMerge).toBe(true);
    expect(result.localContributed).toBe(true);
    expect(result.payload.state.calorieBudget).toBe(2000);
    expect(result.payload.state.preferences).toMatchObject({ reminderTime: "21:00", reminders: true });
    expect(result.payload.revision).toBe(2);
  });

  it("三方集合合并保留独立新增，并让删除压过同实体并发编辑", () => {
    const base = {
      state: {
        schemaVersion: 3,
        dailyRecords: {},
        weightLogs: [{ date: "2026-08-29", label: "8月29日", value: 88 }],
      },
      meals: [],
      updatedAt: "2026-08-30T08:00:00.000Z",
      revision: 4,
    };
    const localPayload = migratePayload({
      ...base,
      state: {
        ...base.state,
        weightLogs: [{ date: "2026-08-30", label: "8月30日", value: 87 }],
      },
      localUpdatedAt: "2026-08-30T08:02:00.000Z",
    });
    localPayload.dirtyBaseRevision = 4;
    localPayload.syncBase = base;
    const serverRaw = {
      ...base,
      state: {
        ...base.state,
        weightLogs: [
          { date: "2026-08-29", label: "8月29日", value: 89 },
          { date: "2026-08-31", label: "8月31日", value: 86 },
        ],
      },
      updatedAt: "2026-08-30T08:01:00.000Z",
      revision: 5,
    };

    const result = mergePayloads(localPayload, migratePayload(serverRaw), serverRaw);

    expect(result.payload.state.weightLogs).toEqual([
      { date: "2026-08-30", label: "8月30日", value: 87 },
      { date: "2026-08-31", label: "8月31日", value: 86 },
    ]);
  });

  it("同一日的不同字段递归合并，记录时间取两端较晚值", () => {
    const date = "2026-08-30";
    const baseRecord = dailyRecord(date, "2026-08-30T08:00:00.000Z", { waterMl: 500, steps: 3000, sleep: 7 });
    const base = {
      state: { schemaVersion: 3, dailyRecords: { [date]: baseRecord } },
      meals: [],
      revision: 8,
      updatedAt: "2026-08-30T08:00:00.000Z",
    };
    const localPayload = migratePayload({
      ...base,
      state: {
        ...base.state,
        dailyRecords: { [date]: { ...baseRecord, waterMl: 900, updatedAt: "2026-08-30T08:03:00.000Z" } },
      },
      localUpdatedAt: "2026-08-30T08:03:00.000Z",
    });
    localPayload.dirtyBaseRevision = 8;
    localPayload.syncBase = base;
    const serverRaw = {
      ...base,
      state: {
        ...base.state,
        dailyRecords: { [date]: { ...baseRecord, steps: 6000, updatedAt: "2026-08-30T08:02:00.000Z" } },
      },
      revision: 9,
      updatedAt: "2026-08-30T08:02:00.000Z",
    };

    const result = mergePayloads(localPayload, migratePayload(serverRaw), serverRaw);

    expect(result.payload.state.dailyRecords[date]).toMatchObject({
      waterMl: 900,
      steps: 6000,
      sleep: 7,
      updatedAt: "2026-08-30T08:03:00.000Z",
    });
  });

  it("餐次按 id 合并独立新增，同一叶冲突保留未同步本机值", () => {
    const breakfast = { id: "breakfast", name: "早餐", calories: 300 };
    const base = {
      state: { schemaVersion: 3, dailyRecords: {} },
      meals: [breakfast],
      revision: 10,
      updatedAt: "2026-08-30T09:00:00.000Z",
    };
    const localPayload = migratePayload({
      ...base,
      meals: [
        { ...breakfast, calories: 420 },
        { id: "lunch", name: "午餐", calories: 600 },
      ],
      localUpdatedAt: "2026-08-30T09:02:00.000Z",
    });
    localPayload.dirtyBaseRevision = 10;
    localPayload.syncBase = base;
    const serverRaw = {
      ...base,
      meals: [
        { ...breakfast, calories: 380 },
        { id: "dinner", name: "晚餐", calories: 500 },
      ],
      revision: 11,
      updatedAt: "2026-08-30T09:01:00.000Z",
    };

    const result = mergePayloads(localPayload, migratePayload(serverRaw), serverRaw);

    expect(result.payload.meals).toMatchObject([
      { id: "breakfast", calories: 420 },
      { id: "lunch", calories: 600 },
      { id: "dinner", calories: 500 },
    ]);
  });

  it("本地更新时：本地独有日保留、各日按 updatedAt 取胜者、指标冲突随包时间", () => {
    const localPayload = {
      state: {
        calorieBudget: 1900,
        dailyRecords: {
          "2026-08-24": dailyRecord("2026-08-24", "2026-08-24T10:00:00.000Z", { waterMl: 100 }),
          "2026-08-25": dailyRecord("2026-08-25", "2026-08-25T08:00:00.000Z", { waterMl: 200 }),
          "2026-08-26": dailyRecord("2026-08-26", "2026-08-26T08:00:00.000Z", { waterMl: 300 }),
        },
        weightLogs: [{ date: "2026-08-25", label: "8月25日", value: 86 }],
      },
      meals: [{ id: "lunch", name: "午餐", calories: 620 }],
      localUpdatedAt: "2026-08-26T12:00:00.000Z",
    };
    const serverRaw = {
      state: {
        schemaVersion: 3,
        calorieBudget: 1800,
        dailyRecords: {
          "2026-08-25": dailyRecord("2026-08-25", "2026-08-25T09:00:00.000Z", { waterMl: 201 }),
          "2026-08-26": dailyRecord("2026-08-26", "2026-08-26T06:00:00.000Z", { waterMl: 301 }),
          "2026-08-27": dailyRecord("2026-08-27", "2026-08-27T06:00:00.000Z", { waterMl: 400 }),
        },
        weightLogs: [
          { date: "2026-08-25", label: "8月25日", value: 87 },
          { date: "2026-08-26", label: "8月26日", value: 85 },
        ],
      },
      meals: [{ id: "dinner", name: "晚餐", calories: 500 }],
      updatedAt: "2026-08-26T10:00:00.000Z",
    };
    const { payload, localContributed } = mergePayloads(localPayload, migratePayload(serverRaw), serverRaw);

    expect(localContributed).toBe(true);
    expect(payload.state.dailyRecords["2026-08-24"].waterMl).toBe(100);
    expect(payload.state.dailyRecords["2026-08-25"].waterMl).toBe(201);
    expect(payload.state.dailyRecords["2026-08-26"].waterMl).toBe(300);
    expect(payload.state.dailyRecords["2026-08-27"].waterMl).toBe(400);
    expect(payload.state.weightLogs).toEqual([
      { date: "2026-08-25", label: "8月25日", value: 86 },
      { date: "2026-08-26", label: "8月26日", value: 85 },
    ]);
    expect(payload.state.calorieBudget).toBe(1900);
    expect(payload.meals).toEqual([{ id: "lunch", name: "午餐", calories: 620 }]);
    expect(payload.localUpdatedAt).toBe("2026-08-26T12:00:00.000Z");
    expect(payload.migrated).toBe(false);
  });

  it("服务端更新时：同时间戳记录与指标冲突都随服务端，标量取服务端", () => {
    const localPayload = {
      state: {
        calorieBudget: 1900,
        dailyRecords: { "2026-08-25": dailyRecord("2026-08-25", "2026-08-25T06:00:00.000Z", { waterMl: 100 }) },
        weightLogs: [{ date: "2026-08-25", label: "8月25日", value: 86 }],
      },
      meals: [{ id: "lunch", name: "午餐", calories: 620 }],
      localUpdatedAt: "2026-08-25T05:00:00.000Z",
    };
    const serverRaw = {
      state: {
        schemaVersion: 3,
        calorieBudget: 1800,
        dailyRecords: { "2026-08-25": dailyRecord("2026-08-25", "2026-08-25T06:00:00.000Z", { waterMl: 999 }) },
        weightLogs: [{ date: "2026-08-25", label: "8月25日", value: 87 }],
      },
      meals: [{ id: "dinner", name: "晚餐", calories: 500 }],
      updatedAt: "2026-08-25T07:00:00.000Z",
    };
    const { payload, localContributed } = mergePayloads(localPayload, migratePayload(serverRaw), serverRaw);

    expect(localContributed).toBe(false);
    expect(payload.state.dailyRecords["2026-08-25"].waterMl).toBe(999);
    expect(payload.state.weightLogs).toEqual([{ date: "2026-08-25", label: "8月25日", value: 87 }]);
    expect(payload.state.calorieBudget).toBe(1800);
    // 服务端餐次经过 normalizeMealList 补全了完整结构
    expect(payload.meals).toMatchObject([{ id: "dinner", name: "晚餐", calories: 500 }]);
  });

  it("本地独有日期即使包更旧也会贡献数据", () => {
    const localPayload = {
      state: { dailyRecords: {}, weightLogs: [{ date: "2026-08-23", label: "8月23日", value: 90 }] },
      meals: [],
      localUpdatedAt: "2026-08-25T05:00:00.000Z",
    };
    const serverRaw = {
      state: { schemaVersion: 3, dailyRecords: {}, weightLogs: [{ date: "2026-08-24", label: "8月24日", value: 88 }] },
      meals: [],
      updatedAt: "2026-08-25T07:00:00.000Z",
    };
    const { payload, localContributed } = mergePayloads(localPayload, migratePayload(serverRaw), serverRaw);
    expect(localContributed).toBe(true);
    expect(payload.state.weightLogs).toEqual([
      { date: "2026-08-23", label: "8月23日", value: 90 },
      { date: "2026-08-24", label: "8月24日", value: 88 },
    ]);
  });

  it("无时间戳的旧本地包不会因迁移而压过服务端新数据", () => {
    const localPayload = migratePayload({ state: { schemaVersion: 3, weight: 100 }, meals: [] });
    const serverRaw = {
      state: { schemaVersion: 3, weight: 999 },
      meals: [],
      updatedAt: "2026-08-29T09:00:00.000Z",
      revision: 6,
    };
    const { payload, localContributed } = mergePayloads(localPayload, migratePayload(serverRaw), serverRaw);

    expect(localPayload.localUpdatedAt).toBe("");
    expect(localContributed).toBe(false);
    expect(payload.state.weight).toBe(999);
    expect(payload.revision).toBe(6);
  });

  it("空载荷合并不崩溃并返回空结构", () => {
    const localPayload = { meals: [], localUpdatedAt: "" };
    const serverRaw = { state: {}, meals: null, updatedAt: "" };
    const { payload, localContributed } = mergePayloads(localPayload, migratePayload(serverRaw), serverRaw);
    expect(localContributed).toBe(false);
    expect(payload.state.dailyRecords).toEqual({});
    expect(payload.state.weightLogs).toEqual([]);
    expect(payload.state.waistLogs).toEqual([]);
  });
});

describe("upsertMetricLog", () => {
  it("写入按日期去重并保留一位小数", () => {
    upsertMetricLog("weightLogs", 86.44, "2026-08-25");
    upsertMetricLog("weightLogs", 86.9, "2026-08-25");
    expect(state.weightLogs).toEqual([{ date: "2026-08-25", label: expect.any(String), value: 86.9 }]);
  });

  it("非法数值被忽略", () => {
    upsertMetricLog("weightLogs", "abc", "2026-08-25");
    expect(state.weightLogs).toEqual([]);
  });

  it("多日期写入后按时间升序", () => {
    upsertMetricLog("weightLogs", 86, "2026-08-26");
    upsertMetricLog("weightLogs", 85, "2026-08-24");
    upsertMetricLog("weightLogs", 85.5, "2026-08-25");
    expect(state.weightLogs.map((item) => item.date)).toEqual(["2026-08-24", "2026-08-25", "2026-08-26"]);
  });
});

describe("createBlankMeals", () => {
  it("生成四餐空白结构", () => {
    const result = createBlankMeals();
    expect(result).toHaveLength(4);
    expect(result.every((meal) => meal.calories === 0 && meal.status === "待记录" && meal.foods.length === 0 && meal.aiMeta === null)).toBe(
      true,
    );
    expect(result[0].macros).toEqual({ protein: 0, carbs: 0, fat: 0 });
  });
});
