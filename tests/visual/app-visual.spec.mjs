import { test, expect } from "@playwright/test";
import { openFreshApp, seedApp, setAiResult } from "../helpers/app-fixture.mjs";

// 视觉快照必须与 rAF 驱动的 count-up 动画解耦：并行 worker 下页面会被后台化，
// rAF 节流会把数字冻结在中途值。reduced-motion 让数字直接渲染终值。
test.use({ reducedMotion: "reduce" });

const visualScenarios = [
  { id: "login", snapshot: "01-login-390.png" },
  { id: "onboarding", snapshot: "02-onboarding-390.png" },
  { id: "home", snapshot: "03-home-390.png" },
  { id: "diet", snapshot: "04-diet-390.png" },
  { id: "training", snapshot: "05-training-390.png" },
  { id: "data", snapshot: "06-data-390.png" },
  { id: "profile", snapshot: "07-profile-390.png" },
  { id: "settings", snapshot: "08-settings-390.png" },
  { id: "ai-review", snapshot: "09-ai-review-390.png" },
];

async function prepareVisualScenario(page, id) {
  await openFreshApp(page);
  await page.evaluate(() => document.fonts?.ready);
  if (id === "login") return;
  if (id === "onboarding") {
    await page.evaluate(async () => {
      const { state } = await import("/src/app-state.js");
      const { render } = await import("/src/app-actions.js");
      state.appLoading = false;
      state.authRequired = false;
      state.setupCompleted = false;
      render();
    });
    return;
  }
  if (["home", "diet", "training", "data", "profile"].includes(id)) {
    await seedApp(page, { variant: "full", tab: id });
    return;
  }
  if (id === "settings") {
    await seedApp(page, { variant: "full", tab: "home" });
    await page.locator('[data-app-action="goal"]').click();
    // settings-in 入场动画即使被 reduced-motion 压到 0.01ms，仍会与截图机制竞态，
    // 偶发捕获到半透明面板。终态与自然状态一致，直接钉死动画消除竞态。
    await page.evaluate(() => {
      document.querySelectorAll(".settings-sheet").forEach((el) => {
        el.style.animation = "none";
      });
    });
    return;
  }
  await seedApp(page, { variant: "partial", tab: "diet" });
  await setAiResult(page);
}

for (const scenario of visualScenarios) {
  test(`390px ${scenario.id} 视觉回归`, async ({ page }) => {
    await prepareVisualScenario(page, scenario.id);
    await expect(page).toHaveScreenshot(scenario.snapshot);
  });
}

test("首页高风险首屏在 320px 视口保持稳定", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await openFreshApp(page);
  await seedApp(page, { variant: "full", tab: "home" });
  await expect(page).toHaveScreenshot("03-home-320.png");
});

test("饮食高风险首屏在 430px 视口保持稳定", async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 932 });
  await openFreshApp(page);
  await seedApp(page, { variant: "full", tab: "diet" });
  await expect(page).toHaveScreenshot("04-diet-430.png");
});
