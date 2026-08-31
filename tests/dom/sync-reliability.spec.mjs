import { test, expect } from "@playwright/test";
import { openFreshApp, seedApp, stateSnapshot } from "../helpers/app-fixture.mjs";

test("手动与后台同步共享单次请求", async ({ page }) => {
  let putCount = 0;
  let releasePut;
  let markPutStarted;
  const putStarted = new Promise((resolve) => {
    markPutStarted = resolve;
  });
  const putGate = new Promise((resolve) => {
    releasePut = resolve;
  });
  await page.route("**/api/state", async (route) => {
    if (route.request().method() !== "PUT") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ state: null, meals: null, updatedAt: null, revision: 0 }),
      });
    }
    putCount += 1;
    markPutStarted();
    await putGate;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ revision: 1, updatedAt: "2026-08-09T00:00:01.000Z" }),
    });
  });
  await openFreshApp(page);
  await seedApp(page, { variant: "full", tab: "profile", authenticated: true });

  await page.evaluate(async () => {
    const { syncStateNow } = await import("/src/app-sync.js");
    globalThis.__sharedSyncResults = Promise.all([
      syncStateNow({ silent: true }),
      syncStateNow({ silent: true }),
      syncStateNow({ silent: true }),
    ]);
  });
  await putStarted;
  expect(putCount).toBe(1);
  releasePut();
  const results = await page.evaluate(() => globalThis.__sharedSyncResults);

  expect(results).toEqual([true, true, true]);
  expect(putCount).toBe(1);
  expect((await stateSnapshot(page)).state.backendStatus).toBe("online");
});

test("首个 PUT 期间的多次编辑被合并到第二个 PUT 且不会误报已同步", async ({ page }) => {
  const putBodies = [];
  let releaseFirstPut;
  let markFirstPutStarted;
  const firstPutStarted = new Promise((resolve) => {
    markFirstPutStarted = resolve;
  });
  const firstPutGate = new Promise((resolve) => {
    releaseFirstPut = resolve;
  });
  await page.route("**/api/state", async (route) => {
    if (route.request().method() !== "PUT") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ revision: 0 }) });
    }
    putBodies.push(route.request().postDataJSON());
    if (putBodies.length === 1) {
      markFirstPutStarted();
      await firstPutGate;
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        revision: putBodies.length,
        updatedAt: `2026-08-09T00:00:0${putBodies.length}.000Z`,
      }),
    });
  });
  await openFreshApp(page);
  await seedApp(page, { variant: "full", tab: "home", authenticated: true });

  await page.evaluate(async () => {
    const { syncStateNow } = await import("/src/app-sync.js");
    globalThis.__drainingSync = syncStateNow({ silent: true });
  });
  await firstPutStarted;
  await page.evaluate(async () => {
    const { state } = await import("/src/app-state.js");
    const { saveStoredState } = await import("/src/app-sync.js");
    state.preferences.reminderTime = "20:00";
    saveStoredState();
    state.preferences.reminderTime = "19:00";
    saveStoredState();
  });
  releaseFirstPut();

  expect(await page.evaluate(() => globalThis.__drainingSync)).toBe(true);
  expect(putBodies).toHaveLength(2);
  expect(putBodies[0].state.preferences.reminderTime).toBe("21:30");
  expect(putBodies[1].state.preferences.reminderTime).toBe("19:00");
  expect(putBodies.map((body) => body.revision)).toEqual([0, 1]);
  const localPayload = await page.evaluate(() => JSON.parse(localStorage.getItem("fat-loss-state-v3:e2e-user") || "null"));
  expect(localPayload.state.preferences.reminderTime).toBe("19:00");
  expect(localPayload.revision).toBe(2);
  expect((await stateSnapshot(page)).state.syncPending).toBe(false);
});

test("排空第二轮失败时保留最新本地数据与待同步状态", async ({ page }) => {
  const putBodies = [];
  let releaseFirstPut;
  let markFirstPutStarted;
  const firstPutStarted = new Promise((resolve) => {
    markFirstPutStarted = resolve;
  });
  const firstPutGate = new Promise((resolve) => {
    releaseFirstPut = resolve;
  });
  await page.route("**/api/state", async (route) => {
    if (route.request().method() !== "PUT") return route.fulfill({ status: 200, body: JSON.stringify({ revision: 0 }) });
    putBodies.push(route.request().postDataJSON());
    if (putBodies.length === 1) {
      markFirstPutStarted();
      await firstPutGate;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ revision: 1, updatedAt: "2026-08-09T00:00:01.000Z" }),
      });
    }
    return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "offline" }) });
  });
  await openFreshApp(page);
  await seedApp(page, { variant: "full", tab: "home", authenticated: true });

  await page.evaluate(async () => {
    const { syncStateNow } = await import("/src/app-sync.js");
    globalThis.__failingDrain = syncStateNow({ silent: true });
  });
  await firstPutStarted;
  await page.evaluate(async () => {
    const { state } = await import("/src/app-state.js");
    const { saveStoredState } = await import("/src/app-sync.js");
    state.preferences.reminderTime = "18:00";
    saveStoredState();
  });
  releaseFirstPut();

  expect(await page.evaluate(() => globalThis.__failingDrain)).toBe(false);
  expect(putBodies).toHaveLength(2);
  const localPayload = await page.evaluate(() => JSON.parse(localStorage.getItem("fat-loss-state-v3:e2e-user") || "null"));
  expect(localPayload.state.preferences.reminderTime).toBe("18:00");
  expect(localPayload.revision).toBe(1);
  expect((await stateSnapshot(page)).state.syncPending).toBe(true);
});

test("云端 409 冲突时三方合并无关字段与日期并携带新版本号重试", async ({ page }) => {
  const putBodies = [];
  let serverConflict = { state: null, meals: null, updatedAt: null, revision: 0 };
  await page.route("**/api/state", async (route) => {
    if (route.request().method() !== "PUT") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(serverConflict) });
    }
    putBodies.push(route.request().postDataJSON());
    if (putBodies.length === 1) {
      return route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ error: "云端记录已被其他设备更新", code: "STATE_CONFLICT", conflict: serverConflict }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...putBodies.at(-1),
        state: { ...putBodies.at(-1).state, syncRevision: 4 },
        updatedAt: "2026-08-09T07:00:01.000Z",
        revision: 4,
      }),
    });
  });
  await openFreshApp(page);
  await seedApp(page, { variant: "full", tab: "profile", authenticated: true });
  const basePayload = await page.evaluate(async () => {
    const { persistedPayload } = await import("/src/app-sync.js");
    return persistedPayload();
  });
  serverConflict = {
    state: {
      ...basePayload.state,
      calorieBudget: 2000,
      syncRevision: 3,
      dailyRecords: {
        ...basePayload.state.dailyRecords,
        "2026-08-01": {
          date: "2026-08-01",
          waterMl: 500,
          customActivities: [],
          taskOverrides: {},
          updatedAt: "2026-08-01T12:00:00.000Z",
        },
      },
    },
    meals: basePayload.meals,
    updatedAt: "2026-08-09T07:00:00.000Z",
    revision: 3,
  };

  const result = await page.evaluate(async () => {
    const { state } = await import("/src/app-state.js");
    const { saveStoredState, syncStateNow } = await import("/src/app-sync.js");
    state.preferences.reminderTime = "06:45";
    saveStoredState();
    return syncStateNow({ silent: true });
  });

  expect(result).toBe(true);
  expect(putBodies).toHaveLength(2, "冲突后必须自动合并重试一次");
  expect(putBodies[1].revision).toBe(3, "重试载荷必须携带服务端冲突回传的版本号");
  const snapshot = await stateSnapshot(page);
  expect(snapshot.state.dailyRecords["2026-08-01"].waterMl).toBe(500, "服务端独有的日期必须合并进来");
  expect(snapshot.state.dailyRecords["2026-08-03"]).toBeTruthy();
  expect(snapshot.state.calorieBudget).toBe(2000, "服务端修改的热量目标不能被本机旧值覆盖");
  expect(snapshot.state.preferences.reminderTime).toBe("06:45", "本机修改的提醒时间必须保留");
  expect(snapshot.state.backendStatus).toBe("online");
});

test("清空 tombstone 固定时间并在 409 后仅按新版本重试一次", async ({ page }) => {
  const putBodies = [];
  const conflict = {
    state: { schemaVersion: 3, weight: 84 },
    meals: [],
    updatedAt: "2026-08-09T00:00:03.000Z",
    revision: 3,
  };
  await page.route("**/api/state", async (route) => {
    if (route.request().method() !== "PUT") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(conflict) });
    }
    putBodies.push(route.request().postDataJSON());
    if (putBodies.length === 1) {
      return route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ code: "STATE_CONFLICT", conflict }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        state: { schemaVersion: 3, clearedAt: "2026-08-09T00:00:04.000Z", syncRevision: 4 },
        meals: null,
        revision: 4,
        updatedAt: "2026-08-09T00:00:04.000Z",
      }),
    });
  });
  await openFreshApp(page);
  await seedApp(page, { variant: "full", tab: "profile", authenticated: true });

  await page.locator("[data-clear-data]").click();
  await page.locator("[data-confirm-clear-data]").click();
  await expect(page.locator("[data-confirm-clear-data]")).toHaveCount(0);

  expect(putBodies).toHaveLength(2);
  expect(putBodies.map((body) => body.revision)).toEqual([0, 3]);
  expect(putBodies[1].state.clearedAt).toBe(putBodies[0].state.clearedAt);
  const metadata = await page.evaluate(async () => {
    const { runtime, state } = await import("/src/app-state.js");
    return {
      revision: runtime.stateRevision,
      localUpdatedAt: runtime.localUpdatedAt,
      syncPending: state.syncPending,
      stored: JSON.parse(localStorage.getItem("fat-loss-state-v3:e2e-user") || "null"),
    };
  });
  expect(metadata).toMatchObject({
    revision: 4,
    localUpdatedAt: "2026-08-09T00:00:04.000Z",
    syncPending: false,
    stored: {
      revision: 4,
      dirtyBaseRevision: null,
      state: { clearedAt: "2026-08-09T00:00:04.000Z" },
    },
  });
});

test("普通同步遇到远端清空时不复活旧记录并立即刷新界面", async ({ page }) => {
  const putBodies = [];
  const remoteClear = {
    state: { schemaVersion: 3, clearedAt: "2026-08-09T00:00:05.000Z", syncRevision: 1 },
    meals: null,
    updatedAt: "2026-08-09T00:00:05.000Z",
    revision: 1,
  };
  await page.route("**/api/state", async (route) => {
    if (route.request().method() !== "PUT") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ revision: 0 }) });
    }
    putBodies.push(route.request().postDataJSON());
    return route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ code: "STATE_CONFLICT", conflict: remoteClear }),
    });
  });
  await openFreshApp(page);
  await seedApp(page, { variant: "full", tab: "home", authenticated: true });

  const result = await page.evaluate(async () => {
    const { state } = await import("/src/app-state.js");
    const { saveStoredState, syncStateNow } = await import("/src/app-sync.js");
    state.weight = 91;
    saveStoredState();
    return syncStateNow({ silent: true });
  });

  expect(result).toBe(true);
  expect(putBodies).toHaveLength(1);
  await expect(page.locator("[data-setup-form]")).toBeVisible();
  await expect(page.getByRole("status")).toContainText("另一设备已清空记录");
  const snapshot = await stateSnapshot(page);
  expect(snapshot.state.dailyRecords).toEqual({});
  expect(snapshot.state.clearedAt).toBe(remoteClear.state.clearedAt);
});

test("本机与云端同时写入失败时不作已保存承诺", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/api/state", (route) => {
    if (route.request().method() === "PUT") return route.abort("internetdisconnected");
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await openFreshApp(page);
  await seedApp(page, { variant: "full", tab: "home", authenticated: true });
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("storage full", "QuotaExceededError");
    };
  });

  await page.locator("[data-weight-input]").fill("85.7");
  await page.locator("[data-save-body]").click();
  await expect.poll(async () => (await stateSnapshot(page)).state.syncError, { timeout: 5_000 }).toContain("本机缓存写入失败");
  const snapshot = await stateSnapshot(page);

  expect(snapshot.state.weight).toBe(85.7);
  expect(snapshot.state.syncErrorKind).toBe("storage");
  expect(snapshot.state.syncError).toContain("本机缓存写入失败");
  expect(pageErrors).toEqual([]);
  await expect(page.locator("[data-backend-status]")).not.toContainText("已存本机");
});
