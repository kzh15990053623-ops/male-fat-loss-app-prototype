import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { MAIN_TABS, openFreshApp, seedApp } from "../helpers/app-fixture.mjs";

const BLOCKING_IMPACTS = new Set(["serious", "critical"]);

async function auditAccessibility(page, testInfo, scenario) {
  await page.evaluate(() => document.fonts?.ready);
  const results = await new AxeBuilder({ page }).analyze();

  await testInfo.attach(`axe-${scenario}.json`, {
    body: Buffer.from(JSON.stringify(results, null, 2)),
    contentType: "application/json",
  });

  const blockingViolations = results.violations
    .filter((violation) => BLOCKING_IMPACTS.has(violation.impact))
    .map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      helpUrl: violation.helpUrl,
      targets: violation.nodes.map((node) => node.target),
    }));

  expect(blockingViolations, `${scenario} 存在 serious/critical axe 违规`).toEqual([]);
}

test("登录页无 serious/critical axe 违规", async ({ page }, testInfo) => {
  await openFreshApp(page);
  await expect(page.locator("[data-auth-form]")).toBeVisible();
  await auditAccessibility(page, testInfo, "login");
});

test("首次设置页无 serious/critical axe 违规", async ({ page }, testInfo) => {
  await openFreshApp(page);
  await page.evaluate(async () => {
    const { state } = await import("/src/app-state.js");
    const { render } = await import("/src/app-actions.js");
    state.appLoading = false;
    state.authRequired = false;
    state.setupCompleted = false;
    render();
  });
  await expect(page.locator("[data-setup-form]")).toBeVisible();
  await auditAccessibility(page, testInfo, "onboarding");
});

for (const tab of MAIN_TABS) {
  test(`${tab} 主页面无 serious/critical axe 违规`, async ({ page }, testInfo) => {
    await openFreshApp(page);
    await seedApp(page, { variant: "full", tab });
    await auditAccessibility(page, testInfo, `tab-${tab}`);
  });
}

test("设置弹层无 serious/critical axe 违规", async ({ page }, testInfo) => {
  await openFreshApp(page);
  await seedApp(page, { variant: "full", tab: "home" });
  await page.locator('[data-app-action="goal"]').click();
  await expect(page.locator("[data-settings-form]")).toBeVisible();
  await auditAccessibility(page, testInfo, "settings-dialog");
});
