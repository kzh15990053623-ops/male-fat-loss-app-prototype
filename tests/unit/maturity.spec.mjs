import { describe, it, expect, beforeEach, vi } from "vitest";
import { mealEntries, summarizeMeal, completeIntake, completeMacros } from "../../src/meal-entries.js";
import { validateStateWrite } from "../../server/data.mjs";
import { mergePayloads, syncBaseSnapshot, applyDailyRecord } from "../../src/app-data.js";
import { state, meals, runtime, initialStateSnapshot, initialMealsSnapshot } from "../../src/app-state.js";
import { preserveUpgradeDraft, restoreUpgradeDraft } from "../../src/app-storage.js";
import { calorieBalanceSeries, weeklyActionPlan, estimateCalorieBudget, dailyCalorieEstimate, todayTasks } from "../../src/app-logic.js";
const entry = (id, calories, known = true) => ({
  id,
  food: id,
  date: "2026-08-09",
  slot: "lunch",
  calories,
  macros: { protein: 10, carbs: 20, fat: 5 },
  nutritionKnown: known,
});
beforeEach(() => {
  Object.keys(state).forEach((key) => delete state[key]);
  Object.assign(state, structuredClone(initialStateSnapshot));
  meals.splice(0, meals.length, ...structuredClone(initialMealsSnapshot));
});
describe("maturity data contracts", () => {
  it("keeps known energy separate from unknown macronutrients", () => {
    const food = { ...entry("rice", 500), macros: { protein: 0, carbs: 0, fat: 0 }, macrosKnown: false };
    const meal = summarizeMeal({ id: "lunch", entries: [food] });
    expect(meal.calories).toBe(500);
    expect(completeIntake({ intakeStatus: "complete", meals: [meal] })).toBe(true);
    expect(completeMacros([meal])).toBe(false);
  });
  it("keeps upgrade drafts tab-local and restores only the matching account", () => {
    const cache = new Map();
    vi.stubGlobal("sessionStorage", {
      getItem: (key) => cache.get(key) || null,
      setItem: (key, value) => cache.set(key, value),
      removeItem: (key) => cache.delete(key),
    });
    runtime.authUserId = "account-a";
    state.mealDraft.food = "未完成的草稿";
    expect(preserveUpgradeDraft()).toBe(true);
    runtime.authUserId = "account-b";
    state.mealDraft.food = "";
    restoreUpgradeDraft();
    expect(state.mealDraft.food).toBe("");
    runtime.authUserId = "account-a";
    restoreUpgradeDraft();
    expect(state.mealDraft.food).toBe("未完成的草稿");
    expect(cache.size).toBe(0);
    sessionStorage.setItem = () => {
      throw new Error("storage blocked");
    };
    expect(preserveUpgradeDraft()).toBe(false);
    vi.unstubAllGlobals();
  });
  it("applies a recovered day and preserves an explicitly cleared waist", () => {
    state.waist = 90;
    applyDailyRecord({ weight: 75, waist: 88, steps: 5000, sleep: 7, waterMl: 1800, restDay: true, intakeStatus: "partial" });
    expect(state.weight).toBe(75);
    expect(state.waist).toBe(88);
    expect(state.weightDraft).toBe(75);
    state.waist = 0;
    applyDailyRecord({ waist: 91 });
    expect(state.waist).toBe(0);
  });
  it("retains both values when two devices edit the same measurement and food", () => {
    const base = {
      state: { ...structuredClone(initialStateSnapshot), weightLogs: [{ date: "2026-08-09", value: 80 }] },
      meals: [{ id: "lunch", entries: [entry("rice", 500)] }],
      revision: 1,
    };
    const local = structuredClone(base);
    local.state.weightLogs[0].value = 79;
    local.meals[0].entries[0].calories = 450;
    local.dirtyBaseRevision = 1;
    local.syncBase = syncBaseSnapshot(base);
    const remote = structuredClone(base);
    remote.state.weightLogs[0].value = 81;
    remote.meals[0].entries[0].calories = 550;
    remote.revision = 2;
    const merged = mergePayloads(local, remote, remote);
    expect(merged.safeMerge).toBe(true);
    expect(merged.payload.state.recordConflicts).toEqual(
      expect.arrayContaining([expect.objectContaining({ local: 79, remote: 81 }), expect.objectContaining({ local: 450, remote: 550 })]),
    );
    expect(merged.payload.meals[0].calories).toBe(450);
  });
  it("rejects malformed snapshots and nested entries before any sanitation", () => {
    for (const payload of [
      { state: "bad", meals: [] },
      { state: {}, meals: "bad" },
      { state: { dailyRecords: { "2026-99-99": {} } }, meals: [] },
      { state: { clearedAt: "2026-01-01", weight: 90 }, meals: null },
      { state: {}, meals: [{ entries: [entry("a", "500")] }] },
      { state: {}, meals: [{ entries: [entry("a", 500), entry("a", 500)] }] },
    ])
      expect(() => validateStateWrite(payload)).toThrow();
    expect(() => validateStateWrite({ state: { schemaVersion: 3, clearedAt: "2026-01-01T00:00:00Z" }, meals: null })).not.toThrow();
  });
  it("sums independent entries; edits and tombstones preserve the other entry", () => {
    const meal = { id: "lunch", entries: [entry("rice", 500), entry("milk", 120)] };
    expect(summarizeMeal(meal).calories).toBe(620);
    meal.entries[1].calories = 150;
    expect(summarizeMeal(meal).calories).toBe(650);
    meal.entries[0].deletedAt = "2026-08-09T12:00:00Z";
    expect(summarizeMeal(meal).calories).toBe(150);
    expect(mealEntries(summarizeMeal(meal))).toHaveLength(2);
  });
  it("excludes weight-only, partial and unknown-nutrition days from dietary analysis", () => {
    const known = { id: "breakfast", entries: [entry("breakfast", 500)] };
    state.dailyRecords = {
      "2026-08-06": { weight: 85, meals: [] },
      "2026-08-07": { intakeStatus: "partial", calorieBudget: 1800, meals: [known] },
      "2026-08-08": { intakeStatus: "complete", calorieBudget: 1800, meals: [{ id: "lunch", entries: [entry("unknown", 0, false)] }] },
      "2026-08-09": { intakeStatus: "complete", calorieBudget: 1800, meals: [known] },
    };
    expect(calorieBalanceSeries()).toEqual([{ date: "2026-08-09", value: 1300 }]);
    expect(completeIntake(state.dailyRecords["2026-08-08"])).toBe(false);
    expect(JSON.stringify(weeklyActionPlan([85, 85], [], []).map((item) => item.title))).not.toMatch(/收紧晚餐|增加训练|减少主食/);
  });
  it("uses chosen body formula and habitual activity, recalculates weight, pauses manual estimates", () => {
    const input = { height: 170, age: 30, weight: 70, weeklyLoss: 0.5, activityLevel: "sedentary" };
    expect(estimateCalorieBudget({ ...input, formula: "male" }).bmr).toBe(1618);
    expect(estimateCalorieBudget({ ...input, formula: "female" }).bmr).toBe(1452);
    expect(estimateCalorieBudget({ ...input, formula: "manual" })).toBeNull();
    expect(estimateCalorieBudget({ ...input, age: 16 })).toBeNull();
    state.user = { ...input, formula: "female", bmr: 9999 };
    state.weight = 70;
    state.weeklyLossTarget = 0.5;
    const original = dailyCalorieEstimate();
    state.customActivities = [{ kcal: 900 }];
    expect(dailyCalorieEstimate()).toEqual(original);
    state.weight = 65;
    expect(dailyCalorieEstimate().bmr).toBe(1402);
  });
  it("allows rest days and explicit intake completion without requiring four meals", () => {
    state.restDay = true;
    state.intakeStatus = "complete";
    meals[0] = summarizeMeal({ id: "breakfast", entries: [entry("food", 500)] });
    expect(todayTasks().find((task) => task.label === "训练").done).toBe(true);
    expect(todayTasks().find((task) => task.label === "饮食记录").done).toBe(true);
  });
});
