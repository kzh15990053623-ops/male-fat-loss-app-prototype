import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { openFreshApp, seedApp, setTab, stateSnapshot } from "../helpers/app-fixture.mjs";

test("导入等待恢复前备份时切换账号，不把原账号备份写入新账号", async ({ page }) => {
  await openFreshApp(page);
  await seedApp(page, { variant: "empty", tab: "profile", authenticated: true });
  const backup = await page.evaluate(async () => ({
    user: { id: "e2e-user" },
    data: (await import("/src/app-sync.js")).persistedPayload(),
  }));
  let reading;
  let downloads = 0;
  page.on("download", () => downloads++);
  page.on("dialog", (dialog) => dialog.accept());
  await page.route("**/api/history?limit=*", (route) => {
    reading = route;
  });
  await page
    .locator("[data-import-backup-file]")
    .setInputFiles({ name: "account-a.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(backup)) });
  await expect.poll(() => Boolean(reading)).toBe(true);
  await page.evaluate(async () => {
    const { storeSession } = await import("/src/app-storage.js");
    const { state } = await import("/src/app-state.js");
    storeSession({ provider: "supabase", accessToken: "account-b-token", user: { id: "account-b" } });
    state.weight = 66;
    state.dailyRecords = {};
  });
  await reading.fulfill({ json: { rows: [], next: null } });
  await expect.poll(async () => (await stateSnapshot(page)).state.toast).toContain("恢复前备份未完成");
  expect((await stateSnapshot(page)).state.weight).toBe(66);
  expect((await stateSnapshot(page)).state.dailyRecords).toEqual({});
  expect(downloads).toBe(0);
  expect(await page.evaluate(async () => (await (await import("/src/history-store.js")).readLocalHistory()).length)).toBe(0);
});

test("另一设备清空后，待同步历史经过主档案清空合并，旧记录不会复活", async ({ page }) => {
  await openFreshApp(page);
  await seedApp(page, { variant: "empty", authenticated: true });
  const cleared = {
    state: { schemaVersion: 3, clearedAt: "2026-08-10T00:00:00.000Z", syncRevision: 2 },
    meals: null,
    revision: 2,
    updatedAt: "2026-08-10T00:00:00.000Z",
  };
  await page.route("**/api/history?date=*", (route) => route.fulfill({ json: { rows: [] } }));
  await page.route("**/api/history", (route) => route.fulfill({ status: 409, json: { code: "STATE_CLEARED", conflict: cleared } }));
  await page.route("**/api/state", (route) => route.fulfill({ status: 409, json: { conflict: cleared } }));
  const result = await page.evaluate(async () => {
    const { runtime, state } = await import("/src/app-state.js");
    const { saveHistoryEdit, readLocalHistory } = await import("/src/history-store.js");
    const { syncStateNow } = await import("/src/app-sync.js");
    runtime.stateRevision = 1;
    runtime.localUpdatedAt = "2026-08-09T00:00:00.000Z";
    state.dailyRecords["2020-01-01"] = { date: "2020-01-01", weight: 80 };
    await saveHistoryEdit("2020-01-01", state.dailyRecords["2020-01-01"]);
    const synced = await syncStateNow();
    return { synced, archive: await readLocalHistory(), clearedAt: state.clearedAt, revision: runtime.stateRevision };
  });
  expect(result).toEqual({ synced: true, archive: [], clearedAt: cleared.state.clearedAt, revision: 2 });
});

test("IndexedDB 不可用时保留永久归档与待同步修改", async ({ page }) => {
  await openFreshApp(page);
  await seedApp(page, { variant: "empty" });
  const result = await page.evaluate(async () => {
    Object.defineProperty(globalThis, "indexedDB", { value: undefined, configurable: true });
    const { runtime } = await import("/src/app-state.js");
    runtime.authUserId = "fallback-user";
    const { archiveSnapshot, saveHistoryEdit, readLocalHistory } = await import("/src/history-store.js");
    await archiveSnapshot({ state: { dailyRecords: { "2020-01-01": { date: "2020-01-01", weight: 80 } } } });
    await saveHistoryEdit("2020-01-01", { date: "2020-01-01", weight: 75 });
    return (await readLocalHistory())[0];
  });
  expect(result.record.weight).toBe(75);
  expect(result.pending).toBe(true);
  await page.route("**/api/history?date=*", (route) =>
    route.fulfill({ json: { rows: [{ date: "2020-01-01", record: { date: "2020-01-01", weight: 80 }, revision: 1 }] } }),
  );
  await page.route("**/api/history", (route) =>
    route.fulfill({ status: 409, json: { conflict: { record: { date: "2020-01-01", weight: 70 }, revision: 2 } } }),
  );
  const conflict = await page.evaluate(async () => {
    const { flushHistoryEdits, readLocalHistory, resolveHistoryConflict } = await import("/src/history-store.js");
    await flushHistoryEdits().catch(() => {});
    const saved = (await readLocalHistory())[0];
    await resolveHistoryConflict("2020-01-01", "local");
    return { saved, resolved: (await readLocalHistory())[0] };
  });
  expect(conflict.saved.conflict.record.weight).toBe(70);
  expect(conflict.saved.record.weight).toBe(75);
  expect(conflict.resolved).toMatchObject({ record: { weight: 75 }, revision: 2, pending: true });
  expect(conflict.resolved.conflict).toBeUndefined();
  const adopted = await page.evaluate(async () => {
    const { state } = await import("/src/app-state.js");
    state.weightLogs = [{ date: "2020-01-01", value: 75 }];
    const { flushHistoryEdits, resolveHistoryConflict } = await import("/src/history-store.js");
    await flushHistoryEdits().catch(() => {});
    await resolveHistoryConflict("2020-01-01", "remote");
    return state.weightLogs.find((item) => item.date === "2020-01-01").value;
  });
  expect(adopted).toBe(70);
});

test("完整备份在新账号首次同步后保留 400 天历史和云端版本基线", async ({ page }) => {
  test.setTimeout(60000);
  await openFreshApp(page);
  await seedApp(page, { variant: "empty", tab: "profile", authenticated: true });
  let server = { state: null, meals: null, revision: 0 };
  const history = new Map();
  const updatedAt = "2026-08-09T00:00:01.000Z";
  await page.route("**/api/state", async (route) => {
    if (route.request().method() === "PUT") {
      const payload = route.request().postDataJSON();
      if (payload.revision !== server.revision) return route.fulfill({ status: 409, json: { conflict: server } });
      for (const [date, record] of Object.entries(payload.state.dailyRecords)) {
        if (JSON.stringify(server.state?.dailyRecords?.[date]) !== JSON.stringify(record))
          history.set(date, { date, record, revision: (history.get(date)?.revision || 0) + 1 });
      }
      server = { state: payload.state, meals: payload.meals, revision: server.revision + 1, updatedAt };
    }
    await route.fulfill({ json: server });
  });
  await page.route("**/api/history**", async (route) => {
    if (route.request().method() === "PUT") {
      expect(server.state).not.toBeNull();
      const payload = route.request().postDataJSON();
      const previous = history.get(payload.date);
      if (payload.revision !== (previous?.revision || 0)) return route.fulfill({ status: 409, json: { conflict: previous } });
      const row = { ...payload, revision: payload.revision + 1 };
      history.set(row.date, row);
      server.revision++;
      server.updatedAt = updatedAt;
      if (server.state.dailyRecords[row.date]) server.state.dailyRecords[row.date] = row.record;
      return route.fulfill({ json: row });
    }
    const date = new URL(route.request().url()).searchParams.get("date");
    return route.fulfill({ json: { rows: date && history.has(date) ? [history.get(date)] : [], next: "" } });
  });
  const backup = await page.evaluate(async () => {
    const { persistedPayload, updateTodayRecord } = await import("/src/app-sync.js");
    updateTodayRecord();
    const data = persistedPayload();
    data.state.dailyRecords = {
      ...data.state.dailyRecords,
      ...Object.fromEntries(
        Array.from({ length: 400 }, (_, index) => {
          const date = new Date(Date.UTC(2020, 0, index + 1)).toISOString().slice(0, 10);
          return [date, { date, weight: 80 + index / 100, intakeStatus: "unknown" }];
        }),
      ),
    };
    data.state.dailyRecords["2026-08-09"].updatedAt = "2026-08-09T00:00:00.000Z";
    return { user: { id: "e2e-user" }, data };
  });
  page.on("dialog", (dialog) => dialog.accept());
  const download = page.waitForEvent("download");
  await page
    .locator("[data-import-backup-file]")
    .setInputFiles({ name: "complete.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(backup)) });
  await download;
  await expect.poll(async () => (await stateSnapshot(page)).state.toast, { timeout: 20000 }).toContain("备份已恢复");
  const restored = await page.evaluate(async () => {
    const { runtime, state } = await import("/src/app-state.js");
    const { syncStateNow } = await import("/src/app-sync.js");
    const { readLocalHistory } = await import("/src/history-store.js");
    clearTimeout(runtime.saveTimer);
    for (let index = 0; index < 3; index++) {
      await syncStateNow();
      clearTimeout(runtime.retryTimer);
      if (!state.syncPending) break;
    }
    return { rows: await readLocalHistory(), pending: state.syncPending, revision: runtime.stateRevision };
  });
  expect(restored.rows.filter((row) => row.date.startsWith("2020") || row.date.startsWith("2021"))).toHaveLength(400);
  expect(restored.rows.find((row) => row.date === "2020-01-01").record.weight).toBe(80);
  expect(restored.rows.some((row) => row.pending)).toBe(false);
  expect(restored.pending).toBe(false);
  expect(restored.revision).toBe(server.revision);
  expect(history.get("2020-01-01").record.weight).toBe(80);
});

test("读取历史基线期间切换账号，不把旧账号记录写到新账号", async ({ page }) => {
  await openFreshApp(page);
  await seedApp(page, { variant: "empty" });
  let lookup;
  let writes = 0;
  await page.route("**/api/history?date=*", (route) => {
    lookup = route;
  });
  page.on("request", (request) => {
    if (request.url().endsWith("/api/history") && request.method() === "PUT") writes++;
  });
  await page.evaluate(async () => {
    const { storeSession } = await import("/src/app-storage.js");
    const { saveHistoryEdit } = await import("/src/history-store.js");
    storeSession({ provider: "supabase", accessToken: "account-a-token", user: { id: "account-a" } });
    await saveHistoryEdit("2020-01-01", { date: "2020-01-01", weight: 80 });
  });
  const flushing = page.evaluate(async () => {
    const { flushHistoryEdits } = await import("/src/history-store.js");
    try {
      await flushHistoryEdits();
      return "success";
    } catch (error) {
      return error.kind;
    }
  });
  await expect.poll(() => Boolean(lookup)).toBe(true);
  await page.evaluate(async () => {
    const { storeSession } = await import("/src/app-storage.js");
    storeSession({ provider: "supabase", accessToken: "account-b-token", user: { id: "account-b" } });
  });
  await lookup.fulfill({ json: { rows: [{ date: "2020-01-01", revision: 1, record: { date: "2020-01-01", weight: 75 } }] } });
  expect(await flushing).toBe("stale-session");
  expect(writes).toBe(0);
});

async function record(page, food, calories = 0) {
  await page.locator("[data-meal-food]").fill(food);
  await page.locator(".advanced-fields").evaluate((el) => (el.open = true));
  await page.locator("[data-meal-calories]").fill(String(calories));
  await page.locator("[data-add-meal]").click();
}
test("同餐追加、营养待补充、编辑和删除分别保留其他条目", async ({ page }) => {
  await openFreshApp(page);
  await seedApp(page, { variant: "empty", tab: "diet" });
  await page.locator("[data-meal-slot]").selectOption("lunch");
  await record(page, "米饭", 500);
  await record(page, "牛奶");
  let data = await stateSnapshot(page);
  let lunch = data.meals.find((meal) => meal.id === "lunch");
  expect(lunch.entries.map((e) => e.food)).toEqual(["米饭", "牛奶"]);
  expect(lunch.calories).toBe(500);
  await expect(page.locator(".meal-list")).toContainText("营养待补充");
  await page.locator(`[data-edit-meal-entry="${lunch.entries[1].id}"]`).click();
  await page.locator("[data-meal-calories]").fill("120");
  await page.locator("[data-add-meal]").click();
  lunch = (await stateSnapshot(page)).meals.find((meal) => meal.id === "lunch");
  expect(lunch.calories).toBe(620);
  expect(lunch.entries).toHaveLength(2);
  await page.locator(`[data-delete-meal-entry="${lunch.entries[0].id}"]`).click();
  lunch = (await stateSnapshot(page)).meals.find((meal) => meal.id === "lunch");
  expect(lunch.calories).toBe(120);
  expect(lunch.entries[0].deletedAt).toBeTruthy();
});
test("补录过去日期保留今天草稿，身体指标修改只影响选定日期", async ({ page }) => {
  await openFreshApp(page);
  await seedApp(page, { variant: "empty", tab: "diet" });
  await page.locator("[data-meal-food]").fill("今天未完成的草稿");
  await page.locator("[data-meal-date]").fill("2026-08-08");
  await expect(page.locator("[data-meal-food]")).toHaveValue("");
  await record(page, "昨晚的面条", 450);
  await page.locator("[data-meal-date]").fill("2026-08-09");
  await expect(page.locator("[data-meal-food]")).toHaveValue("今天未完成的草稿");
  const before = await stateSnapshot(page);
  await setTab(page, "data");
  await page.locator('[name="history-date"]').fill("2026-08-08");
  await page.locator('[name="history-weight"]').fill("82");
  await page.locator("[data-history-metrics] button").click();
  const after = await stateSnapshot(page);
  expect(after.state.weight).toBe(before.state.weight);
  expect(after.state.dailyRecords["2026-08-08"].weight).toBe(82);
  expect(after.state.dailyRecords["2026-08-08"].meals.some((meal) => meal.foods.includes("昨晚的面条"))).toBe(true);
});
test("归档保留超过近期窗口的完整历史，账号切换隔离，备份结构错误不修改记录", async ({ page }) => {
  await openFreshApp(page);
  await seedApp(page, { variant: "empty", tab: "profile" });
  const result = await page.evaluate(async () => {
    const { runtime, state } = await import("/src/app-state.js");
    const { archiveSnapshot, readLocalHistory } = await import("/src/history-store.js");
    const { storeSession } = await import("/src/app-storage.js");
    storeSession({ provider: "supabase", accessToken: "", user: { id: "archive-a" } });
    const records = Object.fromEntries(
      Array.from({ length: 400 }, (_, index) => {
        const date = new Date(Date.UTC(2020, 0, index + 1)).toISOString().slice(0, 10);
        return [date, { date, weight: 80 }];
      }),
    );
    await archiveSnapshot({ state: { dailyRecords: records } });
    const count = (await readLocalHistory()).length;
    runtime.historyRows = [{ date: "2020-01-01", record: records["2020-01-01"] }];
    storeSession({ provider: "supabase", accessToken: "", user: { id: "archive-b" } });
    const isolated = { count: (await readLocalHistory()).length, cache: runtime.historyRows.length };
    storeSession({ provider: "supabase", accessToken: "", user: { id: "archive-a" } });
    state.authRequired = false;
    return { count, isolated };
  });
  expect(result).toEqual({ count: 400, isolated: { count: 0, cache: 0 } });
  const downloadPromise = page.waitForEvent("download");
  await page.locator("[data-export-data]").click();
  const download = await downloadPromise;
  const backup = JSON.parse(await readFile(await download.path(), "utf8"));
  expect(Object.keys(backup.data.state.dailyRecords).length).toBeGreaterThanOrEqual(400);
  const before = await stateSnapshot(page);
  await page.locator("[data-import-backup-file]").setInputFiles({
    name: "broken.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ data: { state: { schemaVersion: 3, dailyRecords: {} }, meals: [] } })),
  });
  expect((await stateSnapshot(page)).state.dailyRecords).toEqual(before.state.dailyRecords);
});
test("默认邮件回跳清除地址中的凭证并进入密码恢复，不写入登录令牌", async ({ page }) => {
  let profileRead;
  await page.route("**/api/auth/refresh", (route) => route.fulfill({ status: 204 }));
  await page.route("**/api/auth/callback", (route) =>
    route.fulfill({ json: { provider: "supabase", accessToken: "callback-access", user: { id: "recovery-user" } } }),
  );
  await page.route("**/api/state", (route) => {
    profileRead = route;
  });
  await page.route("**/api/readiness*", (route) =>
    route.fulfill({ json: { ok: true, auth: { ready: true, signupAllowed: true, code: "AUTH_READY" } } }),
  );
  await page.goto("/?auth=callback#type=recovery&refresh_token=controlled-test-refresh-token&access_token=controlled-test-access-token");
  await expect(page.locator("[data-password-recovery]")).toBeVisible();
  expect(page.url()).not.toContain("token");
  expect(await page.evaluate(() => JSON.stringify(Object.fromEntries(Object.entries(localStorage))))).not.toMatch(
    /callback-access|controlled-test-refresh-token/,
  );
  await page.route("**/api/auth/password", (route) => route.fulfill({ json: { ok: true } }));
  await page.locator('[name="new-password"]').fill("NewPassword123");
  await expect.poll(() => Boolean(profileRead)).toBe(true);
  await profileRead.fulfill({ json: { state: null, meals: null, revision: 0 } });
  await expect.poll(() => page.evaluate(async () => (await import("/src/app-state.js")).runtime.offlineSyncReadRequired)).toBe(false);
  await expect(page.locator('[name="new-password"]')).toHaveValue("NewPassword123");
  await page.locator('[name="confirm-password"]').fill("DifferentPassword123");
  await page.locator("[data-password-recovery] button").click();
  await expect(page.locator("[data-password-feedback]")).toContainText("两次密码不一致");
  await expect(page.locator('[name="new-password"]')).toHaveValue("NewPassword123");
  await page.locator('[name="confirm-password"]').fill("NewPassword123");
  await page.locator("[data-password-recovery] button").click();
  await expect(page.locator("[data-password-recovery]")).toHaveCount(0);
});
