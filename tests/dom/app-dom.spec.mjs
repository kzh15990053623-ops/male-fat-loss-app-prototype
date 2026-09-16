import { test, expect } from "@playwright/test";
import { MAIN_TABS, openFreshApp, seedApp, setAiResult } from "../helpers/app-fixture.mjs";

test("认证服务未就绪时阻止无效提交，并可无副作用重试", async ({ page }) => {
  let serviceReady = false;
  await page.route("**/api/auth/refresh", (route) => route.fulfill({ status: 204 }));
  await page.route("**/api/readiness*", (route) =>
    route.fulfill({
      status: serviceReady ? 200 : 503,
      contentType: "application/json",
      body: JSON.stringify({
        ok: serviceReady,
        auth: serviceReady
          ? { ready: true, signupAllowed: true, code: "AUTH_READY", message: "认证服务已连接。" }
          : { ready: false, signupAllowed: false, code: "AUTH_PROJECT_NOT_FOUND", message: "认证服务地址不存在，请检查 SUPABASE_URL。" },
        localAuth: { available: true, ready: true, code: "LOCAL_AUTH_READY", message: "本机账号模式可用。" },
      }),
    }),
  );

  await page.goto("/", { waitUntil: "domcontentloaded" });
  const unavailable = page.locator('[data-auth-service-state="unavailable"]');
  await expect(unavailable).toContainText("云端认证未就绪");
  await expect(unavailable).toContainText("AUTH_PROJECT_NOT_FOUND");
  await expect(page.locator('[name="email"]')).toBeDisabled();
  await expect(page.locator("[data-auth-submit]")).toBeDisabled();
  await expect(page.locator("[data-use-local-auth]")).toBeVisible();

  serviceReady = true;
  await page.locator("[data-retry-auth-service]").click();
  await expect(page.locator('[data-auth-service-state="ready"]')).toBeVisible();
  await expect(page.locator('[name="email"]')).toBeEnabled();
  await expect(page.locator("[data-auth-submit]")).toBeEnabled();
});

test("云端不可用时可明确切换本机账号且不伪装云同步", async ({ page }) => {
  await page.route("**/api/auth/refresh", (route) => route.fulfill({ status: 204 }));
  await page.route("**/api/readiness*", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        ok: false,
        auth: { ready: false, signupAllowed: false, code: "AUTH_PROJECT_NOT_FOUND", message: "云端项目不存在。" },
        localAuth: { available: true, ready: true, code: "LOCAL_AUTH_READY", message: "本机账号模式可用。" },
      }),
    }),
  );

  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator("[data-use-local-auth]").click();
  await expect(page.locator('[data-auth-service-state="local-ready"]')).toContainText("不会上传到 Supabase");
  await expect(page.locator('[name="email"]')).toBeEnabled();
  await expect(page.locator("[data-auth-submit]")).toBeEnabled();
  await page.locator('[data-auth-mode="signup"]').click();
  await expect(page.getByRole("heading", { name: "创建本机账号" })).toBeVisible();
  await expect(page.locator("[data-use-cloud-auth]")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
});

test("项目关闭注册时仍允许已有用户登录", async ({ page }) => {
  await page.route("**/api/auth/refresh", (route) => route.fulfill({ status: 204 }));
  await page.route("**/api/readiness*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        auth: {
          ready: true,
          signupAllowed: false,
          code: "AUTH_SIGNUP_DISABLED",
          message: "认证服务可用，但当前项目已关闭新用户注册。",
        },
      }),
    }),
  );

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-auth-service-state="signup-disabled"]')).toBeVisible();
  await expect(page.locator('[name="email"]')).toBeEnabled();
  await expect(page.locator("[data-auth-submit]")).toBeEnabled();

  await page.locator('[data-auth-mode="signup"]').click();
  await expect(page.getByRole("heading", { name: "创建账号" })).toBeVisible();
  await expect(page.locator('[name="email"]')).toBeDisabled();
  await expect(page.locator("[data-auth-submit]")).toBeDisabled();
  await expect(page.locator("[data-auth-submit]")).toContainText("当前不可注册");
});

const expectedHeadings = {
  home: "今天",
  diet: "好好吃饭",
  training: "动起来",
  data: "你的进步",
  profile: "我的",
};

test("启动期间展示可访问骨架屏而不是空白画布", async ({ page }) => {
  let releaseRefresh;
  const refreshGate = new Promise((resolve) => {
    releaseRefresh = resolve;
  });
  await page.route("**/api/auth/refresh", async (route) => {
    await refreshGate;
    await route.fulfill({ status: 204 });
  });
  await page.clock.setFixedTime(new Date("2026-08-09T08:00:00+08:00"));
  const navigation = page.goto("/", { waitUntil: "domcontentloaded" });
  try {
    await expect(page.locator(".app-skeleton")).toBeVisible();
    await expect(page.locator(".app-skeleton")).toHaveAttribute("aria-label", "正在加载应用");
  } finally {
    releaseRefresh();
  }
  await navigation;
  await expect(page.locator("[data-auth-form]")).toBeVisible();
});

test("五个主页面在空、部分、完整数据与三档视口下都能实际渲染", async ({ page }) => {
  await openFreshApp(page);
  for (const viewport of [
    { width: 320, height: 740 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
  ]) {
    await page.setViewportSize(viewport);
    for (const variant of ["empty", "partial", "full"]) {
      for (const tab of MAIN_TABS) {
        await seedApp(page, { variant, tab });
        await expect(page.getByRole("heading", { level: 1, name: expectedHeadings[tab] })).toBeVisible();
        const audit = await page.evaluate(() => ({
          invalidText: /NaN|undefined/.test(document.body.innerText),
          overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) > window.innerWidth + 1,
          currentPages: document.querySelectorAll(".app-surface > header.page-header").length,
          tinyReadableText: [...document.querySelectorAll(".app-surface *")]
            .filter((element) => [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim()))
            .filter((element) => {
              const style = getComputedStyle(element);
              const rect = element.getBoundingClientRect();
              return (
                style.display !== "none" &&
                style.visibility !== "hidden" &&
                rect.width > 0 &&
                rect.height > 0 &&
                parseFloat(style.fontSize) < 12
              );
            })
            .map((element) => element.textContent.trim().slice(0, 40)),
        }));
        expect(audit, `${viewport.width}px / ${variant} / ${tab}`).toEqual({
          invalidText: false,
          overflow: false,
          currentPages: 1,
          tinyReadableText: [],
        });
      }
    }
  }
});

test("首页本周行动进度从周一开始，忽略仅有身体基线的零行动日", async ({ page }) => {
  await openFreshApp(page);
  await seedApp(page, { variant: "empty", tab: "home" });

  const emptySummary = await page.evaluate(async () => {
    const { state } = await import("/src/app-state.js");
    const { weeklyCompletionSummary } = await import("/src/app-logic.js");
    state.dailyRecords = {
      "2026-08-09": { date: "2026-08-09", weight: 86.2, waist: 95.4, meals: [], customActivities: [] },
    };
    return weeklyCompletionSummary("2026-08-09");
  });
  expect(emptySummary).toMatchObject({ percent: null, days: 0, weekStart: "2026-08-03", through: "2026-08-09" });
  await expect(page.locator(".progress-ring")).toHaveAttribute("aria-label", "本周还没有行动记录");
  await expect(page.locator(".lab-hero")).toContainText("从第一笔开始");
  await expect(page.locator(".lab-hero")).not.toContainText(/0%|目标\s*78kg/);

  const summary = await page.evaluate(async () => {
    const { state } = await import("/src/app-state.js");
    const { render } = await import("/src/app-actions.js");
    const { weeklyCompletionSummary } = await import("/src/app-logic.js");
    const meals = (count) =>
      Array.from({ length: count }, (_, index) => ({ id: `meal-${index}`, calories: 300, macros: { protein: 0, carbs: 0, fat: 0 } }));
    const completeRecord = (date) => ({
      date,
      meals: meals(3),
      waterMl: 2400,
      steps: 9000,
      sleep: 7,
      workoutDone: true,
      customActivities: [],
    });
    state.dailyRecords = {
      "2026-08-02": completeRecord("2026-08-02"),
      "2026-08-03": { date: "2026-08-03", meals: meals(3), waterMl: 2400, steps: 0, sleep: 0, workoutDone: false, customActivities: [] },
      "2026-08-09": { date: "2026-08-09", meals: [], waterMl: 0, steps: 9000, sleep: 7, workoutDone: true, customActivities: [] },
      "2026-08-10": completeRecord("2026-08-10"),
    };
    state.currentDate = "2026-08-09";
    const result = weeklyCompletionSummary();
    render();
    return result;
  });
  expect(summary).toMatchObject({ percent: 50, days: 2, completed: 5, total: 10, weekStart: "2026-08-03", through: "2026-08-09" });
  await expect(page.locator(".progress-ring")).toHaveAttribute("aria-label", "本周行动完成度 50%");
  await expect(page.locator(".progress-ring")).toContainText("50%");
});

test("品牌语言与空态主行动完成迁移", async ({ page }) => {
  await openFreshApp(page);
  await expect(page).toHaveTitle("稳减 · 私人健康手账");
  await expect(page.locator("[data-auth-form]")).not.toContainText(/实验|实验室|WEIGHT LAB/);

  await seedApp(page, { variant: "empty", tab: "home" });
  await expect(page.getByRole("button", { name: "记录体重" })).toHaveAttribute("data-scroll-body-form", "");

  await seedApp(page, { variant: "empty", tab: "diet" });
  await expect(page.getByRole("button", { name: "去记一餐" })).toHaveAttribute("data-scroll-meal-form", "");

  await seedApp(page, { variant: "empty", tab: "training" });
  await expect(page.getByRole("button", { name: "记录一次运动" })).toHaveAttribute("data-coach-action", "training");

  await seedApp(page, { variant: "empty", tab: "data" });
  await expect(page.getByRole("button", { name: "完成今天的记录" })).toHaveAttribute("data-week-action", "home");
  const emptyBorders = await page
    .locator(".data-empty-lab, .empty-state")
    .evaluateAll((elements) => elements.map((element) => getComputedStyle(element).borderStyle));
  expect(emptyBorders).not.toContain("dashed");

  for (const tab of MAIN_TABS) {
    await seedApp(page, { variant: "full", tab });
    await expect(page.locator(".app-surface")).not.toContainText(/实验|实验室|WEIGHT LAB|SUBJECT \/ PERSONAL|TODAY \/ FOCUS|QUICK CAPTURE/);
  }
});

test("表单、图标按钮、触控目标与底部导航满足语义约束", async ({ page }) => {
  await openFreshApp(page);
  await page.setViewportSize({ width: 320, height: 740 });
  for (const tab of MAIN_TABS) {
    await seedApp(page, { variant: "full", tab });
    const violations = await page.evaluate(() => {
      const visible = (element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      };
      const fields = [...document.querySelectorAll("form input, form select, form textarea")].filter(visible);
      const controls = [...document.querySelectorAll("button, a[href], summary, input, select, textarea")].filter(visible);
      return {
        unnamedFields: fields.filter((field) => !field.name).map((field) => field.outerHTML.slice(0, 120)),
        unlabeledFields: fields
          .filter((field) => !field.labels?.length && !field.closest("label") && !field.getAttribute("aria-label"))
          .map((field) => field.name),
        missingAutocomplete: fields
          .filter((field) => field.type !== "checkbox" && !field.hasAttribute("autocomplete"))
          .map((field) => field.name),
        unlabeledIconButtons: [...document.querySelectorAll(".icon-button, .mini-icon-button")].filter(
          (button) => !button.getAttribute("aria-label"),
        ).length,
        exposedIcons: [...document.querySelectorAll("button svg, a svg")].filter((svg) => svg.getAttribute("aria-hidden") !== "true")
          .length,
        undersizedTargets: controls
          .filter((control) => !control.disabled)
          .map((control) => ({
            tag: control.tagName,
            name: control.getAttribute("name") || control.getAttribute("aria-label") || control.textContent.trim().slice(0, 20),
            rect: control.getBoundingClientRect().toJSON(),
          }))
          .filter((item) => item.rect.width < 43.5 || item.rect.height < 43.5),
      };
    });
    expect(violations, tab).toEqual({
      unnamedFields: [],
      unlabeledFields: [],
      missingAutocomplete: [],
      unlabeledIconButtons: 0,
      exposedIcons: 0,
      undersizedTargets: [],
    });
  }
});

test("训练计划只保留一个套用入口且仍可填充今日安排", async ({ page }) => {
  await openFreshApp(page);
  await seedApp(page, { variant: "full", tab: "training" });

  const focus = (await page.locator(".training-copy h2").innerText()).trim();
  const applyPlan = page.locator("[data-apply-today-plan]");
  await expect(applyPlan).toHaveCount(1);
  await applyPlan.click();

  await expect(page.locator("[data-activity-name]")).toHaveValue(focus);
  await expect(page.locator(".toast-banner")).toContainText("已套用今日训练安排");
});

test("设置提醒开关保留语义、键盘操作与保存结果，正文色满足 AA", async ({ page }) => {
  await openFreshApp(page);
  await seedApp(page, { variant: "full", tab: "home" });
  await page.locator('[data-app-action="goal"]').click();

  const reminderSwitch = page.getByRole("switch", { name: "记录提醒" });
  await expect(reminderSwitch).not.toBeChecked();

  const switchAudit = await reminderSwitch.evaluate((element) => {
    const switchStyle = getComputedStyle(element);
    const rowRect = element.closest(".toggle-row").getBoundingClientRect();
    const rootStyle = getComputedStyle(document.documentElement);
    const parseHex = (value) => {
      const hex = value.trim().replace("#", "");
      return [0, 2, 4].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255);
    };
    const luminance = (value) => {
      const [red, green, blue] = parseHex(value).map((channel) =>
        channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
      );
      return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    };
    const contrast = (foreground, background) => {
      const first = luminance(foreground);
      const second = luminance(background);
      return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
    };
    const muted = rootStyle.getPropertyValue("--muted");
    return {
      appearance: switchStyle.appearance,
      rowHeight: rowRect.height,
      contrastOnPaper: contrast(muted, rootStyle.getPropertyValue("--paper")),
      contrastOnPaper2: contrast(muted, rootStyle.getPropertyValue("--paper-2")),
    };
  });
  expect(switchAudit.appearance).toBe("none");
  expect(switchAudit.rowHeight).toBeGreaterThanOrEqual(44);
  expect(switchAudit.contrastOnPaper).toBeGreaterThanOrEqual(4.5);
  expect(switchAudit.contrastOnPaper2).toBeGreaterThanOrEqual(4.5);

  await reminderSwitch.focus();
  await page.keyboard.press("Space");
  await expect(reminderSwitch).toBeChecked();
  await page.locator("[data-save-settings]").click();
  await expect(page.getByRole("dialog", { name: "目标与设置" })).toHaveCount(0);

  await page.locator('[data-app-action="goal"]').click();
  await expect(page.getByRole("switch", { name: "记录提醒" })).toBeChecked();

  await page.emulateMedia({ reducedMotion: "reduce" });
  const transitionDuration = await page
    .locator("[data-setting-push] + .toggle-track")
    .evaluate((element) => getComputedStyle(element, "::after").transitionDuration);
  expect(parseFloat(transitionDuration)).toBeLessThanOrEqual(0.001);
});

test("字段错误聚焦、设置返回、确认弹窗与焦点恢复可用", async ({ page }) => {
  await openFreshApp(page);
  await seedApp(page, { variant: "full", tab: "home" });
  await page.locator('[data-app-action="goal"]').click();
  await expect(page).toHaveURL(/#settings$/);
  await expect(page.getByRole("dialog", { name: "目标与设置" })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/#tab-home$/);
  await expect(page.getByRole("dialog", { name: "目标与设置" })).toHaveCount(0);
  await page.locator('[data-app-action="goal"]').click();
  await page.locator('[name="aiAssist"]').selectOption("off");
  await page.locator('[name="reminderTime"]').fill("20:15");
  await page.locator('[name="targetWeight"]').fill("90");
  await page.locator("[data-save-settings]").click();
  await expect(page.locator("#field-error-targetWeight")).toContainText("低于当前体重");
  await expect(page.locator('[name="targetWeight"]')).toBeFocused();
  await expect(page.locator('[name="aiAssist"]')).toHaveValue("off");
  await expect(page.locator('[name="reminderTime"]')).toHaveValue("20:15");
  await page.locator('[name="targetWeight"]').fill("78");
  await page.locator('[name="targetWaist"]').fill("86");
  await page.getByRole("button", { name: "关闭设置" }).click();
  await expect(page).toHaveURL(/#tab-home$/);
  await expect(page.locator('[data-app-action="goal"]')).toBeFocused();

  await page.locator('[data-tab="profile"]').click();
  await page.locator("[data-clear-data]").click();
  await expect(page.getByRole("dialog", { name: "清空所有数据？" })).toBeVisible();
  await expect(page.getByRole("button", { name: "取消" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "清空所有数据？" })).toHaveCount(0);
  await expect(page.locator("[data-clear-data]")).toBeFocused();
});

test("AI 复核态显示总置信度、明细置信度、假设与警告", async ({ page }) => {
  await openFreshApp(page);
  await seedApp(page, { variant: "partial", tab: "diet" });
  await setAiResult(page);
  const result = page.locator(".nutrition-result.needs-review");
  await expect(result).toContainText("需要复核");
  await expect(result).toContainText("72%");
  await expect(result).toContainText("置信度 68%");
  await expect(result).toContainText("模型假设");
  await expect(result).toContainText("用油量需要确认");
});

test("键盘焦点与减少动态效果偏好生效", async ({ page }) => {
  await openFreshApp(page);
  await seedApp(page, { variant: "full", tab: "home" });
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  const focusStyle = await page.evaluate(() => {
    const element = document.activeElement;
    const style = getComputedStyle(element);
    return { tag: element?.tagName, outlineWidth: parseFloat(style.outlineWidth || "0") };
  });
  expect(focusStyle.tag).not.toBe("BODY");
  expect(focusStyle.outlineWidth).toBeGreaterThanOrEqual(2);

  await page.emulateMedia({ reducedMotion: "reduce" });
  const motion = await page.locator(".app-surface").evaluate((element) => {
    const style = getComputedStyle(element);
    return { animationDuration: style.animationDuration, transitionDuration: style.transitionDuration };
  });
  expect(parseFloat(motion.animationDuration)).toBeLessThanOrEqual(0.001);
  expect(parseFloat(motion.transitionDuration)).toBeLessThanOrEqual(0.001);

  const viewportPolicy = await page.locator('meta[name="viewport"]').getAttribute("content");
  expect(viewportPolicy).not.toMatch(/user-scalable\s*=\s*no|maximum-scale/i);
});
