import { test, expect } from "@playwright/test";

test.use({ serviceWorkers: "allow" });

async function prepareInstalledAppShell(page, entryUrl) {
  await page.route("**/api/auth/refresh", (route) => route.fulfill({ status: 204 }));
  await page.route("**/api/readiness*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, auth: { ready: true, signupAllowed: true, code: "AUTH_READY", message: "认证服务已连接。" } }),
    }),
  );
  await page.goto(entryUrl, { waitUntil: "load" });
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
  await expect
    .poll(async () => page.evaluate(() => navigator.serviceWorker.controller?.state || "missing"), { timeout: 10_000 })
    .toBe("activated");
}

async function expectOfflineReload({ page, context }) {
  const expectedUrl = page.url();

  await context.setOffline(true);
  try {
    await page.reload({ waitUntil: "domcontentloaded" });
    expect(page.url()).toBe(expectedUrl);
    await expect(page.locator("[data-auth-form]")).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
}

test("PWA 应用壳安装后可在离线状态重新打开", async ({ page, context }) => {
  await prepareInstalledAppShell(page, "/");

  const manifest = await page.evaluate(async () => fetch("/manifest.webmanifest").then((response) => response.json()));
  expect(manifest).toMatchObject({ display: "standalone", background_color: "#F2F0E9", theme_color: "#102A3A" });
  expect(manifest.icons.some((item) => item.sizes === "192x192")).toBe(true);
  expect(manifest.icons.some((item) => item.sizes === "512x512")).toBe(true);

  await expectOfflineReload({ page, context });
});

for (const [entryName, entryUrl] of [
  ["根入口带 query", "/?offline-entry=1"],
  ["index.html 带 query", "/index.html?foo=1"],
]) {
  test(`${entryName} navigation 可离线回退到应用壳`, async ({ page, context }) => {
    await prepareInstalledAppShell(page, entryUrl);
    await expectOfflineReload({ page, context });
  });
}

test("同源 query 变体不写入应用壳缓存，API 请求仍不缓存", async ({ page }) => {
  await prepareInstalledAppShell(page, "/");

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
  expect(cachedUrls).toContain(new URL("/index.html", page.url()).href);
  expect(cachedUrls.some((url) => url.includes(marker))).toBe(false);
  expect(cachedUrls.some((url) => url.includes("/api/"))).toBe(false);
});
