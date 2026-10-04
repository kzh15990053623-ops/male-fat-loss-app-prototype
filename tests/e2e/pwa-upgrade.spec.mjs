import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { serveStaticRequest } from "../../server/static.mjs";
test.use({ serviceWorkers: "allow" });

test("HTTP 500 回退缓存，升级等待所有标签页且各自保留草稿", async ({ page, context }) => {
  const original = await readFile(new URL("../../sw.js", import.meta.url), "utf8");
  let generation = "old";
  let fail = false;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname.startsWith("/api/")) {
      res.writeHead(204);
      res.end();
      return;
    }
    if (url.pathname === "/sw.js") {
      res.writeHead(200, { "Content-Type": "text/javascript", "Cache-Control": "no-store" });
      res.end(original.replace(/fitness-fat-loss-app-shell-v\d+/, "fitness-fat-loss-app-shell-test-" + generation));
      return;
    }
    if (fail) {
      res.writeHead(500);
      res.end("unavailable");
      return;
    }
    await serveStaticRequest(req, res, url);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = "http://127.0.0.1:" + server.address().port;
  try {
    await page.goto(origin);
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.state)).toBe("activated");
    fail = true;
    await page.reload();
    await expect(page.locator("[data-auth-form]")).toBeVisible();
    fail = false;
    const second = await context.newPage();
    await second.goto(origin);
    for (const [tab, food] of [
      [page, "第一个标签页的草稿"],
      [second, "第二个标签页的草稿"],
    ])
      await tab.evaluate(async (food) => {
        const { state, runtime } = await import("/src/app-state.js");
        const { storeSession } = await import("/src/app-storage.js");
        const { render } = await import("/src/app-actions.js");
        storeSession({ provider: "supabase", accessToken: "", user: { id: "upgrade-user" } });
        state.authRequired = false;
        state.setupCompleted = true;
        state.mealDraft.food = food;
        state.activeTab = "profile";
        runtime.offlineSyncReadRequired = true;
        render();
      }, food);
    generation = "new";
    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      await reg.update();
    });
    await expect.poll(() => page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration()).waiting))).toBe(true);
    await second.evaluate(async () => {
      const { state } = await import("/src/app-state.js");
      state.mealDraft.aiStatus = "submitting";
    });
    await page.evaluate(async () => {
      const { updatePwa } = await import("/src/actions/product-support.js");
      await updatePwa();
    });
    await expect(page.locator(".toast-banner")).toContainText("有标签页");
    expect(await page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration()).waiting))).toBe(true);
    await second.evaluate(async () => {
      const { state } = await import("/src/app-state.js");
      state.mealDraft.aiStatus = "idle";
    });
    const reloads = [page.waitForEvent("load"), second.waitForEvent("load")];
    await page.evaluate(async () => {
      const { updatePwa } = await import("/src/actions/product-support.js");
      await updatePwa();
    });
    await Promise.all(reloads);
    await expect.poll(() => page.evaluate(() => caches.keys())).toContain("fitness-fat-loss-app-shell-test-new");
    for (const [tab, food] of [
      [page, "第一个标签页的草稿"],
      [second, "第二个标签页的草稿"],
    ]) {
      await expect
        .poll(() => tab.evaluate(() => JSON.parse(sessionStorage.getItem("wenjian-upgrade-draft") || "null")?.draft.food))
        .toBe(food);
      const restored = await tab.evaluate(async () => {
        const { runtime, state } = await import("/src/app-state.js");
        const { restoreUpgradeDraft } = await import("/src/app-storage.js");
        runtime.authUserId = "upgrade-user";
        restoreUpgradeDraft();
        return state.mealDraft.food;
      });
      expect(restored).toBe(food);
    }
    await second.close();
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
