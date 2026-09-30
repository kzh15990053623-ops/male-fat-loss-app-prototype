import assert from "node:assert/strict";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(String(key)) ?? null,
  setItem: (key, value) => storage.set(String(key), String(value)),
  removeItem: (key) => storage.delete(String(key)),
};

const { initialStateSnapshot, initialMealsSnapshot, CURRENT_SCHEMA_VERSION } = await import("../src/app-state.js");
const {
  DAILY_RECORD_LIMIT,
  METRIC_LOG_LIMIT,
  createBlankDailyRecord,
  createNewUserState,
  mergePayloads,
  migratePayload,
  normalizeMealList,
  normalizeMetricLogs,
  persistedStateFrom,
  pruneDailyRecords,
} = await import("../src/app-sync.js");
const serverData = await import("../server/data.mjs");

assert.equal(METRIC_LOG_LIMIT, serverData.METRIC_LOG_LIMIT, "client/server metric log limits must match");
assert.equal(METRIC_LOG_LIMIT, 90);
assert.equal(DAILY_RECORD_LIMIT, serverData.DAILY_RECORD_LIMIT, "client/server daily record limits must match");
assert.equal(DAILY_RECORD_LIMIT, 180);

const newUser = createNewUserState();
assert.equal(CURRENT_SCHEMA_VERSION, 3);
assert.equal(newUser.schemaVersion, 3);
assert.equal(newUser.setupCompleted, false);
assert.equal(newUser.weight, 0);
assert.equal(newUser.waist, 0);
assert.equal(newUser.waterMl, 0);
assert.equal(newUser.steps, 0);
assert.equal(newUser.sleep, 0);
assert.deepEqual(newUser.dailyRecords, {});
assert.deepEqual(newUser.weightLogs, []);
assert.deepEqual(newUser.waistLogs, []);
assert.deepEqual(newUser.customActivities, []);
assert.equal("baseBurned" in newUser, false);
assert.equal("chartData" in newUser, false);

const blankMeals = normalizeMealList(null);
assert.equal(blankMeals.length, 4);
assert.ok(blankMeals.every((meal) => meal.calories === 0));
assert.ok(blankMeals.every((meal) => meal.foods.length === 0));
assert.ok(blankMeals.every((meal) => meal.nutritionSource === "manual"));

const blankRecord = createBlankDailyRecord("2026-08-08");
assert.equal(blankRecord.waterMl, 0);
assert.equal(blankRecord.steps, 0);
assert.equal(blankRecord.sleep, 0);
assert.equal(blankRecord.weight, null);
assert.equal(blankRecord.waist, null);
assert.ok(blankRecord.meals.every((meal) => meal.calories === 0));

const legacy = migratePayload({
  state: {
    ...initialStateSnapshot,
    schemaVersion: 2,
    setupCompleted: true,
    weight: 86.4,
    waist: 96,
    targetWeight: 76,
    targetWaist: 86,
    baseBurned: 420,
    chartData: { weight: [88, 87, 86.4], burned: [420, 420, 420] },
    weightLogs: [{ date: "2026-08-07", label: "昨天", value: 86.7 }],
    waistLogs: [{ date: "2026-08-07", label: "昨天", value: 96.2 }],
    preferences: { unit: "metric", reminderTime: "20:45", pushEnabled: true, aiAssist: false },
    dailyRecords: {
      "2026-08-07": {
        date: "2026-08-07",
        meals: [
          {
            ...initialMealsSnapshot[1],
            calories: 680,
            status: "已记录",
            foods: ["牛肉饭"],
            nutritionSource: "ai",
            aiMeta: { requestId: "req-old", model: "model-a", confidence: 0.8, needsReview: false, edited: true },
          },
        ],
        waterMl: 1600,
        steps: 7200,
        sleep: 6.8,
        customActivities: [{ id: 1, name: "快走", type: "有氧恢复", minutes: 30, kcal: 150 }],
      },
    },
  },
  meals: [
    {
      ...initialMealsSnapshot[1],
      calories: 680,
      status: "已记录",
      foods: ["牛肉饭"],
      nutritionSource: "ai",
      aiMeta: { requestId: "req-old", model: "model-a", confidence: 0.8, needsReview: false, edited: true },
    },
  ],
  updatedAt: "2026-08-07T12:00:00.000Z",
});

assert.equal(legacy.state.schemaVersion, 3);
assert.equal(legacy.migrated, true);
assert.equal(legacy.state.baseBurned, undefined);
assert.equal(legacy.state.chartData, undefined);
assert.equal(legacy.state.weight, 86.4);
assert.equal(legacy.state.preferences.reminderTime, "20:45");
assert.equal(legacy.state.weightLogs[0].value, 86.7);
assert.equal(legacy.state.dailyRecords["2026-08-07"].meals[0].calories, 680);
assert.equal(legacy.meals[0].nutritionSource, "ai");
assert.equal(legacy.meals[0].aiMeta.edited, true);

const persisted = persistedStateFrom({
  ...legacy.state,
  toast: "transient",
  authPasswordVisible: true,
  setupFieldErrors: { weight: "bad" },
  undoActivity: { id: 1 },
  baseBurned: 420,
  chartData: { fake: true },
});
assert.equal(persisted.toast, undefined);
assert.equal(persisted.authPasswordVisible, undefined);
assert.equal(persisted.setupFieldErrors, undefined);
assert.equal(persisted.undoActivity, undefined);
assert.equal(persisted.baseBurned, undefined);
assert.equal(persisted.chartData, undefined);

const logs = normalizeMetricLogs([
  { date: "2026-08-08", value: 86.1 },
  { date: "2026-08-07", value: 86.5 },
  { date: "", value: 90 },
  { date: "2026-08-06", value: "bad" },
]);
assert.deepEqual(
  logs.map((item) => item.value),
  [86.5, 86.1],
);

const overflowRecords = Object.fromEntries(
  Array.from({ length: 200 }, (_, index) => {
    const day = String((index % 28) + 1).padStart(2, "0");
    return [
      `2025-${String(Math.floor(index / 28) + 1).padStart(2, "0")}-${day}`,
      { date: `2025-${String(Math.floor(index / 28) + 1).padStart(2, "0")}-${day}`, updatedAt: `2025-01-01T00:00:00.000Z` },
    ];
  }),
);
assert.equal(Object.keys(pruneDailyRecords(overflowRecords)).length, 180, "daily records must be pruned to the rolling window");
const prunedPersisted = persistedStateFrom({ ...initialStateSnapshot, dailyRecords: overflowRecords });
assert.equal(Object.keys(prunedPersisted.dailyRecords).length, 180, "persisted state must prune old daily records");

const localPackage = {
  state: {
    ...initialStateSnapshot,
    weightLogs: [{ date: "2026-08-08", label: "8/8", value: 85.9 }],
    dailyRecords: {
      "2026-08-08": { date: "2026-08-08", steps: 5000, updatedAt: "2026-08-08T10:00:00.000Z" },
      "2026-08-09": { date: "2026-08-09", steps: 6200, updatedAt: "2026-08-09T09:00:00.000Z" },
    },
  },
  meals: [],
  localUpdatedAt: "2026-08-09T10:00:00.000Z",
};
const serverPackage = {
  state: {
    ...initialStateSnapshot,
    weightLogs: [
      { date: "2026-08-08", label: "8/8", value: 86.1 },
      { date: "2026-08-09", label: "8/9", value: 86.0 },
    ],
    dailyRecords: {
      "2026-08-08": { date: "2026-08-08", steps: 4500, updatedAt: "2026-08-08T08:00:00.000Z" },
      "2026-08-10": { date: "2026-08-10", steps: 7100, updatedAt: "2026-08-10T09:00:00.000Z" },
    },
  },
  meals: [],
  updatedAt: "2026-08-10T12:00:00.000Z",
  migrated: false,
};
const merged = mergePayloads(localPackage, serverPackage, { updatedAt: "2026-08-10T12:00:00.000Z" });
assert.equal(merged.localContributed, true, "local-only days must be marked as a local contribution");
assert.equal(merged.payload.state.dailyRecords["2026-08-09"].steps, 6200, "local-only day must survive the merge");
assert.equal(merged.payload.state.dailyRecords["2026-08-10"].steps, 7100, "server-only day must survive the merge");
assert.equal(merged.payload.state.dailyRecords["2026-08-08"].steps, 5000, "newer local day must win the per-day conflict");
assert.deepEqual(
  merged.payload.state.weightLogs.map((item) => [item.date, item.value]),
  [
    ["2026-08-08", 86.1],
    ["2026-08-09", 86.0],
  ],
  "same-date metric conflicts follow the newer package, server-only dates are kept",
);

console.log("Data model v3 checks passed");
