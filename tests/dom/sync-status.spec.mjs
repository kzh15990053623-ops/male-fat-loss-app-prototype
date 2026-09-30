import { test, expect } from "@playwright/test";
import { openFreshApp, seedApp, stateSnapshot } from "../helpers/app-fixture.mjs";

const STATUS_CASES = [
  { status: "idle", text: "等待登录", retryable: false, busy: false },
  { status: "connecting", text: "连接中…", retryable: false, busy: true },
  { status: "saving", text: "保存中…", retryable: false, busy: true },
  { status: "online", text: "已同步", retryable: false, busy: false },
  { status: "device", text: "本机模式", retryable: false, busy: false },
  { status: "local", text: "已存本机，等待同步", retryable: true, busy: false },
  { status: "offline", text: "当前离线", retryable: true, busy: false },
];

async function applyBackendStatus(page, status, errorKind = "none") {
  await page.evaluate(
    async ({ nextStatus, nextErrorKind }) => {
      const { state } = await import("/src/app-state.js");
      const { setBackendStatus } = await import("/src/app-sync.js");
      state.syncErrorKind = nextErrorKind;
      setBackendStatus(nextStatus);
    },
    { nextStatus: status, nextErrorKind: errorKind },
  );
}

test("七种同步状态增量更新文案、重试入口与忙碌态", async ({ page }) => {
  await openFreshApp(page);
  await seedApp(page, { variant: "full", tab: "profile", authenticated: true });

  const statusRoot = page.locator("[data-backend-status]");
  const statusText = page.locator("[data-backend-status-text]");
  const retryButton = page.locator("[data-sync-retry]");
  const manualSyncButton = page.locator("[data-sync-now]:not([data-sync-retry])");

  await statusRoot.evaluate((element) => {
    element.dataset.incrementalMarker = "preserved";
  });

  for (const scenario of STATUS_CASES) {
    await applyBackendStatus(page, scenario.status, scenario.status === "offline" ? "network" : "none");
    await expect(statusRoot, scenario.status).toHaveAttribute("data-status", scenario.status);
    await expect(statusRoot, scenario.status).toHaveAttribute("aria-busy", String(scenario.busy));
    await expect(statusRoot, scenario.status).toHaveAttribute("data-incremental-marker", "preserved");
    await expect(statusText, scenario.status).toHaveText(scenario.text);
    await expect(manualSyncButton, scenario.status).toHaveAttribute("aria-busy", String(scenario.busy));

    if (scenario.retryable) {
      await expect(retryButton, scenario.status).toBeVisible();
      await expect(retryButton, scenario.status).toBeEnabled();
      await expect(retryButton, scenario.status).toHaveAttribute("aria-busy", "false");
    } else {
      await expect(retryButton, scenario.status).toBeHidden();
      await expect(retryButton, scenario.status).toBeDisabled();
    }

    if (scenario.busy) await expect(manualSyncButton, scenario.status).toBeDisabled();
    else await expect(manualSyncButton, scenario.status).toBeEnabled();
  }

  await applyBackendStatus(page, "offline", "storage");
  await expect(statusText).toHaveText("保存失败");
  await expect(retryButton).toHaveAttribute("aria-label", "重试保存");
});

test("并发同步共享一个请求且忙碌态原位恢复", async ({ page }) => {
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
    globalThis.__syncStatusResults = Promise.all([
      syncStateNow({ silent: true }),
      syncStateNow({ silent: true }),
      syncStateNow({ silent: true }),
    ]);
  });

  await putStarted;
  await expect(page.locator("[data-backend-status-text]")).toHaveText("保存中…");
  await expect(page.locator("[data-backend-status]")).toHaveAttribute("aria-busy", "true");
  const manualSync = page.locator("[data-sync-now]:not([data-sync-retry])");
  await expect(manualSync).toBeDisabled();
  await expect(manualSync).toHaveClass(/is-sync-busy/);
  await expect(manualSync.locator("[data-sync-manual-label]")).toHaveText("同步中…");

  releasePut();
  const results = await page.evaluate(() => globalThis.__syncStatusResults);
  expect(results).toEqual([true, true, true]);
  expect(putCount).toBe(1);
  await expect(page.locator("[data-backend-status-text]")).toHaveText("已同步");
  await expect(page.locator("[data-backend-status]")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator("[data-sync-retry]")).toBeHidden();
  await expect(manualSync).toBeEnabled();
  await expect(manualSync).not.toHaveClass(/is-sync-busy/);
  await expect(manualSync.locator("[data-sync-manual-label]")).toHaveText("重试同步");
});

test("本机缓存不可用时仍可回退到云端且不伪装本机已保存", async ({ page }) => {
  let putCount = 0;
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/api/state", (route) => {
    if (route.request().method() === "PUT") putCount += 1;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ revision: 1, updatedAt: "2026-08-09T00:00:01.000Z" }),
    });
  });
  await openFreshApp(page);
  await seedApp(page, { variant: "full", tab: "profile", authenticated: true });
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("storage blocked", "SecurityError");
    };
  });

  const result = await page.evaluate(async () => {
    const { syncStateNow } = await import("/src/app-sync.js");
    return syncStateNow({ silent: true });
  });
  const snapshot = await stateSnapshot(page);

  expect(result).toBe(true);
  expect(putCount).toBe(1);
  expect(snapshot.state.backendStatus).toBe("online");
  expect(snapshot.state.syncErrorKind).toBe("storage");
  expect(snapshot.state.syncError).toContain("云端已同步，但本机缓存写入失败");
  expect(pageErrors).toEqual([]);
  await expect(page.locator("[data-backend-status-text]")).toHaveText("已同步");
  await expect(page.locator("[data-backend-status]")).not.toContainText("已存本机");
  await expect(page.locator("[data-sync-retry]")).toBeHidden();
});
