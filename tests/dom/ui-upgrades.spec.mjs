import { test, expect } from "@playwright/test";
import { openFreshApp, seedApp, stateSnapshot } from "../helpers/app-fixture.mjs";

test("趋势图支持鼠标、触摸点击与键盘等价选点", async ({ page }) => {
  await openFreshApp(page);
  await seedApp(page, { variant: "full", tab: "data" });

  const chart = page.locator(".lab-chart").first().locator("[data-line-chart]");
  const points = chart.locator("[data-chart-point]");
  const tooltip = chart.locator(".chart-tooltip");
  await expect(points).toHaveCount(7);

  const first = points.first();
  const second = points.nth(1);
  await first.focus();
  await expect(first).toHaveAttribute("aria-pressed", "true");
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toHaveText(await first.getAttribute("aria-label"));

  await page.keyboard.press("ArrowRight");
  await expect(second).toBeFocused();
  await expect(second).toHaveAttribute("aria-pressed", "true");
  await expect(first).toHaveAttribute("aria-pressed", "false");
  await expect(tooltip).toHaveText(await second.getAttribute("aria-label"));

  const hoverBox = await points.nth(2).boundingBox();
  await page.mouse.move(hoverBox.x + hoverBox.width / 2, hoverBox.y + hoverBox.height / 2);
  await expect(tooltip).toHaveText(await points.nth(2).getAttribute("aria-label"));
  const clickBox = await points.last().boundingBox();
  await page.mouse.click(clickBox.x + clickBox.width / 2, clickBox.y + clickBox.height / 2);
  await expect(tooltip).toHaveText(await points.last().getAttribute("aria-label"));

  const targetSize = await first.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });
  expect(targetSize.width).toBeGreaterThanOrEqual(44);
  expect(targetSize.height).toBeGreaterThanOrEqual(44);

  const line = chart.locator(".chart-line");
  expect(await line.evaluate((element) => getComputedStyle(element).animationName)).toBe("chart-line-draw");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(async () => (await import("/src/app-actions.js")).render());
  const reducedLine = page.locator(".lab-chart").first().locator(".chart-line");
  const reducedMotion = await reducedLine.evaluate((element) => {
    const style = getComputedStyle(element);
    return { duration: parseFloat(style.animationDuration), offset: parseFloat(style.strokeDashoffset) };
  });
  expect(reducedMotion.duration).toBeLessThanOrEqual(0.001);
  expect(reducedMotion.offset).toBe(0);
});

test("已记录餐食的再记一次只预填草稿，不直接覆盖餐次", async ({ page }) => {
  await openFreshApp(page);
  await seedApp(page, { variant: "full", tab: "diet" });
  const before = await stateSnapshot(page);

  await page.locator('[data-repeat-meal="breakfast"]').click();
  const after = await stateSnapshot(page);

  expect(after.state.mealDraft).toMatchObject({
    slot: "snack",
    food: "燕麦、鸡蛋、无糖酸奶",
    calories: 430,
    protein: 29,
    carbs: 48,
    fat: 13,
  });
  expect(after.meals).toEqual(before.meals);
  await expect(page.locator("[data-meal-food]")).toHaveValue("燕麦、鸡蛋、无糖酸奶");
  await expect(page.locator("[data-meal-slot]")).toHaveValue("snack");
});

test("首页从 dailyRecords 派生连续记录徽章，数字进入时 count-up", async ({ page }) => {
  await openFreshApp(page);
  await seedApp(page, { variant: "full", tab: "home" });
  const recordSource = await page.evaluate(async () => {
    const { state } = await import("/src/app-state.js");
    return { dates: Object.keys(state.dailyRecords), legacyStreak: state.streak };
  });
  expect(recordSource.dates).toHaveLength(7);
  expect(recordSource.legacyStreak).toBeUndefined();
  await expect(page.locator(".streak-badge")).toContainText("连续记录 7 天");

  const animatedStart = await page.evaluate(() => {
    document.querySelector('[data-tab="diet"]')?.click();
    document.querySelector('[data-tab="home"]')?.click();
    const metric = document.querySelector('[data-count-key="home-weight"]');
    return { text: metric?.textContent, target: metric?.dataset.countValue };
  });
  expect(animatedStart.text).not.toBe(animatedStart.target);
  await expect(page.locator('[data-count-key="home-weight"]')).toHaveText("86.2");

  await page.emulateMedia({ reducedMotion: "reduce" });
  const reducedValue = await page.evaluate(() => {
    document.querySelector('[data-tab="diet"]')?.click();
    document.querySelector('[data-tab="home"]')?.click();
    const metric = document.querySelector('[data-count-key="home-weight"]');
    return { text: metric?.textContent, target: metric?.dataset.countValue };
  });
  expect(reducedValue.text).toBe(reducedValue.target);
});

test("三档视口的页头同步文案与重试按钮不裁切或重叠", async ({ page }) => {
  await openFreshApp(page);
  for (const viewport of [
    { width: 320, height: 740 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
  ]) {
    await page.setViewportSize(viewport);
    for (const tab of ["home", "diet", "training", "data", "profile"]) {
      await seedApp(page, { variant: "full", tab });
      const layout = await page.evaluate(() => {
        const text = document.querySelector("[data-backend-status-text]")?.getBoundingClientRect();
        const retry = document.querySelector("[data-sync-retry]")?.getBoundingClientRect();
        if (!text || !retry) return null;
        const overlap = text.left < retry.right && text.right > retry.left && text.top < retry.bottom && text.bottom > retry.top;
        return {
          textVisible: text.width > 0 && text.height > 0,
          textInside: text.left >= 0 && text.right <= window.innerWidth,
          retryInside: retry.left >= 0 && retry.right <= window.innerWidth,
          overlap,
        };
      });
      expect(layout, `${viewport.width}px / ${tab}`).toEqual({
        textVisible: true,
        textInside: true,
        retryInside: true,
        overlap: false,
      });
    }
  }
});

test("保存设置期间只有一次权限请求且按钮保持 busy", async ({ page }) => {
  await openFreshApp(page);
  await seedApp(page, { variant: "full", tab: "profile" });
  await page.locator('[data-app-action="settings"]').click();
  await page.evaluate(() => {
    window.__permissionCalls = 0;
    window.__resolvePermission = null;
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: {
        permission: "default",
        requestPermission: () => {
          window.__permissionCalls += 1;
          return new Promise((resolve) => {
            window.__resolvePermission = resolve;
          });
        },
      },
    });
  });
  await page.locator("[data-setting-push]").check();

  await page.evaluate(() => {
    const submit = () =>
      document.querySelector("[data-settings-form]")?.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
    submit();
    submit();
  });

  const saveButton = page.locator("[data-save-settings]");
  await expect(saveButton).toBeDisabled();
  await expect(saveButton).toHaveAttribute("aria-busy", "true");
  await expect(saveButton).toContainText("保存中…");
  expect(await page.evaluate(() => window.__permissionCalls)).toBe(1);

  await page.evaluate(() => window.__resolvePermission?.("granted"));
  await expect(page.locator("[data-settings-form]")).toHaveCount(0);
  expect(await page.evaluate(() => window.__permissionCalls)).toBe(1);
});

test("清空与退出的重复触发均只发出一次请求", async ({ page }) => {
  await openFreshApp(page);
  await seedApp(page, { variant: "full", tab: "profile", authenticated: true });
  await page.evaluate(() => {
    const originalFetch = window.fetch.bind(window);
    window.__clearCalls = 0;
    window.__resolveClear = null;
    window.fetch = (input, init = {}) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes("/api/state") && init.method === "PUT" && String(init.body || "").includes("clearedAt")) {
        window.__clearCalls += 1;
        return new Promise((resolve) => {
          window.__resolveClear = () =>
            resolve(
              new Response(
                JSON.stringify({
                  state: { schemaVersion: 3, clearedAt: "2026-08-09T00:00:01.000Z", syncRevision: 1 },
                  meals: null,
                  revision: 1,
                  updatedAt: "2026-08-09T00:00:01.000Z",
                }),
                {
                  status: 200,
                  headers: { "Content-Type": "application/json" },
                },
              ),
            );
        });
      }
      return originalFetch(input, init);
    };
  });
  await page.locator("[data-clear-data]").click();
  await page.evaluate(() => {
    const click = () =>
      document.querySelector("[data-confirm-clear-data]")?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    click();
    click();
  });
  const clearButton = page.locator("[data-confirm-clear-data]");
  await expect(clearButton).toBeDisabled();
  await expect(clearButton).toHaveAttribute("aria-busy", "true");
  await expect(clearButton).toContainText("清空中…");
  expect(await page.evaluate(() => window.__clearCalls)).toBe(1);
  await page.evaluate(() => window.__resolveClear?.());
  await expect(clearButton).toHaveCount(0);

  await seedApp(page, { variant: "full", tab: "profile", authenticated: true });
  await page.evaluate(() => {
    const originalFetch = window.fetch.bind(window);
    window.__logoutCalls = 0;
    window.__resolveLogout = null;
    window.fetch = (input, init = {}) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes("/api/auth/logout") && init.method === "POST") {
        window.__logoutCalls += 1;
        return new Promise((resolve) => {
          window.__resolveLogout = () => resolve(new Response("{}", { status: 200 }));
        });
      }
      return originalFetch(input, init);
    };
  });
  await page.evaluate(() => {
    const click = () =>
      document.querySelector("[data-logout]")?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    click();
    click();
  });
  // Local health data is hidden immediately, without waiting for revocation.
  await expect(page.locator("[data-auth-form]")).toBeVisible();
  await expect(page.locator(".bottom-nav")).toHaveCount(0);
  await page.evaluate(async () => {
    const { logout } = await import("/src/actions/auth.js");
    void logout();
  });
  expect(await page.evaluate(() => window.__logoutCalls)).toBe(1);
  await page.evaluate(() => window.__resolveLogout?.());
  await expect(page.locator("[data-auth-form]")).toBeVisible();
  expect(await page.evaluate(() => window.__logoutCalls)).toBe(1);
});

test("局部渲染不重建未变化的页面且不打断正在输入的表单", async ({ page }) => {
  await openFreshApp(page);
  await seedApp(page, { variant: "full", tab: "diet" });

  const toastOnly = await page.evaluate(async () => {
    const form = document.querySelector("[data-meal-form]");
    form.__patchProbe = true;
    const { state } = await import("/src/app-state.js");
    const { render } = await import("/src/app-actions.js");
    state.toast = "已同步";
    render();
    return {
      formSurvived: document.querySelector("[data-meal-form]").__patchProbe === true,
      toastShown: Boolean(document.querySelector(".toast-banner")),
    };
  });
  await expect(page.locator(".toast-banner")).toHaveText("已同步");
  expect(toastOnly.formSurvived).toBe(true);
  expect(toastOnly.toastShown).toBe(true);

  const foodInput = page.locator("[data-meal-food]");
  await foodInput.click();
  await foodInput.fill("一碗牛肉饭");

  const rebuilt = await page.evaluate(async () => {
    const { state } = await import("/src/app-state.js");
    const { render } = await import("/src/app-actions.js");
    state.toast = "";
    state.mealDraft.calories = 777;
    render();
    const input = document.querySelector("[data-meal-food]");
    return {
      formSurvived: document.querySelector("[data-meal-form]").__patchProbe === true,
      stillFocused: document.activeElement === input,
      value: input?.value,
      caret: input?.selectionStart,
    };
  });
  expect(rebuilt.formSurvived).toBe(false);
  expect(rebuilt.stillFocused).toBe(true);
  expect(rebuilt.value).toBe("一碗牛肉饭");
  expect(rebuilt.caret).toBe("一碗牛肉饭".length);
  await expect(page.locator("[data-meal-calories]")).toHaveValue("777");
});
