import { test, expect } from "@playwright/test";
import { openFreshApp, seedApp } from "../helpers/app-fixture.mjs";

test("设置草稿在异步重绘后保留所有控件值、焦点和面板滚动位置", async ({ page }) => {
  await openFreshApp(page);
  await seedApp(page, { variant: "full", tab: "home" });
  await page.locator('[data-app-action="goal"]').click();
  await page.locator('[data-setting-field="weight"]').fill("85.7");
  await page.locator('[name="aiAssist"]').selectOption("off");
  await page.locator('[name="reminderTime"]').fill("20:15");
  await page.locator('[name="pushEnabled"]').check();
  await page.locator('[name="trustedOfflineAccess"]').check();
  await page.locator('[name="reminderTime"]').focus();
  const previousScroll = await page.locator(".settings-sheet").evaluate((panel) => panel.scrollTop);
  await page.evaluate(async () => {
    const { showToast } = await import("/src/actions/services.js");
    showToast("后台同步完成");
  });
  await expect(page.locator('[data-setting-field="weight"]')).toHaveValue("85.7");
  await expect(page.locator('[name="aiAssist"]')).toHaveValue("off");
  await expect(page.locator('[name="reminderTime"]')).toHaveValue("20:15");
  await expect(page.locator('[name="pushEnabled"]')).toBeChecked();
  await expect(page.locator('[name="trustedOfflineAccess"]')).toBeChecked();
  await expect(page.locator('[name="reminderTime"]')).toBeFocused();
  expect(await page.locator(".settings-sheet").evaluate((panel) => panel.scrollTop)).toBeCloseTo(previousScroll, 0);
  await expect.poll(() => page.evaluate(async () => (await import("/src/app-state.js")).state.toast)).toBe("");
  await expect(page.locator('[data-setting-field="weight"]')).toHaveValue("85.7");
  await expect(page.locator('[name="reminderTime"]')).toBeFocused();
  await page.getByRole("button", { name: "关闭设置" }).click();
  await page.locator('[data-app-action="goal"]').click();
  await expect(page.locator('[data-setting-field="weight"]')).toHaveValue("86.2");
  await expect(page.locator('[name="trustedOfflineAccess"]')).not.toBeChecked();
});

test("当前体重的错误在设置和首次引导中均阻止提交", async ({ page }) => {
  await openFreshApp(page);
  await seedApp(page, { variant: "full", tab: "home" });
  await page.locator('[data-app-action="goal"]').click();
  await page.locator('[data-setting-field="weight"]').fill("250");
  await page.locator("[data-save-settings]").click();
  await expect(page.locator("#field-error-weight")).toContainText("40–200kg");
  await expect(page.locator('[data-setting-field="weight"]')).toBeFocused();
  expect(await page.evaluate(async () => (await import("/src/app-state.js")).state.weight)).toBe(86.2);
  await page.locator('[data-setting-field="weight"]').fill("0");
  await page.evaluate(async () => (await import("/src/actions/services.js")).showToast("后台状态更新"));
  await expect(page.locator('[data-setting-field="weight"]')).toHaveValue("0");
  await page.getByRole("button", { name: "关闭设置" }).click();
  await page.evaluate(async () => {
    const { state } = await import("/src/app-state.js");
    const { render } = await import("/src/actions/services.js");
    state.setupCompleted = false;
    state.settingsDraft = null;
    render();
  });
  await page.locator('[data-setting-field="weight"]').fill("250");
  await page.locator("[data-setup-form]").evaluate((form) => form.requestSubmit());
  await expect(page.locator("#field-error-weight")).toContainText("40–200kg");
  await expect(page.locator('[data-setting-field="weight"]')).toBeFocused();
  expect(await page.evaluate(async () => (await import("/src/app-state.js")).state.setupCompleted)).toBe(false);
});

test("信任设备必须明确保存，保留限制和导出入口可直接使用", async ({ page }) => {
  await openFreshApp(page);
  await seedApp(page, { variant: "full", tab: "home" });
  await page.evaluate(async () => {
    const { storeSession } = await import("/src/app-storage.js");
    storeSession({ accessToken: "settings-test-token", provider: "supabase", user: { id: "settings-test-user" } });
  });
  await page.route("**/api/state", (route) => route.fulfill({ status: 503 }));
  await page.locator('[data-app-action="goal"]').click();
  const trust = page.locator('[name="trustedOfflineAccess"]');
  await expect(trust).not.toBeChecked();
  await expect(page.locator("#trusted-offline-note")).toContainText("能使用此浏览器的人也能查看");
  await expect(page.locator(".settings-sheet")).toContainText("180 个记录日");
  await trust.check();
  expect(await page.evaluate(async () => (await import("/src/app-storage.js")).isOfflineAccessTrusted())).toBe(false);
  await page.locator("[data-save-settings]").click();
  await expect(page.locator(".settings-sheet")).toHaveCount(0);
  expect(await page.evaluate(async () => (await import("/src/app-storage.js")).isOfflineAccessTrusted())).toBe(true);
  await page.locator('[data-app-action="goal"]').click();
  await expect(trust).toBeChecked();
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出当前数据备份" }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe("fitness-data-2026-08-09.json");
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const exported = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  expect(exported.user.id).toBe("settings-test-user");
  expect(exported.data.state.weight).toBe(86.2);
  expect(Object.keys(exported.data.state.dailyRecords)).toHaveLength(7);
});

test("预算差额、运动消耗和完成率可用键盘展开逐日精确值", async ({ page }) => {
  await openFreshApp(page);
  await seedApp(page, { variant: "full", tab: "data" });
  const expected = await page.evaluate(async () => {
    const { calorieBalanceSeries, burnedSeries, completionSeries } = await import("/src/app-logic.js");
    return [
      { title: "预算差额", values: calorieBalanceSeries(7), unit: "kcal" },
      { title: "运动消耗", values: burnedSeries(7), unit: "kcal" },
      { title: "记录完成率", values: completionSeries(7), unit: "%" },
    ];
  });
  for (const series of expected) {
    const control = page.locator(`summary[aria-label="${series.title}：查看每日数据"]`);
    await control.focus();
    await page.keyboard.press("Enter");
    const entries = page.locator(`dl[aria-label="${series.title}逐日数据"]`);
    await expect(entries).toBeVisible();
    await expect(entries.locator("dd")).toHaveText(series.values.map((item) => `${item.value} ${series.unit}`));
    await expect(entries.locator("dt").last()).toHaveText("今天");
  }
});
