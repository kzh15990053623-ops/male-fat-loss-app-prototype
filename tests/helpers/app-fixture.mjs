import { expect } from "@playwright/test";

export const FIXED_NOW = "2026-08-09T08:00:00+08:00";
export const MAIN_TABS = ["home", "diet", "training", "data", "profile"];

export async function openFreshApp(page) {
  await page.route("**/api/auth/refresh", (route) => route.fulfill({ status: 204 }));
  await page.route("**/api/readiness*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        auth: {
          configured: true,
          reachable: true,
          ready: true,
          signupAllowed: true,
          code: "AUTH_READY",
          message: "认证服务已连接。",
          checkedAt: "2026-08-10T00:00:00.000Z",
        },
      }),
    }),
  );
  await page.clock.setFixedTime(new Date(FIXED_NOW));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("[data-auth-form]")).toBeVisible();
  await expect(page.locator('[data-auth-service-state="ready"]')).toBeVisible();
}

export async function seedApp(page, { variant = "full", tab = "home", authenticated = false } = {}) {
  await page.evaluate(
    async ({ variantName, activeTab, withSession }) => {
      const stateModule = await import("/src/app-state.js");
      const actionModule = await import("/src/app-actions.js");
      const { capturePersistedDataFingerprint } = await import("/src/app-sync.js");
      const { state, meals, initialStateSnapshot, initialMealsSnapshot, runtime } = stateModule;
      const clone = (value) => JSON.parse(JSON.stringify(value));
      const blankMeals = clone(initialMealsSnapshot);
      const dates = ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07", "2026-08-08", "2026-08-09"];

      runtime.aiNutritionController?.abort?.();
      ["saveTimer", "inputSaveTimer", "toastTimer", "retryTimer", "reminderTimer", "undoTimer", "completionFeedbackTimer"].forEach(
        (key) => {
          clearTimeout(runtime[key]);
          runtime[key] = undefined;
        },
      );
      runtime.pendingTabEnter = false;
      runtime.pendingActions.clear();
      runtime.aiNutritionController = null;
      runtime.aiNutritionSequence = 0;
      runtime.aiNutritionDraftKey = "";
      runtime.completionFeedback = null;
      runtime.completionAnnouncement = "";
      runtime.celebrationOpen = false;
      runtime.celebrationReturnSelector = "";
      runtime.celebrationSeenFallback.clear();
      runtime.countUpValues.clear();
      runtime.syncPromise = null;
      runtime.stateRevision = 0;
      runtime.localUpdatedAt = "2026-08-09T00:00:00.000Z";
      runtime.localMutationRevision = 0;
      runtime.dirtyBaseRevision = null;
      runtime.syncBasePayload = null;
      runtime.lastActivityCommitFingerprint = "";
      runtime.lastActivityCommitAt = 0;
      for (let index = localStorage.length - 1; index >= 0; index -= 1) {
        const key = localStorage.key(index);
        if (key?.startsWith("fat-loss-celebration:")) localStorage.removeItem(key);
      }

      Object.keys(state).forEach((key) => delete state[key]);
      Object.assign(state, clone(initialStateSnapshot), {
        appLoading: false,
        authRequired: false,
        setupCompleted: true,
        activeTab,
        backendStatus: withSession ? "online" : "local",
        schemaVersion: 3,
        currentDate: "2026-08-09",
        weight: 86.2,
        weightDraft: 86.2,
        waist: 95.4,
        waistDraft: 95.4,
        startWeight: 90,
        startWaist: 100,
        targetWeight: 78,
        targetWaist: 86,
        weeklyLossTarget: 0.5,
        calorieBudget: 1900,
        proteinTarget: 150,
        waterTarget: 2400,
        stepsTarget: 9000,
        taskOverrides: {},
        setupFieldErrors: {},
        settingsDraft: null,
        settingsOpen: false,
        clearConfirmOpen: false,
        toast: "",
        syncError: "",
        syncPending: false,
        preferences: { unit: "metric", reminderTime: "21:30", pushEnabled: false, aiAssist: true },
        user: { height: 178, age: 34, bmr: 1780, dailyCalories: 1900 },
        mealTemplates: [],
        customActivities: [],
        dailyRecords: {},
        weightLogs: [],
        waistLogs: [],
        waterMl: 0,
        steps: 0,
        sleep: 0,
        workoutDone: false,
      });

      const todayMeals = clone(blankMeals);
      if (variantName === "partial" || variantName === "full") {
        Object.assign(todayMeals[0], {
          calories: 430,
          status: "已记录",
          foods: ["燕麦", "鸡蛋", "无糖酸奶"],
          macros: { protein: 29, carbs: 48, fat: 13 },
          nutritionSource: "manual",
        });
        Object.assign(state, { waterMl: 900, steps: 4200, sleep: 6.8 });
        state.weightLogs = [{ date: "2026-08-09", label: "8/9", value: 86.2 }];
        state.waistLogs = [{ date: "2026-08-09", label: "8/9", value: 95.4 }];
      }

      if (variantName === "full") {
        Object.assign(todayMeals[1], {
          calories: 610,
          status: "已记录",
          foods: ["杂粮饭", "鸡胸肉", "西兰花"],
          macros: { protein: 51, carbs: 66, fat: 15 },
          nutritionSource: "ai",
          aiMeta: { requestId: "req_saved", model: "nutrition-lab-1", confidence: 0.87, needsReview: false, edited: false },
        });
        Object.assign(todayMeals[2], {
          calories: 520,
          status: "已记录",
          foods: ["牛肉荞麦面", "时蔬"],
          macros: { protein: 38, carbs: 62, fat: 14 },
          nutritionSource: "manual",
        });
        const activity = { id: 2026080901, name: "全身循环", type: "燃脂快练", minutes: 30, kcal: 260, createdAt: "07:30" };
        Object.assign(state, {
          waterMl: 2200,
          steps: 9680,
          sleep: 7.5,
          workoutDone: true,
          customActivities: [activity],
          mealTemplates: [{ id: 1, name: "鸡胸餐", food: "鸡胸肉、杂粮饭、西兰花", calories: 560, protein: 50, carbs: 62, fat: 12 }],
        });
        state.weightLogs = dates.map((date, index) => ({ date, label: `8/${index + 3}`, value: Number((87.4 - index * 0.2).toFixed(1)) }));
        state.waistLogs = dates.map((date, index) => ({ date, label: `8/${index + 3}`, value: Number((96.6 - index * 0.2).toFixed(1)) }));
      }

      meals.splice(0, meals.length, ...todayMeals);

      if (variantName !== "empty") {
        const recordDates = variantName === "full" ? dates : [dates.at(-1)];
        recordDates.forEach((date, index) => {
          const dayMeals = clone(blankMeals);
          Object.assign(dayMeals[0], {
            calories: 390 + index * 6,
            status: "已记录",
            foods: ["真实早餐记录"],
            macros: { protein: 28, carbs: 45, fat: 12 },
            nutritionSource: "manual",
          });
          if (variantName === "full") {
            Object.assign(dayMeals[1], {
              calories: 580 + index * 5,
              status: "已记录",
              foods: ["真实午餐记录"],
              macros: { protein: 46, carbs: 63, fat: 14 },
              nutritionSource: "manual",
            });
          }
          if (date === "2026-08-09") dayMeals.splice(0, dayMeals.length, ...clone(todayMeals));
          state.dailyRecords[date] = {
            date,
            meals: dayMeals,
            waterMl: date === "2026-08-09" ? state.waterMl : 1800 + index * 80,
            steps: date === "2026-08-09" ? state.steps : 6500 + index * 410,
            sleep: date === "2026-08-09" ? state.sleep : Number((6.8 + index * 0.1).toFixed(1)),
            calorieBudget: 1900,
            weight: variantName === "full" ? (state.weightLogs[index]?.value ?? null) : 86.2,
            waist: variantName === "full" ? (state.waistLogs[index]?.value ?? null) : 95.4,
            customActivities: date === "2026-08-09" ? clone(state.customActivities) : [],
            taskOverrides: {},
            workoutDone: date === "2026-08-09" ? state.workoutDone : false,
            updatedAt: `${date}T12:00:00.000Z`,
          };
        });
      }

      runtime.accessToken = withSession ? "e2e-access-token" : "";
      runtime.authUserId = withSession ? "e2e-user" : "";
      runtime.authProvider = state.authProvider;
      if (withSession) localStorage.setItem("fat-loss-auth-user-id", "e2e-user");
      else localStorage.removeItem("fat-loss-auth-user-id");
      capturePersistedDataFingerprint();
      history.replaceState(null, "", `#tab-${activeTab}`);
      actionModule.render();
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    },
    { variantName: variant, activeTab: tab, withSession: authenticated },
  );

  await expect(page.locator(`[data-tab="${tab}"]`)).toHaveAttribute("aria-current", "page");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(() => document.fonts?.ready);
}

export async function setTab(page, tab) {
  await page.locator(`[data-tab="${tab}"]`).click();
  await expect(page.locator(`[data-tab="${tab}"]`)).toHaveAttribute("aria-current", "page");
}

export async function setAiResult(page, overrides = {}) {
  await page.evaluate(async (next) => {
    const { state } = await import("/src/app-state.js");
    const { render } = await import("/src/app-actions.js");
    state.mealDraft.food = "一碗牛肉饭和一份青菜";
    state.mealDraft.calories = 685;
    state.mealDraft.protein = 42;
    state.mealDraft.carbs = 82;
    state.mealDraft.fat = 20;
    state.mealDraft.aiStatus = "needs-review";
    state.mealDraft.aiResult = {
      requestId: "req_visual_review",
      source: "model",
      model: "nutrition-lab-1",
      confidence: 0.72,
      needsReview: true,
      calories: 685,
      protein: 42,
      carbs: 82,
      fat: 20,
      assumptions: ["米饭按熟重 220g 估算"],
      warnings: ["牛肉烹调用油量需要确认"],
      details: [
        { name: "牛肉饭", grams: 360, calories: 590, protein: 38, carbs: 78, fat: 16, confidence: 0.68 },
        { name: "清炒青菜", grams: 150, calories: 95, protein: 4, carbs: 4, fat: 4, confidence: 0.81 },
      ],
      context: { amount: 510, unit: "g", cooking: "炒", oilGrams: 10, sauce: "中" },
      note: "请核对牛肉肥瘦与实际用油。",
      ...next,
    };
    render();
  }, overrides);
}

export async function stateSnapshot(page) {
  return page.evaluate(async () => {
    const { state, meals } = await import("/src/app-state.js");
    return JSON.parse(JSON.stringify({ state, meals }));
  });
}
