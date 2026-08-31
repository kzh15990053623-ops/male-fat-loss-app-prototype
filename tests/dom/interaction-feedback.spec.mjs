import { test, expect } from "@playwright/test";
import { openFreshApp, seedApp, stateSnapshot } from "../helpers/app-fixture.mjs";

function nutritionResult(overrides = {}) {
  return {
    requestId: "req_interaction_feedback",
    source: "model",
    model: "nutrition-lab-1",
    confidence: 0.92,
    needsReview: false,
    assumptions: [],
    warnings: [],
    details: [{ name: "测试餐", grams: 400, calories: 640, protein: 42, carbs: 70, fat: 18, confidence: 0.9 }],
    calories: 640,
    protein: 42,
    carbs: 70,
    fat: 18,
    ...overrides,
  };
}

async function installDeferredNutritionFetch(page) {
  await page.evaluate(() => {
    const originalFetch = window.fetch.bind(window);
    window.__nutritionRequests = [];
    window.fetch = (input, init = {}) => {
      const url = input instanceof Request ? input.url : String(input);
      if (!url.includes("/api/ai/nutrition")) return originalFetch(input, init);
      return new Promise((resolve) => {
        window.__nutritionRequests.push({
          body: init.body || "",
          signal: init.signal || null,
          resolve,
        });
      });
    };
  });
}

async function resolveNutritionRequest(page, index, result) {
  await page.evaluate(
    ({ requestIndex, payload }) => {
      const request = window.__nutritionRequests?.[requestIndex];
      if (!request) throw new Error(`AI request ${requestIndex} is not pending`);
      request.resolve(
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    },
    { requestIndex: index, payload: result },
  );
}

test("活动按钮在 500ms 内重复触发只新增一次", async ({ page }) => {
  await openFreshApp(page);
  await seedApp(page, { variant: "empty", tab: "training" });

  await page.locator("[data-activity-name]").fill("晚间快走");
  await page.locator("[data-activity-minutes]").fill("45");
  const addActivity = page.locator("[data-add-activity]");
  await addActivity.click();
  await addActivity.click();

  const snapshot = await stateSnapshot(page);
  expect(snapshot.state.customActivities).toHaveLength(1);
  expect(snapshot.state.customActivities[0]).toMatchObject({ name: "晚间快走", minutes: 45 });
  expect(snapshot.state.activityDraft).toMatchObject({ name: "", minutes: 30 });
});

test("取消 AI 会中止信号并保留草稿，迟到响应不能覆盖后续结果", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await openFreshApp(page);
  await seedApp(page, { variant: "partial", tab: "diet" });
  await installDeferredNutritionFetch(page);

  await page.locator("[data-meal-food]").fill("等待取消的旧草稿");
  await page.locator("[data-ai-nutrition]").click();
  await expect.poll(() => page.evaluate(() => window.__nutritionRequests.length)).toBe(1);
  await expect(page.locator("[data-ai-nutrition]")).toHaveAttribute("aria-busy", "true");
  await page.locator("[data-cancel-ai]").click();

  await expect(page.locator(".ai-feedback.cancelled")).toContainText("当前草稿已保留");
  expect(await page.evaluate(() => window.__nutritionRequests[0].signal?.aborted)).toBe(true);
  let snapshot = await stateSnapshot(page);
  expect(snapshot.state.mealDraft).toMatchObject({
    food: "等待取消的旧草稿",
    aiStatus: "cancelled",
    aiResult: null,
  });

  await page.locator("[data-meal-food]").fill("应当保留的新草稿");
  await page.locator("[data-ai-nutrition]").click();
  await expect.poll(() => page.evaluate(() => window.__nutritionRequests.length)).toBe(2);
  await resolveNutritionRequest(
    page,
    1,
    nutritionResult({
      requestId: "req_newer",
      calories: 777,
      protein: 55,
      carbs: 81,
      fat: 21,
    }),
  );
  await expect.poll(async () => (await stateSnapshot(page)).state.mealDraft.aiStatus).toBe("success");

  await resolveNutritionRequest(
    page,
    0,
    nutritionResult({
      requestId: "req_stale",
      calories: 111,
      protein: 1,
      carbs: 2,
      fat: 3,
    }),
  );
  await page.waitForTimeout(50);
  snapshot = await stateSnapshot(page);
  expect(snapshot.state.mealDraft).toMatchObject({
    food: "应当保留的新草稿",
    calories: 777,
    protein: 55,
    carbs: 81,
    fat: 21,
    aiStatus: "success",
    aiRequestId: "req_newer",
  });
  expect(pageErrors).toEqual([]);
});

test("AI 等待期间编辑草稿时不应用较早响应", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await openFreshApp(page);
  await seedApp(page, { variant: "partial", tab: "diet" });
  await installDeferredNutritionFetch(page);

  await page.locator("[data-meal-food]").fill("发起请求时的草稿");
  await page.locator(".advanced-fields > summary").click();
  await page.locator("[data-meal-calories]").fill("120");
  await page.locator("[data-ai-nutrition]").click();
  await expect.poll(() => page.evaluate(() => window.__nutritionRequests.length)).toBe(1);

  await page.locator("[data-meal-food]").fill("等待期间编辑后的草稿");
  await page.locator("[data-meal-calories]").fill("321");
  await resolveNutritionRequest(page, 0, nutritionResult({ calories: 888 }));

  await expect(page.locator(".ai-feedback.cancelled")).toContainText("内容已修改");
  const snapshot = await stateSnapshot(page);
  expect(snapshot.state.mealDraft).toMatchObject({
    food: "等待期间编辑后的草稿",
    calories: 321,
    aiStatus: "cancelled",
    aiResult: null,
  });
  expect(pageErrors).toEqual([]);
});

test("页面进入动画只在真实 tab 变化时触发", async ({ page }) => {
  await openFreshApp(page);
  await seedApp(page, { variant: "full", tab: "home" });
  const surface = page.locator(".app-surface");
  const animationName = () => surface.evaluate((element) => getComputedStyle(element).animationName);

  await expect(surface).not.toHaveClass(/is-tab-entering/);
  expect(await animationName()).toBe("none");

  await page.evaluate(async () => (await import("/src/app-actions.js")).render());
  await expect(surface).not.toHaveClass(/is-tab-entering/);
  expect(await animationName()).toBe("none");

  await page.locator('[data-tab="diet"]').click();
  await expect(page.locator('[data-tab="diet"]')).toHaveAttribute("aria-current", "page");
  await expect(surface).toHaveClass(/is-tab-entering/);
  expect(await animationName()).not.toBe("none");

  await page.evaluate(async () => (await import("/src/app-actions.js")).render());
  await expect(surface).not.toHaveClass(/is-tab-entering/);
  expect(await animationName()).toBe("none");

  await page.locator('[data-tab="diet"]').click();
  await expect(surface).not.toHaveClass(/is-tab-entering/);
  expect(await animationName()).toBe("none");
});

test("最后一项完成仅每日庆祝一次，振动异常不影响已保存结果", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await openFreshApp(page);
  await seedApp(page, { variant: "full", tab: "home" });
  await page.evaluate(async () => {
    const { state, meals } = await import("/src/app-state.js");
    const { render } = await import("/src/app-actions.js");
    Object.assign(meals[3], {
      calories: 260,
      status: "已记录",
      foods: ["坚果酸奶"],
      macros: { protein: 12, carbs: 22, fat: 13 },
      nutritionSource: "manual",
    });
    state.waterMl = 2200;
    state.workoutDone = true;
    state.taskOverrides = {};
    window.__vibrateCalls = 0;
    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      value: () => {
        window.__vibrateCalls += 1;
        throw new Error("haptics blocked");
      },
    });
    render();
  });

  const waterTask = page.locator('.focus-item[data-habit-step="water"]');
  await expect(waterTask).not.toHaveClass(/done/);
  await waterTask.click();

  const celebration = page.locator("[data-celebration-dialog]");
  await expect(celebration).toBeVisible();
  await expect(celebration).toHaveAttribute("role", "dialog");
  await expect(celebration).toHaveAttribute("aria-modal", "true");
  await expect(page.locator('.focus-item[data-habit-step="water"]')).toHaveClass(/just-completed/);
  await expect(page.locator(".app-surface > [role=status]")).toContainText("今日三件事已全部完成");
  expect(await celebration.evaluate((element) => element.contains(document.activeElement))).toBe(true);

  const markers = await page.evaluate(() =>
    Object.keys(localStorage)
      .filter((key) => key.startsWith("fat-loss-celebration:"))
      .map((key) => ({ key, value: localStorage.getItem(key) })),
  );
  expect(markers).toHaveLength(1);
  expect(markers[0].key).toMatch(/^fat-loss-celebration:(local|supabase):/);
  expect(markers[0].value).toBe("2026-08-09");
  expect((await stateSnapshot(page)).state.waterMl).toBe(2400);
  expect(await page.evaluate(() => window.__vibrateCalls)).toBe(1);

  await celebration.locator("[data-dismiss-celebration]").click();
  await expect(celebration).toHaveCount(0);
  await expect(page.locator('.focus-item[data-habit-step="water"]')).toBeFocused();

  await page.evaluate(async () => {
    const { runtime } = await import("/src/app-state.js");
    runtime.celebrationSeenFallback.clear();
  });
  await page.locator('.habit-actions [data-habit-step="water"][data-step-direction="-1"]').click();
  await page.locator('.focus-item[data-habit-step="water"]').click();
  await expect(celebration).toHaveCount(0);
  expect((await stateSnapshot(page)).state.waterMl).toBe(2400);
  expect(await page.evaluate(() => window.__vibrateCalls)).toBe(2);
  expect(pageErrors).toEqual([]);
});
