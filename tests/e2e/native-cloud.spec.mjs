import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function nativeApp(page) {
  await page.addInitScript(() => {
    let snapshot = JSON.parse(localStorage.getItem("phone-data") || "null");
    let pending = Promise.resolve();
    window.__WENJIAN_NATIVE__ = {
      apiOrigin: "https://cloud.example.test",
      store: {
        async openDeviceStore() {
          return snapshot;
        },
        latestDevicePayload() {
          return snapshot;
        },
        saveDevicePayload(payload, { clearRecovery = false } = {}) {
          const copy = JSON.parse(JSON.stringify(payload));
          pending = pending
            .catch(() => {})
            .then(() => {
              if (window.failPhoneWrite) throw new Error("测试存储失败");
              snapshot = copy;
              localStorage.setItem("phone-data", JSON.stringify(copy));
              if (clearRecovery) localStorage.removeItem("phone-recovery");
            });
          return pending;
        },
        flushDeviceStore() {
          return pending;
        },
        async readCloudConfig() {
          return JSON.parse(localStorage.getItem("phone-cloud") || "null");
        },
        async writeCloudConfig(value) {
          localStorage.setItem("phone-cloud", JSON.stringify(value));
        },
        async saveCloudRecovery(value) {
          localStorage.setItem("phone-recovery", JSON.stringify(value));
        },
        async readCloudRecovery() {
          return JSON.parse(localStorage.getItem("phone-recovery") || "null");
        },
      },
      Http: {
        async request(options) {
          if (options.disableRedirects !== true || new URL(options.url).origin !== "https://cloud.example.test")
            throw new Error("错误的请求目标");
          const response = await fetch(new URL(options.url).pathname, {
            method: options.method,
            headers: options.headers,
            ...(options.data ? { body: JSON.stringify(options.data) } : {}),
          });
          return { status: response.status, data: response.status === 204 ? null : await response.json(), headers: {} };
        },
      },
      Cookies: { async clearAllCookies() {} },
      Camera: {
        async takePhoto() {
          return { webPath: "/src/app-icon-512.png" };
        },
      },
    };
  });
  const cloud = { revision: 0, state: null, meals: null, user: "user-a", puts: 0, offline: false, failRefresh: false };
  await page.route("**/api/**", async (route) => {
    if (cloud.offline) return route.abort();
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let status = 200;
    let data;
    if (path === "/api/readiness") data = { auth: { ready: true, signupAllowed: true } };
    else if (["/api/auth/login", "/api/auth/signup", "/api/auth/refresh"].includes(path)) {
      if (path.endsWith("refresh") && cloud.failRefresh) {
        status = 401;
        data = { error: "expired" };
      } else data = { accessToken: "fake-access", user: { id: cloud.user, email: "test@example.test" }, provider: "supabase" };
    } else if (path === "/api/ai/budget")
      data = { month: "2026-09", limitCny: 100, reservedCny: 0, estimatedCny: 0, remainingRequests: 1000 };
    else if (path === "/api/ai/nutrition")
      data = {
        source: "model",
        inputMode: "photo",
        foodText: "鸡胸肉和米饭",
        calories: 450,
        protein: 35,
        carbs: 50,
        fat: 12,
        confidence: 0.7,
        needsReview: true,
        details: [],
        assumptions: [],
        warnings: [],
        model: "test-model",
      };
    else if (path === "/api/state" && request.method() === "GET")
      data = { revision: cloud.revision, state: cloud.state, meals: cloud.meals, updatedAt: new Date().toISOString() };
    else if (path === "/api/state" && request.method() === "PUT") {
      const body = request.postDataJSON();
      await cloud.beforePut?.(body);
      cloud.puts += 1;
      if (body.revision !== cloud.revision) {
        status = 409;
        data = { conflict: { revision: cloud.revision, state: cloud.state, meals: cloud.meals, updatedAt: new Date().toISOString() } };
      } else {
        cloud.revision += 1;
        cloud.state = body.state;
        cloud.meals = body.meals;
        data = { revision: cloud.revision, state: cloud.state, meals: cloud.meals, updatedAt: new Date().toISOString() };
      }
    } else throw new Error(`Unexpected API ${request.method()} ${path}`);
    await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
  });
  await page.goto("/");
  await page.locator("[data-setting-formula]").selectOption("male");
  await page.locator('[name="height"]').fill("180");
  await page.locator('[name="age"]').fill("29");
  await page.locator('[name="weight"]').fill("80");
  await page.locator('[name="targetWeight"]').fill("70");
  await page.locator("[data-complete-setup]").click();
  await expect(page.locator("[data-setup-form]")).toHaveCount(0);
  await page.locator('[data-tab="profile"]').click();
  return cloud;
}

async function connect(page, choice) {
  if (!(await page.locator("[data-cloud-form]").count())) await page.locator("[data-cloud-open]").click();
  await page.locator('[name="cloudEmail"]').fill("test@example.test");
  await page.locator('[name="cloudPassword"]').fill("test-password");
  if (choice) await page.locator('[name="cloudInitialData"]').selectOption(choice);
  await page.locator('[data-cloud-form] button[type="submit"]').click();
}

test("手机连接后上传、识别照片并核对保存，断网重开与会话失效不锁住档案", async ({ page }) => {
  const cloud = await nativeApp(page);
  await connect(page);
  await expect(page.locator(".native-cloud-panel")).toContainText("云端已同步");
  expect(cloud.state.weight).toBe(80);
  const config = await page.evaluate(() => localStorage.getItem("phone-cloud"));
  expect(config).not.toMatch(/password|fake-access/);
  await page.locator('[data-tab="diet"]').click();
  await page.locator('[data-pick-photo="camera"]').click();
  await expect(page.locator(".meal-photo-preview img")).toBeVisible();
  await page.locator("[data-ai-nutrition]").click();
  await expect(page.locator("[data-meal-calories]")).toHaveValue("450");
  await page.locator("[data-photo-reviewed]").check();
  // Force the auto-sync acknowledgement to arrive while the user is reviewing.
  await page.evaluate(async () => {
    await (await import("/src/native-cloud.js")).resumeNativeCloud();
  });
  await expect(page.locator("[data-photo-reviewed]")).toBeChecked();
  await page.locator("[data-add-meal]").click();
  await expect.poll(() => cloud.meals?.some((meal) => meal.calories === 450)).toBe(true);
  cloud.offline = true;
  await page.reload();
  await page.locator('[data-tab="home"]').click();
  await expect(page.locator("[data-weight-input]")).toHaveValue("80");
  await expect(page.locator("[data-auth-form]")).toHaveCount(0);
  cloud.offline = false;
  cloud.failRefresh = true;
  await page.locator('[data-tab="profile"]').click();
  await page.locator("[data-sync-now]").last().click();
  await expect(page.locator(".native-cloud-panel")).toContainText("重新登录");
  await expect(page.locator("[data-auth-form]")).toHaveCount(0);
});

test("首次两端都有记录先要求选择，选择云端后保留覆盖前副本；异账号不能上传", async ({ page }) => {
  const cloud = await nativeApp(page);
  const phone = await page.evaluate(() => JSON.parse(localStorage.getItem("phone-data")));
  cloud.state = { ...phone.state, user: { ...phone.state.user, age: 35 } };
  cloud.meals = phone.meals;
  cloud.revision = 4;
  await connect(page);
  await expect(page.locator(".native-cloud-panel")).toContainText("手机和云端都已有档案");
  expect(cloud.puts).toBe(0);
  await connect(page, "cloud");
  await expect(page.locator(".native-cloud-panel")).toContainText("云端已同步");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("phone-data")).state.user.age)).toBe(35);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("phone-recovery")).phone.state.user.age)).toBe(29);
  await page.locator("[data-cloud-disconnect]").click();
  cloud.user = "user-b";
  const puts = cloud.puts;
  await connect(page);
  await expect(page.locator(".native-cloud-panel")).toContainText("已绑定另一账号");
  expect(cloud.puts).toBe(puts);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("phone-cloud")).ownerId)).toBe("user-a");
  await page.locator("[data-clear-data]").click();
  await page.locator("[data-confirm-clear-data]").click();
  await expect(page.locator("[data-setup-form]")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("phone-recovery"))).toBeNull();
});

test("云登录表单在窄屏与桌面无横向溢出，标签和键盘可访问", async ({ page }) => {
  await nativeApp(page);
  await page.locator("[data-cloud-open]").click();
  for (const width of [320, 390, 430, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[name="cloudEmail"]').focus();
  await page.keyboard.press("Tab");
  await expect(page.locator('[name="cloudPassword"]')).toBeFocused();
  const report = await new AxeBuilder({ page }).analyze();
  expect(report.violations.filter((violation) => ["serious", "critical"].includes(violation.impact))).toEqual([]);
  await page.screenshot({ path: "output/playwright/native-cloud-390.png", fullPage: true });
});

test("SQLite 写入失败时不上传，恢复后可重试保存与同步", async ({ page }) => {
  const cloud = await nativeApp(page);
  await connect(page);
  await expect(page.locator(".native-cloud-panel")).toContainText("云端已同步");
  await page.evaluate(() => {
    window.failPhoneWrite = true;
  });
  const puts = cloud.puts;
  await page.locator('[data-tab="home"]').click();
  await page.locator("[data-weight-input]").fill("79");
  await page.locator('[data-body-form] button[type="submit"]').click();
  await expect(page.locator("[data-backend-status]").first()).toHaveAttribute("data-status", "offline");
  expect(cloud.puts).toBe(puts);
  await page.evaluate(() => {
    window.failPhoneWrite = false;
  });
  await page.locator("[data-sync-now]").first().click();
  await expect.poll(() => cloud.state.weight).toBe(79);
});

test("原生写入等待期间的新修改与云端版本冲突都能保留", async ({ page }) => {
  const cloud = await nativeApp(page);
  await connect(page);
  await expect(page.locator(".native-cloud-panel")).toContainText("云端已同步");
  let release;
  let intercepted;
  const arrived = new Promise((resolve) => {
    intercepted = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  cloud.beforePut = async () => {
    cloud.beforePut = null;
    intercepted();
    await gate;
  };
  await page.locator('[data-tab="home"]').click();
  await page.locator("[data-weight-input]").fill("79");
  await page.locator('[data-body-form] button[type="submit"]').click();
  await arrived;
  cloud.state = { ...cloud.state, user: { ...cloud.state.user, age: 35 } };
  cloud.revision += 1;
  await page.locator("[data-weight-input]").fill("78");
  await page.locator('[data-body-form] button[type="submit"]').click();
  release();
  await expect.poll(() => cloud.state.weight).toBe(78);
  expect(cloud.state.user.age).toBe(35);
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem("phone-data")).state.weight)).toBe(78);
});

test("云连接配置损坏时仍可打开手机档案且不发送记录", async ({ page }) => {
  const cloud = await nativeApp(page);
  await page.evaluate(() => {
    localStorage.setItem("phone-cloud", "invalid-json");
  });
  await page.reload();
  await page.locator('[data-tab="home"]').click();
  await expect(page.locator("[data-weight-input]")).toHaveValue("80");
  await page.locator('[data-tab="profile"]').click();
  await expect(page.locator(".native-cloud-panel")).toContainText("云连接配置无法读取");
  expect(cloud.puts).toBe(0);
});
