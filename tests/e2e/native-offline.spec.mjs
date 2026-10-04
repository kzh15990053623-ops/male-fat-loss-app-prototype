import { test, expect } from "@playwright/test";

test("手机模式无认证服务也能建档、保存并在重启后恢复", async ({ page }) => {
  const apiCalls = [];
  await page.route("**/api/**", (route) => {
    apiCalls.push(route.request().url());
    return route.abort();
  });
  await page.addInitScript(() => {
    const key = "test-device-snapshot";
    let latest = JSON.parse(localStorage.getItem(key) || "null");
    let pending = Promise.resolve();
    const store = {
      async openDeviceStore() {
        return latest;
      },
      latestDevicePayload() {
        return latest;
      },
      saveDevicePayload(payload) {
        pending = pending.then(() => {
          latest = payload;
          localStorage.setItem(key, JSON.stringify(payload));
        });
        return pending;
      },
      flushDeviceStore() {
        return pending;
      },
    };
    window.__WENJIAN_NATIVE__ = {
      store,
      Camera: {
        async takePhoto() {
          return { webPath: "/src/app-icon-512.png" };
        },
      },
    };
  });

  await page.goto("/");
  await expect(page.locator("[data-setup-form]")).toBeVisible();
  await page.locator("[data-setting-formula]").selectOption("male");
  await page.locator('[name="height"]').fill("180");
  await page.locator('[name="age"]').fill("29");
  await page.locator('[name="weight"]').fill("80");
  await page.locator('[name="targetWeight"]').fill("70");
  await page.locator("[data-complete-setup]").click();
  await expect(page.locator("[data-setup-form]")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.locator("[data-backend-status]").first()).toHaveAttribute("data-status", "device");
  await page.reload();
  await expect(page.locator("[data-setup-form]")).toHaveCount(0);
  await expect(page.locator("[data-weight-input]")).toHaveValue("80");
  await page.locator('[data-tab="diet"]').click();
  await page.locator('[data-pick-photo="camera"]').click();
  await expect(page.locator(".meal-photo-preview img")).toBeVisible();
  await page.locator("[data-meal-food]").fill("鸡胸肉和米饭");
  await page.locator(".advanced-fields summary").click();
  await page.locator("[data-meal-calories]").fill("450");
  await page.locator("[data-add-meal]").click();
  await expect(page.locator(".meal-photo-preview")).toHaveCount(0);
  await page.locator("[data-meal-food]").fill("半杯牛奶");
  await page.locator("[data-meal-amount]").fill("0.5");
  await page.locator("[data-meal-unit]").selectOption("杯");
  await page.locator("[data-meal-calories]").fill("60");
  await page.locator("[data-add-meal]").click();
  await expect(page.locator("[data-meal-food]")).toHaveValue("");
  const mealEntries = await page.evaluate(() => {
    const payload = window.__WENJIAN_NATIVE__.store.latestDevicePayload();
    return payload.meals.flatMap((meal) => meal.entries || []);
  });
  expect(mealEntries).toHaveLength(2);
  expect(mealEntries[1]).toMatchObject({ food: "半杯牛奶", amount: 0.5, unit: "杯", calories: 60 });
  const backup = await page.evaluate(() => ({ data: JSON.parse(localStorage.getItem("test-device-snapshot")) }));
  await page.locator('[data-tab="profile"]').click();
  await page.locator("[data-clear-data]").click();
  await page.locator("[data-confirm-clear-data]").click();
  await expect(page.locator("[data-setup-form]")).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("[data-setup-form] [data-import-backup-file]").setInputFiles({
    name: "fitness-data.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await expect(page.locator("[data-setup-form]")).toHaveCount(0);
  await page.reload();
  await page.locator('[data-tab="home"]').click();
  await expect(page.locator("[data-weight-input]")).toHaveValue("80");
  expect(apiCalls).toEqual([]);
});
