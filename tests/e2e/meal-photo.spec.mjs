import { test, expect } from "@playwright/test";
import { openFreshApp, seedApp, stateSnapshot } from "../helpers/app-fixture.mjs";

async function photoFile(page, color = "#73834d") {
  const data = await page.evaluate((fill) => {
    const canvas = document.createElement("canvas");
    canvas.width = 2400;
    canvas.height = 1600;
    const context = canvas.getContext("2d");
    context.fillStyle = fill;
    context.fillRect(0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png").split(",")[1];
  }, color);
  return { name: "meal.png", mimeType: "image/png", buffer: Buffer.from(data, "base64") };
}

const result = {
  source: "model",
  inputMode: "photo",
  foodText: "米饭（一碗）、青菜（一份）",
  calories: 430,
  protein: 10,
  carbs: 75,
  fat: 10,
  confidence: 0.65,
  needsReview: true,
  details: [
    { name: "米饭", amount: "一碗", grams: 200, calories: 260, protein: 5, carbs: 57, fat: 1 },
    { name: "青菜", amount: "一份", grams: 200, calories: 170, protein: 5, carbs: 18, fat: 9 },
  ],
  assumptions: ["按常见碗盘估算份量"],
  warnings: ["照片无法准确判断克重及隐藏用油，请核对后保存。"],
  model: "deepseek-flash",
  context: { amount: null, unit: "g", cooking: "不确定", oilGrams: null, sauce: "不确定" },
  budget: { month: "2026-08", requests: 1, monthlyLimit: 20, dailyLimit: 5, remainingRequests: 4 },
};

test.beforeEach(async ({ page }) => {
  await openFreshApp(page);
  await seedApp(page, { variant: "partial", tab: "diet" });
  await page.locator("[data-meal-food]").fill("");
});

test("相册压缩、照片识别、核对保存；照片不进入持久化数据", async ({ page }) => {
  let body;
  await page.route("**/api/ai/nutrition", async (route) => {
    body = route.request().postDataJSON();
    await route.fulfill({ json: result });
  });
  await page.locator('[data-meal-photo="album"]').setInputFiles(await photoFile(page));
  await expect(page.getByAltText("待识别的本餐照片")).toBeVisible();
  const preview = await page.evaluate(async () => {
    const { runtime } = await import("/src/app-state.js");
    const { persistedPayload, storedPayload } = await import("/src/app-data.js");
    return {
      width: runtime.mealPhoto.width,
      height: runtime.mealPhoto.height,
      persistence: JSON.stringify([persistedPayload(), storedPayload()]),
    };
  });
  expect(preview.width).toBe(1280);
  expect(preview.persistence).not.toContain("base64");
  await page.locator("[data-ai-nutrition]").click();
  await expect(page.locator("[data-photo-reviewed]")).toBeVisible();
  expect(body.imageDataUrl).toMatch(/^data:image\/jpeg;base64,/);
  expect(body.imageDataUrl.length).toBeLessThan(700000);
  expect(body.foodText).toBe("");
  await expect(page.locator("[data-meal-food]")).toHaveValue(result.foodText);
  await expect(page.locator(".nutrition-result")).toContainText("份量不确定");
  await expect(page.locator(".nutrition-result")).toContainText("用油不确定");
  await expect(page.locator(".nutrition-result")).not.toContainText(/undefined|null/);
  await page.screenshot({ path: "output/playwright/photo-review-local.png", fullPage: true });
  await page.locator("[data-add-meal]").click();
  expect((await stateSnapshot(page)).meals.find((meal) => meal.id === "dinner").calories).not.toBe(430);
  await page.locator("[data-photo-reviewed]").check();
  await page.locator("[data-meal-calories]").fill("440");
  await expect(page.locator("[data-photo-reviewed]")).not.toBeChecked();
  await page.locator("[data-photo-reviewed]").check();
  await page.locator("[data-add-meal]").click();
  const meal = (await stateSnapshot(page)).meals.find((item) => item.id === "dinner");
  expect(meal).toMatchObject({ calories: 440, nutritionSource: "ai", aiMeta: { edited: true } });
  await expect(page.getByAltText("待识别的本餐照片")).toHaveCount(0);
});

test("取消或更换照片不会应用迟到结果；相机入口使用后置拍摄提示", async ({ page }) => {
  await expect(page.locator('[data-meal-photo="camera"]')).toHaveAttribute("capture", "environment");
  await page.locator('[data-meal-photo="album"]').setInputFiles(await photoFile(page));
  await expect(page.getByAltText("待识别的本餐照片")).toBeVisible();
  await page.evaluate(() => {
    const original = window.fetch.bind(window);
    window.fetch = (url, init) =>
      String(url).includes("/api/ai/nutrition")
        ? new Promise((resolve) => {
            window.resolvePhoto = resolve;
          })
        : original(url, init);
  });
  await page.locator("[data-ai-nutrition]").click();
  await expect(page.locator("[data-cancel-ai]")).toBeVisible();
  await page.locator('[data-meal-photo="album"]').setInputFiles(await photoFile(page, "#c26943"));
  await expect(page.locator("[data-ai-nutrition]")).toBeEnabled();
  await page.evaluate((payload) => window.resolvePhoto(new Response(JSON.stringify(payload))), result);
  await expect(page.locator("[data-meal-food]")).toHaveValue("");
  await expect(page.locator("[data-photo-reviewed]")).toHaveCount(0);
  await page.locator("[data-remove-photo]").click();
  await expect(page.getByAltText("待识别的本餐照片")).toHaveCount(0);
});

test("无效照片和预算耗尽会明确提示并保留手动记录", async ({ page }) => {
  await page
    .locator('[data-meal-photo="album"]')
    .setInputFiles({ name: "broken.jpg", mimeType: "image/jpeg", buffer: Buffer.from("not an image") });
  await expect(page.locator(".photo-error")).toContainText("无法读取");
  await page.locator('[data-meal-photo="album"]').setInputFiles(await photoFile(page));
  await expect(page.getByAltText("待识别的本餐照片")).toBeVisible();
  await page.route("**/api/ai/nutrition", (route) =>
    route.fulfill({ status: 429, json: { code: "AI_MONTHLY_BUDGET_EXCEEDED", error: "本月额度用完", retryable: false } }),
  );
  await page.locator("[data-ai-nutrition]").click();
  await expect(page.locator(".ai-feedback.error")).toContainText("本月 AI 预算已用完");
  await expect(page.getByAltText("待识别的本餐照片")).toBeVisible();
  await page.locator("[data-remove-photo]").click();
  await page.locator("[data-meal-food]").fill("手动填写米饭");
  await page.locator(".advanced-fields summary").click();
  await page.locator("[data-meal-calories]").fill("300");
  await page.locator("[data-add-meal]").click();
  expect((await stateSnapshot(page)).meals.find((meal) => meal.id === "dinner")).toMatchObject({
    calories: 300,
    nutritionSource: "manual",
  });
});

test("预算用量可刷新，刷新页面后不保留照片", async ({ page }) => {
  await page.route("**/api/ai/budget", (route) => route.fulfill({ json: result.budget }));
  await page.locator("[data-ai-budget]").click();
  await expect(page.locator(".nutrition-budget")).toContainText("已用 1 / 20 次");
  await page.locator('[data-meal-photo="album"]').setInputFiles(await photoFile(page));
  await expect(page.getByAltText("待识别的本餐照片")).toBeVisible();
  await page.reload();
  await seedApp(page, { variant: "partial", tab: "diet" });
  await expect(page.getByAltText("待识别的本餐照片")).toHaveCount(0);
});
