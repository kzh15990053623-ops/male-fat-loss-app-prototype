import { test, expect } from "@playwright/test";
import { MAIN_TABS, openFreshApp, seedApp, setTab } from "../helpers/app-fixture.mjs";

test.use({ viewport: { width: 844, height: 390 } });

test("横屏五个页面与设置可操作且没有横向溢出", async ({ page }) => {
  await openFreshApp(page);
  await seedApp(page, { variant: "full" });
  for (const tab of MAIN_TABS) {
    await setTab(page, tab);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  }
  await page.locator('[data-app-action="settings"]').click();
  await expect(page.locator("[data-settings-form]")).toBeVisible();
  await page.locator('[data-setting-field="height"]').fill("179");
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(page.locator("[data-settings-form]")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});
