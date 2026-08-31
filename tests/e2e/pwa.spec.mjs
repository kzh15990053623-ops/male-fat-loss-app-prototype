import { test, expect } from "@playwright/test";

test.use({ serviceWorkers: "allow" });

test("PWA 应用壳安装后可在离线状态重新打开", async ({ page, context }) => {
  await page.route("**/api/auth/refresh", (route) => route.fulfill({ status: 204 }));
  await page.route("**/api/readiness*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, auth: { ready: true, signupAllowed: true, code: "AUTH_READY", message: "认证服务已连接。" } }),
    }),
  );
  await page.goto("/", { waitUntil: "load" });
  await expect(page.locator("[data-auth-form]")).toBeVisible();

  await expect
    .poll(
      async () =>
        page.evaluate(async () => {
          const registration = await navigator.serviceWorker.ready;
          return registration.active?.state || "missing";
        }),
      { timeout: 10_000 },
    )
    .toBe("activated");

  const manifest = await page.evaluate(async () => fetch("/manifest.webmanifest").then((response) => response.json()));
  expect(manifest).toMatchObject({ display: "standalone", background_color: "#F2F0E9", theme_color: "#102A3A" });
  expect(manifest.icons.some((item) => item.sizes === "192x192")).toBe(true);
  expect(manifest.icons.some((item) => item.sizes === "512x512")).toBe(true);

  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("[data-auth-form]")).toBeVisible();
  await context.setOffline(false);
});

test("同源 query 变体不写入应用壳缓存，API 请求仍不缓存", async ({ page }) => {
  await page.route("**/api/auth/refresh", (route) => route.fulfill({ status: 204 }));
  await page.route("**/api/readiness*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, auth: { ready: true, signupAllowed: true, code: "AUTH_READY", message: "认证服务已连接。" } }),
    }),
  );
  await page.goto("/", { waitUntil: "load" });
  await expect(page.locator("[data-auth-form]")).toBeVisible();
  await expect
    .poll(async () => page.evaluate(async () => (await navigator.serviceWorker.ready).active?.state || "missing"), { timeout: 10_000 })
    .toBe("activated");

  const marker = `sw-query-${Date.now()}`;
  await page.evaluate(async (queryMarker) => {
    await Promise.all([
      fetch(`/index.html?${queryMarker}=one`).then((response) => response.text()),
      fetch(`/index.html?${queryMarker}=two`).then((response) => response.text()),
      fetch(`/api/health?${queryMarker}=api`).then((response) => response.text()),
    ]);
  }, marker);

  const cachedUrls = await page.evaluate(async () => {
    const urls = [];
    for (const cacheName of await caches.keys()) {
      const requests = await caches.open(cacheName).then((cache) => cache.keys());
      requests.forEach((request) => urls.push(request.url));
    }
    return urls;
  });
  expect(cachedUrls.some((url) => url.includes(marker))).toBe(false);
  expect(cachedUrls.some((url) => url.includes("/api/"))).toBe(false);
});
