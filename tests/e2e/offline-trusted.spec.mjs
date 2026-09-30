import { test, expect } from "@playwright/test";
import { openFreshApp, seedApp, stateSnapshot } from "../helpers/app-fixture.mjs";

test.use({ serviceWorkers: "allow" });

async function prepareTrustedCache(page, trusted = true) {
  await openFreshApp(page);
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.state)).toBe("activated");
  await seedApp(page, { variant: "full", authenticated: true });
  return page.evaluate(async (enableTrust) => {
    const { storeSession, setOfflineAccessTrusted, writeStoredPayload } = await import("/src/app-storage.js");
    const { storedPayload } = await import("/src/app-data.js");
    storeSession({ accessToken: "verified-test-token", user: { id: "e2e-user", email: "offline@example.test" }, provider: "supabase" });
    if (!setOfflineAccessTrusted(enableTrust)) throw new Error("Could not configure offline test trust");
    const payload = storedPayload();
    if (!writeStoredPayload(payload).ok) throw new Error("Could not cache test records");
    return payload;
  }, trusted);
}

test("受信任设备可真正断网重开、记录，并在验证账号后恢复同步", async ({ page, context }) => {
  let serverData = await prepareTrustedCache(page);
  await page.unroute("**/api/auth/refresh");
  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".bottom-nav")).toBeVisible();
  await expect(page.locator("[data-backend-status-text]").first()).toHaveText("当前离线");
  expect((await stateSnapshot(page)).state.waterMl).toBe(2200);
  await page.getByRole("button", { name: "+200ml", exact: true }).click();
  expect((await stateSnapshot(page)).state.waterMl).toBe(2400);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".bottom-nav")).toBeVisible();
  expect((await stateSnapshot(page)).state.waterMl).toBe(2400);

  const requests = [];
  await page.route("**/api/auth/refresh", (route) => {
    requests.push("refresh");
    return route.fulfill({ json: { accessToken: "revalidated-test-token", user: { id: "e2e-user", email: "offline@example.test" } } });
  });
  await page.route("**/api/state", async (route) => {
    const method = route.request().method();
    requests.push(method);
    if (method === "PUT") {
      expect(route.request().headers().authorization).toBe("Bearer revalidated-test-token");
      const payload = route.request().postDataJSON();
      serverData = { ...payload, revision: payload.revision + 1, updatedAt: "2026-08-09T01:00:00.000Z" };
    }
    await route.fulfill({ json: serverData });
  });
  await context.setOffline(false);
  // CDP toggles request transport; explicitly deliver the browser's network
  // event too, matching the existing reconnect acceptance tests.
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(async () => (await stateSnapshot(page)).state.syncPending).toBe(false);
  await expect(page.locator("[data-backend-status-text]").first()).toHaveText("已同步");
  expect(serverData.state.waterMl).toBe(2400);
  expect(requests.indexOf("refresh")).toBeLessThan(requests.indexOf("GET"));
  expect(requests.indexOf("GET")).toBeLessThan(requests.indexOf("PUT"));
});

test("未授权信任设备时，断网重开不展示健康缓存", async ({ page, context }) => {
  await prepareTrustedCache(page, false);
  await page.unroute("**/api/auth/refresh");
  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("[data-auth-form]")).toBeVisible();
  await expect(page.locator(".bottom-nav")).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("fat-loss-state-v3:e2e-user"))).not.toBeNull();
});

test("认证服务暂时故障可使用受信任缓存，但不发起数据写入", async ({ page }) => {
  await prepareTrustedCache(page);
  await page.route("**/api/auth/refresh", (route) => route.fulfill({ status: 503, json: { error: "temporarily unavailable" } }));
  const dataRequests = [];
  await page.route("**/api/state", (route) => {
    dataRequests.push(route.request().method());
    return route.abort();
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".bottom-nav")).toBeVisible();
  expect((await stateSnapshot(page)).state.backendStatus).toBe("offline");
  expect(dataRequests).toEqual([]);
});

for (const status of [204, 401, 403]) {
  test(`服务器确认会话无效（${status}）后撤销离线信任`, async ({ page }) => {
    await prepareTrustedCache(page);
    await page.route("**/api/auth/refresh", (route) => route.fulfill({ status }));
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("[data-auth-form]")).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("fat-loss-offline-access-v1:e2e-user"))).toBeNull();
    await page.route("**/api/auth/refresh", (route) => route.abort());
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("[data-auth-form]")).toBeVisible();
    await expect(page.locator(".bottom-nav")).toHaveCount(0);
  });
}

test("离线重连返回其他账号时，不把原账号记录上传到新账号", async ({ page, context }) => {
  await prepareTrustedCache(page);
  await page.unroute("**/api/auth/refresh");
  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".bottom-nav")).toBeVisible();
  await page.getByRole("button", { name: "+200ml", exact: true }).click();
  const writes = [];
  await page.route("**/api/state", (route) => {
    writes.push(route.request().method());
    return route.abort();
  });
  await page.route("**/api/auth/refresh", (route) =>
    route.fulfill({ json: { accessToken: "different-user-token", user: { id: "different-user" } } }),
  );
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.locator("[data-auth-form]")).toBeVisible();
  expect(writes).toEqual([]);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("fat-loss-state-v3:e2e-user")).state.waterMl)).toBe(2400);
});
