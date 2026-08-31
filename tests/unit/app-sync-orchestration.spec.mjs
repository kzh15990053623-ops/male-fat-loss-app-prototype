import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialMealsSnapshot, initialStateSnapshot, meals, runtime, state } from "../../src/app-state.js";
import {
  adoptRemoteClear,
  capturePersistedDataFingerprint,
  loadServerState,
  loadStoredState,
  persistedPayload,
  saveStoredState,
  setSyncFeedbackHandler,
  stateWriteAcknowledgement,
  syncStateNow,
} from "../../src/app-sync.js";

let values;

function resetState() {
  Object.keys(state).forEach((key) => delete state[key]);
  Object.assign(state, structuredClone(initialStateSnapshot), {
    appLoading: false,
    authRequired: false,
    setupCompleted: true,
    syncError: "",
    syncErrorKind: "none",
    syncPending: false,
  });
  meals.splice(0, meals.length, ...structuredClone(initialMealsSnapshot));
  Object.assign(runtime, {
    accessToken: "unit-access",
    authUserId: "unit-user",
    authProvider: "supabase",
    loadedLegacyStorageKey: "",
    stateRevision: 0,
    localUpdatedAt: "",
    localMutationRevision: 0,
    dirtyBaseRevision: null,
    syncBasePayload: null,
    syncPromise: null,
    saveTimer: undefined,
    inputSaveTimer: undefined,
    retryTimer: undefined,
  });
  capturePersistedDataFingerprint();
}

beforeEach(() => {
  values = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key) => values.get(String(key)) ?? null,
    setItem: (key, value) => values.set(String(key), String(value)),
    removeItem: (key) => values.delete(String(key)),
  });
  vi.stubGlobal("document", { querySelectorAll: () => [] });
  vi.stubGlobal("navigator", { onLine: true });
  resetState();
});

afterEach(() => {
  clearTimeout(runtime.saveTimer);
  clearTimeout(runtime.inputSaveTimer);
  clearTimeout(runtime.retryTimer);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setSyncFeedbackHandler(() => {});
});

describe("app sync orchestration", () => {
  it("validates server write acknowledgements", () => {
    expect(stateWriteAcknowledgement({ revision: 2, updatedAt: "2026-08-30T01:00:00.000Z" })).toEqual({
      revision: 2,
      updatedAt: "2026-08-30T01:00:00.000Z",
    });
    expect(stateWriteAcknowledgement({ revision: -1, updatedAt: "2026-08-30T01:00:00.000Z" })).toBe(null);
    expect(stateWriteAcknowledgement({ revision: 2, updatedAt: "" })).toBe(null);
    expect(stateWriteAcknowledgement(null)).toBe(null);
  });

  it("no-op save 不写缓存、不排队同步也不标记 pending", () => {
    expect(saveStoredState()).toBe(true);
    expect(values.size).toBe(0);
    expect(runtime.saveTimer).toBe(undefined);
    expect(runtime.localMutationRevision).toBe(0);
    expect(runtime.dirtyBaseRevision).toBe(null);
    expect(state.syncPending).toBe(false);
  });

  it("persists a real mutation and adopts the acknowledged server revision", async () => {
    state.weight = 88.5;
    expect(saveStoredState()).toBe(true);
    clearTimeout(runtime.saveTimer);
    runtime.saveTimer = undefined;
    const fetchMock = vi.fn(async (_url, init) => {
      expect(JSON.parse(init.body)).toMatchObject({ revision: 0, state: { weight: 88.5 } });
      return new Response(JSON.stringify({ revision: 1, updatedAt: "2026-08-30T01:00:01.000Z" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(syncStateNow({ silent: true })).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(runtime.stateRevision).toBe(1);
    expect(runtime.localUpdatedAt).toBe("2026-08-30T01:00:01.000Z");
    expect(state.syncPending).toBe(false);
    const stored = JSON.parse(values.get("fat-loss-state-v3:unit-user"));
    expect(stored).toMatchObject({ revision: 1, localUpdatedAt: "2026-08-30T01:00:01.000Z", state: { weight: 88.5 } });
  });

  it("无在途新修改时把服务端 canonical 确认应用到内存与缓存", async () => {
    meals[0].foods = ["很长的食物描述".repeat(20)];
    saveStoredState();
    clearTimeout(runtime.saveTimer);
    runtime.saveTimer = undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        const body = JSON.parse(init.body);
        const canonical = structuredClone(body);
        canonical.meals[0].foods[0] = canonical.meals[0].foods[0].slice(0, 80);
        Object.values(canonical.state.dailyRecords || {}).forEach((record) => {
          if (record?.meals?.[0]?.foods?.[0]) record.meals[0].foods[0] = record.meals[0].foods[0].slice(0, 80);
        });
        return new Response(
          JSON.stringify({
            ...canonical,
            state: { ...canonical.state, syncRevision: 1 },
            revision: 1,
            updatedAt: "2026-08-30T01:30:01.000Z",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );

    await expect(syncStateNow({ silent: true })).resolves.toBe(true);

    expect(meals[0].foods[0]).toHaveLength(80);
    expect(runtime.syncBasePayload.meals[0].foods[0]).toHaveLength(80);
    expect(runtime.dirtyBaseRevision).toBe(null);
    expect(JSON.parse(values.get("fat-loss-state-v3:unit-user")).meals[0].foods[0]).toHaveLength(80);
  });

  it("drains one latest write when a mutation lands during the first PUT", async () => {
    state.weight = 90;
    saveStoredState();
    clearTimeout(runtime.saveTimer);
    runtime.saveTimer = undefined;

    let resolveFirst;
    let markFirstStarted;
    const firstStarted = new Promise((resolve) => {
      markFirstStarted = resolve;
    });
    const bodies = [];
    const fetchMock = vi.fn(async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      if (bodies.length === 1) {
        markFirstStarted();
        return new Promise((resolve) => {
          resolveFirst = resolve;
        });
      }
      return new Response(JSON.stringify({ revision: 2, updatedAt: "2026-08-30T02:00:02.000Z" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const pending = syncStateNow({ silent: true });
    await firstStarted;
    state.weight = 80;
    saveStoredState();
    resolveFirst(
      new Response(JSON.stringify({ revision: 1, updatedAt: "2026-08-30T02:00:01.000Z" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(pending).resolves.toBe(true);
    expect(bodies).toHaveLength(2);
    expect(bodies.map((body) => body.revision)).toEqual([0, 1]);
    expect(bodies[1].state.weight).toBe(80);
    expect(runtime.stateRevision).toBe(2);
    expect(state.syncPending).toBe(false);
    expect(JSON.parse(values.get("fat-loss-state-v3:unit-user"))).toMatchObject({ revision: 2, state: { weight: 80 } });
  });

  it("首轮确认规范化字段时仍保留发送期间产生的新修改", async () => {
    state.weight = 90.4;
    saveStoredState();
    clearTimeout(runtime.saveTimer);
    runtime.saveTimer = undefined;
    let releaseFirst;
    let markFirstStarted;
    const firstStarted = new Promise((resolve) => {
      markFirstStarted = resolve;
    });
    const bodies = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        const body = JSON.parse(init.body);
        bodies.push(body);
        if (bodies.length === 1) {
          markFirstStarted();
          await new Promise((resolve) => {
            releaseFirst = resolve;
          });
          return new Response(
            JSON.stringify({
              state: { ...body.state, weight: 90, syncRevision: 1 },
              meals: body.meals,
              revision: 1,
              updatedAt: "2026-08-30T02:30:01.000Z",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(JSON.stringify({ revision: 2, updatedAt: "2026-08-30T02:30:02.000Z" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    const pending = syncStateNow({ silent: true });
    await firstStarted;
    state.preferences.reminderTime = "05:15";
    saveStoredState();
    releaseFirst();
    await expect(pending).resolves.toBe(true);

    expect(bodies).toHaveLength(2);
    expect(bodies[1].state.weight).toBe(90);
    expect(bodies[1].state.preferences.reminderTime).toBe("05:15");
  });

  it("409 三方合并保留远端热量目标与本机提醒时间", async () => {
    runtime.stateRevision = 1;
    state.calorieBudget = 1800;
    state.preferences.reminderTime = "20:00";
    capturePersistedDataFingerprint();
    const remoteState = structuredClone(persistedPayload().state);
    remoteState.calorieBudget = 2000;
    remoteState.syncRevision = 2;

    state.preferences.reminderTime = "21:00";
    expect(saveStoredState()).toBe(true);
    clearTimeout(runtime.saveTimer);
    runtime.saveTimer = undefined;
    const dirtyEnvelope = JSON.parse(values.get("fat-loss-state-v3:unit-user"));
    expect(dirtyEnvelope).toMatchObject({
      revision: 1,
      dirtyBaseRevision: 1,
      syncBase: { revision: 1, state: { calorieBudget: 1800, preferences: { reminderTime: "20:00" } } },
    });

    const bodies = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        const body = JSON.parse(init.body);
        bodies.push(body);
        if (bodies.length === 1) {
          return new Response(
            JSON.stringify({
              code: "STATE_CONFLICT",
              conflict: {
                state: remoteState,
                meals: body.meals,
                updatedAt: "2026-08-30T03:00:01.000Z",
                revision: 2,
              },
            }),
            { status: 409, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(JSON.stringify({ revision: 3, updatedAt: "2026-08-30T03:00:02.000Z" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    await expect(syncStateNow({ silent: true })).resolves.toBe(true);

    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toMatchObject({
      revision: 2,
      state: { calorieBudget: 2000, preferences: { reminderTime: "21:00" } },
    });
    expect(bodies[1].syncBase).toBe(undefined);
    expect(state.calorieBudget).toBe(2000);
    expect(state.preferences.reminderTime).toBe("21:00");
    expect(runtime.stateRevision).toBe(3);
    expect(runtime.dirtyBaseRevision).toBe(null);
  });

  it("刷新后从同一缓存 envelope 恢复脏数据与同步基线", () => {
    runtime.stateRevision = 7;
    state.calorieBudget = 1800;
    capturePersistedDataFingerprint();
    state.preferences.reminderTime = "04:37";
    saveStoredState();
    clearTimeout(runtime.saveTimer);
    runtime.saveTimer = undefined;

    resetState();
    expect(loadStoredState()).toMatchObject({ revision: 7, dirtyBaseRevision: 7 });

    expect(state.preferences.reminderTime).toBe("04:37");
    expect(runtime.dirtyBaseRevision).toBe(7);
    expect(runtime.syncBasePayload).toMatchObject({ revision: 7, state: { calorieBudget: 1800 } });
  });

  it("409 时缺少可信基线会停止重试并保留本机 pending", async () => {
    runtime.stateRevision = 2;
    capturePersistedDataFingerprint();
    state.weight = 89;
    saveStoredState();
    clearTimeout(runtime.saveTimer);
    runtime.saveTimer = undefined;
    runtime.syncBasePayload = null;
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            code: "STATE_CONFLICT",
            conflict: {
              state: { schemaVersion: 3, weight: 88, syncRevision: 3 },
              meals: structuredClone(initialMealsSnapshot),
              updatedAt: "2026-08-30T04:00:00.000Z",
              revision: 3,
            },
          }),
          { status: 409, headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(syncStateNow({ silent: true })).resolves.toBe(false);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(state.weight).toBe(89);
    expect(runtime.stateRevision).toBe(2);
    expect(state.syncPending).toBe(true);
    expect(state.syncError).toContain("再次发生冲突");
  });

  it("第二次 409 前已原子保存首次合并后的工作副本与新基线", async () => {
    runtime.stateRevision = 1;
    state.calorieBudget = 1800;
    state.preferences.reminderTime = "20:00";
    capturePersistedDataFingerprint();
    state.preferences.reminderTime = "21:00";
    saveStoredState();
    clearTimeout(runtime.saveTimer);
    runtime.saveTimer = undefined;
    const baseState = structuredClone(runtime.syncBasePayload.state);
    const conflicts = [
      {
        state: { ...baseState, calorieBudget: 2000, syncRevision: 2 },
        meals: structuredClone(initialMealsSnapshot),
        updatedAt: "2026-08-30T04:30:01.000Z",
        revision: 2,
      },
      {
        state: { ...baseState, calorieBudget: 2000, stepsTarget: 12000, syncRevision: 3 },
        meals: structuredClone(initialMealsSnapshot),
        updatedAt: "2026-08-30T04:30:02.000Z",
        revision: 3,
      },
    ];
    let requestCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const conflict = conflicts[Math.min(requestCount, conflicts.length - 1)];
        requestCount += 1;
        return new Response(JSON.stringify({ code: "STATE_CONFLICT", conflict }), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    await expect(syncStateNow({ silent: true })).resolves.toBe(false);

    expect(requestCount).toBe(2);
    expect(state.calorieBudget).toBe(2000);
    expect(state.preferences.reminderTime).toBe("21:00");
    const stored = JSON.parse(values.get("fat-loss-state-v3:unit-user"));
    expect(stored).toMatchObject({
      revision: 2,
      dirtyBaseRevision: 2,
      state: { calorieBudget: 2000, preferences: { reminderTime: "21:00" } },
      syncBase: { revision: 2, state: { calorieBudget: 2000 } },
    });
  });

  it("keeps pending local data when the server acknowledgement is invalid", async () => {
    state.weight = 86;
    saveStoredState();
    clearTimeout(runtime.saveTimer);
    runtime.saveTimer = undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } })),
    );

    await expect(syncStateNow({ silent: true })).resolves.toBe(false);
    expect(state.syncPending).toBe(true);
    expect(state.syncError).toContain("同步确认无效");
    expect(JSON.parse(values.get("fat-loss-state-v3:unit-user")).state.weight).toBe(86);
  });

  it("409 回传墓碑时不重试旧数据并立即采用清空状态", async () => {
    state.weight = 91;
    state.dailyRecords = { "2026-08-29": { date: "2026-08-29", waterMl: 800, updatedAt: "2026-08-29T12:00:00.000Z" } };
    saveStoredState();
    clearTimeout(runtime.saveTimer);
    runtime.saveTimer = undefined;
    const remoteClear = {
      state: { schemaVersion: 3, clearedAt: "2026-08-30T06:00:00.000Z", syncRevision: 1 },
      meals: null,
      updatedAt: "2026-08-30T06:00:00.000Z",
      revision: 1,
    };
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ code: "STATE_CONFLICT", conflict: remoteClear }), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const feedback = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    setSyncFeedbackHandler(feedback);

    await expect(syncStateNow({ silent: true })).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(state.dailyRecords).toEqual({});
    expect(state.setupCompleted).toBe(false);
    expect(state.clearedAt).toBe(remoteClear.state.clearedAt);
    expect(runtime.stateRevision).toBe(1);
    expect(runtime.dirtyBaseRevision).toBe(null);
    expect(feedback).toHaveBeenCalledWith(expect.stringContaining("另一设备已清空"));
    expect(JSON.parse(values.get("fat-loss-state-v3:unit-user"))).toMatchObject({
      revision: 1,
      dirtyBaseRevision: null,
      state: { clearedAt: remoteClear.state.clearedAt, dailyRecords: {} },
    });
  });

  it("墓碑 marker 重复手动同步不发 PUT，首次真实编辑才移除 marker", async () => {
    const remoteClear = {
      state: { schemaVersion: 3, clearedAt: "2026-08-30T07:00:00.000Z", syncRevision: 5 },
      meals: null,
      updatedAt: "2026-08-30T07:00:00.000Z",
      revision: 5,
    };
    expect(adoptRemoteClear(remoteClear)).toMatchObject({ revision: 5 });
    const fetchMock = vi.fn(async (_url, init) => {
      const body = JSON.parse(init.body);
      expect(body.revision).toBe(5);
      expect(body.dirtyBaseRevision).toBe(5);
      expect(body.state.clearedAt).toBe(undefined);
      expect(body.state.waterMl).toBe(200);
      return new Response(JSON.stringify({ revision: 6, updatedAt: "2026-08-30T07:01:00.000Z" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(syncStateNow({ silent: true })).resolves.toBe(true);
    await expect(syncStateNow({ silent: true })).resolves.toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();

    state.waterMl = 200;
    expect(saveStoredState()).toBe(true);
    clearTimeout(runtime.saveTimer);
    runtime.saveTimer = undefined;
    expect(state.clearedAt).toBe(undefined);
    expect(runtime.dirtyBaseRevision).toBe(5);
    await expect(syncStateNow({ silent: true })).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(runtime.stateRevision).toBe(6);
    expect(runtime.dirtyBaseRevision).toBe(null);
  });

  it("远端墓碑被合法新数据替换后移除本机旧 marker", async () => {
    adoptRemoteClear({
      state: { schemaVersion: 3, clearedAt: "2026-08-30T07:00:00.000Z", syncRevision: 5 },
      meals: null,
      updatedAt: "2026-08-30T07:00:00.000Z",
      revision: 5,
    });
    const remoteState = structuredClone(persistedPayload().state);
    delete remoteState.clearedAt;
    remoteState.weight = 81;
    remoteState.syncRevision = 6;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              state: remoteState,
              meals: structuredClone(initialMealsSnapshot),
              updatedAt: "2026-08-30T07:01:00.000Z",
              revision: 6,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );

    await expect(loadServerState()).resolves.toBe(true);

    expect(state.weight).toBe(81);
    expect(state.clearedAt).toBe(undefined);
    expect(JSON.parse(values.get("fat-loss-state-v3:unit-user")).state.clearedAt).toBe(undefined);
  });
});
