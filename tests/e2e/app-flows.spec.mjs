import { test, expect } from "@playwright/test";
import { openFreshApp, seedApp, setTab, stateSnapshot } from "../helpers/app-fixture.mjs";

test("登录、首次设置与退出登录完整闭环", async ({ page }) => {
  await page.route("**/api/auth/login", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ accessToken: "login-token", user: { id: "user-login", email: "lab@example.com" } }),
    }),
  );
  await page.route("**/api/state", (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ state: null, meals: null, updatedAt: null, revision: 0 }),
      });
    const revision = route.request().postDataJSON()?.revision || 0;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ revision: revision + 1, updatedAt: "2026-08-09T00:00:01.000Z" }),
    });
  });
  await page.route("**/api/auth/logout", (route) => route.fulfill({ status: 204 }));
  await openFreshApp(page);

  await page.locator('[name="email"]').fill("lab@example.com");
  await page.locator('[name="password"]').fill("secure-pass");
  await page.locator("[data-auth-submit]").click();
  await expect(page.getByRole("heading", { name: "从真实数据开始" })).toBeVisible();
  await page.locator('[name="height"]').fill("178");
  await page.locator('[name="age"]').fill("34");
  await page.locator('[name="weight"]').fill("86.4");
  await page.locator('[name="waist"]').fill("96");
  await page.locator('[name="targetWeight"]').fill("76");
  await page.locator('[name="targetWaist"]').fill("86");
  await page.locator('[name="calories"]').fill("1880");
  await page.locator('[name="weeklyLoss"]').fill("0.5");
  await page.locator("[data-complete-setup]").click();
  await expect(page.getByRole("heading", { name: "今天", exact: true })).toBeVisible();

  const newUser = await stateSnapshot(page);
  expect(newUser.state.waterMl).toBe(0);
  expect(newUser.state.steps).toBe(0);
  expect(newUser.state.sleep).toBe(0);
  expect(newUser.state.customActivities).toEqual([]);
  expect(newUser.meals.every((meal) => meal.calories === 0)).toBe(true);
  expect(newUser.state.dailyRecords["2026-08-09"].customActivities).toEqual([]);

  await setTab(page, "profile");
  await page.locator("[data-logout]").click();
  await expect(page.getByRole("heading", { name: "欢迎回来" })).toBeVisible();
});

test("从任意主页面一次导航即可完成身体、饮食和训练记录", async ({ page }) => {
  await openFreshApp(page);
  await seedApp(page, { variant: "partial", tab: "data" });

  await setTab(page, "home");
  await page.locator("[data-weight-input]").fill("85.8");
  await page.locator("[data-waist-input]").fill("94.9");
  await page.locator("[data-save-body]").click();
  await expect.poll(async () => (await stateSnapshot(page)).state.weight).toBe(85.8);

  await setTab(page, "diet");
  await page.locator("[data-meal-food]").fill("鸡胸肉、杂粮饭和西兰花");
  await page.locator(".advanced-fields > summary").click();
  await page.locator("[data-meal-calories]").fill("560");
  await page.locator("[data-meal-protein]").fill("50");
  await page.locator("[data-meal-carbs]").fill("62");
  await page.locator("[data-meal-fat]").fill("12");
  await page.locator("[data-add-meal]").click();
  await expect.poll(async () => (await stateSnapshot(page)).meals.find((meal) => meal.id === "dinner")?.calories).toBe(560);

  await setTab(page, "training");
  await page.locator("[data-activity-name]").fill("晚间快走");
  await page.locator("[data-activity-minutes]").fill("45");
  await page.locator("[data-add-activity]").click();
  const recorded = await stateSnapshot(page);
  expect(recorded.state.customActivities[0]).toMatchObject({ name: "晚间快走", minutes: 45 });
  expect(recorded.state.customActivities[0].kcal).toBeGreaterThan(0);
});

test("离线记录先落本地，恢复联网后自动同步", async ({ page, context }) => {
  let putCount = 0;
  let allowSync = false;
  await page.route("**/api/state", (route) => {
    if (route.request().method() === "PUT" && !allowSync) return route.abort("internetdisconnected");
    if (route.request().method() === "PUT") putCount += 1;
    const revision = route.request().method() === "PUT" ? route.request().postDataJSON()?.revision || 0 : 0;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ revision: revision + (route.request().method() === "PUT" ? 1 : 0), updatedAt: "2026-08-09T00:00:01.000Z" }),
    });
  });
  await openFreshApp(page);
  await seedApp(page, { variant: "partial", tab: "home", authenticated: true });

  await context.setOffline(true);
  await page.locator("[data-weight-input]").fill("85.6");
  await page.locator("[data-save-body]").click();
  await expect.poll(async () => (await stateSnapshot(page)).state.backendStatus, { timeout: 5_000 }).toBe("local");
  const localPayload = await page.evaluate(() => JSON.parse(localStorage.getItem("fat-loss-state-v3:e2e-user") || "null"));
  expect(localPayload.state.weight).toBe(85.6);
  expect(localPayload.state.syncPending).toBeUndefined();

  allowSync = true;
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(() => putCount, { timeout: 5_000 }).toBeGreaterThan(0);
  await expect.poll(async () => (await stateSnapshot(page)).state.backendStatus, { timeout: 5_000 }).toBe("online");
  expect((await stateSnapshot(page)).state.syncPending).toBe(false);
});

test("AI 覆盖识别中、成功复核、离线、限流和不可重试失败", async ({ page, context }) => {
  let mode = "review";
  await page.route("**/api/ai/nutrition", async (route) => {
    if (mode === "review" || mode === "success") {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const needsReview = mode === "review";
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          requestId: needsReview ? "req_ai_review" : "req_ai_success",
          source: "model",
          model: "nutrition-lab-1",
          confidence: needsReview ? 0.71 : 0.91,
          needsReview,
          assumptions: needsReview ? ["米饭按熟重估算"] : [],
          warnings: needsReview ? ["请确认用油量"] : [],
          details: [{ name: "鸡肉饭", grams: 420, calories: 650, protein: 46, carbs: 76, fat: 18, confidence: needsReview ? 0.69 : 0.9 }],
          calories: 650,
          protein: 46,
          carbs: 76,
          fat: 18,
        }),
      });
    }
    if (mode === "limited")
      return route.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({ error: "请求过于频繁", code: "AI_RATE_LIMITED", retryable: true, requestId: "req_limited" }),
      });
    return route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "服务未配置", code: "AI_PROVIDER_NOT_CONFIGURED", retryable: false, requestId: "req_config" }),
    });
  });
  await openFreshApp(page);
  await seedApp(page, { variant: "partial", tab: "diet" });
  await expect(page.locator(".composer-note")).toContainText("不会静默使用本地规则结果");
  await page.locator("[data-meal-food]").fill("一份鸡肉饭");
  await page.locator("[data-ai-nutrition]").click();
  await expect(page.locator("[data-ai-nutrition]")).toHaveAttribute("aria-busy", "true");
  await expect(page.locator(".nutrition-result.needs-review")).toContainText("置信度 69%");
  await page.locator(".advanced-fields > summary").click();
  await page.locator("[data-meal-calories]").fill("620");
  await page.locator("[data-add-meal]").click();
  const aiMeal = (await stateSnapshot(page)).meals.find((meal) => meal.id === "dinner");
  expect(aiMeal.nutritionSource).toBe("ai");
  expect(aiMeal.aiMeta).toMatchObject({ requestId: "req_ai_review", needsReview: true, edited: true });

  mode = "success";
  await page.locator("[data-meal-food]").fill("一份鸡肉饭");
  await page.locator("[data-ai-nutrition]").click();
  await expect(page.locator(".nutrition-result:not(.needs-review)")).toContainText("AI 模型估算");
  await expect(page.locator(".nutrition-result:not(.needs-review)")).toContainText("91%");

  mode = "limited";
  await page.locator("[data-meal-food]").fill("一份沙拉");
  await page.locator("[data-ai-nutrition]").click();
  await expect(page.locator(".ai-feedback.error")).toContainText("AI 请求过于频繁");
  await expect(page.locator(".ai-feedback.error")).toContainText("可以重试");
  await expect(page.locator(".ai-feedback.error")).toContainText("req_limited");

  mode = "failed";
  await page.locator("[data-ai-nutrition]").click();
  await expect(page.locator(".ai-feedback.error")).toContainText("请展开营养细节并改用手动记录");

  await context.setOffline(true);
  await page.locator("[data-ai-nutrition]").click();
  await expect(page.locator(".ai-feedback.error")).toContainText("当前处于离线状态");
  expect((await stateSnapshot(page)).state.mealDraft.aiResult).toBeNull();
  await context.setOffline(false);
});
