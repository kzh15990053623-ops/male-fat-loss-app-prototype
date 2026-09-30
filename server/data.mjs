export const defaultData = {
  state: null,
  meals: null,
  updatedAt: null,
};
// Keep in sync with METRIC_LOG_LIMIT in src/app-sync.js (validated by scripts/validate-data-model.mjs).
export const METRIC_LOG_LIMIT = 90;
// Keep in sync with DAILY_RECORD_LIMIT in src/app-sync.js (validated by scripts/validate-data-model.mjs).
export const DAILY_RECORD_LIMIT = 180;
const transientStateKeys = new Set([
  "appLoading",
  "toast",
  "authError",
  "authFieldErrors",
  "authLoading",
  "authMode",
  "authEmail",
  "authProvider",
  "localAuthAvailable",
  "settingsOpen",
  "clearConfirmOpen",
  "deleteAccountOpen",
  "activeTab",
  "authRequired",
  "backendStatus",
  "syncError",
  "syncPending",
  "setupFieldErrors",
  "settingsDraft",
  "authPasswordVisible",
  "authServiceStatus",
  "authServiceMessage",
  "authServiceCode",
  "authSignupAllowed",
  "authReadinessCheckedAt",
  "undoActivity",
]);

export function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// The state revision is embedded in the stored state JSON (syncRevision) so
// optimistic concurrency works against existing rows without a schema
// migration. Absent / malformed values mean revision 0.
export function stateRevision(state) {
  const revision = Number(isRecord(state) ? state.syncRevision : null);
  return Number.isInteger(revision) && revision >= 0 ? revision : 0;
}

export function stateWriteRevision(payload) {
  if (!isRecord(payload) || !Object.prototype.hasOwnProperty.call(payload, "revision")) {
    return { ok: false, missing: true, revision: null };
  }
  const revision = payload.revision;
  if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 0) {
    return { ok: false, missing: false, revision: null };
  }
  return { ok: true, missing: false, revision };
}

// A clear request is only a request marker. The server replaces its timestamp
// with the same authoritative time used for updatedAt and stores a minimal
// tombstone, so client clock skew cannot make pre-clear data look newer.
export function storedStateForWrite(rawState, nextRevision, updatedAt) {
  const state = sanitizeState(rawState) || {};
  delete state.syncRevision;
  const clearRequested = typeof state.clearedAt === "string" && Number.isFinite(Date.parse(state.clearedAt));
  if (clearRequested) {
    return {
      schemaVersion: Number.isInteger(Number(state.schemaVersion)) ? Number(state.schemaVersion) : 3,
      clearedAt: updatedAt,
      syncRevision: nextRevision,
    };
  }
  delete state.clearedAt;
  return { ...state, syncRevision: nextRevision };
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function safeText(value, fallback = "", maxLength = 120) {
  const text = typeof value === "string" ? value.trim() : fallback;
  return text.slice(0, maxLength);
}

function nonNegativeNumber(value, fallback = 0) {
  return finiteNumber(value) ? Math.max(0, value) : fallback;
}

function sanitizeAiMeta(value) {
  if (!isRecord(value)) return null;
  return {
    requestId: safeText(value.requestId, "", 120),
    model: safeText(value.model, "", 80),
    confidence: finiteNumber(value.confidence) ? Math.max(0, Math.min(1, value.confidence)) : null,
    needsReview: Boolean(value.needsReview),
    edited: Boolean(value.edited),
  };
}

export function sanitizeMeals(rawMeals) {
  if (!Array.isArray(rawMeals)) return null;
  return rawMeals
    .filter(isRecord)
    .slice(0, 20)
    .map((meal, index) => {
      const macros = isRecord(meal.macros) ? meal.macros : {};
      return {
        id: safeText(meal.id, `meal-${index}`, 40) || `meal-${index}`,
        name: safeText(meal.name, "餐次", 40) || "餐次",
        calories: nonNegativeNumber(meal.calories),
        status: safeText(meal.status, "待记录", 24) || "待记录",
        foods: Array.isArray(meal.foods)
          ? meal.foods
              .map((food) => safeText(food, "", 80))
              .filter(Boolean)
              .slice(0, 20)
          : [],
        macros: {
          protein: nonNegativeNumber(macros.protein),
          carbs: nonNegativeNumber(macros.carbs),
          fat: nonNegativeNumber(macros.fat),
        },
        nutritionSource: meal.nutritionSource === "ai" ? "ai" : "manual",
        aiMeta: meal.nutritionSource === "ai" ? sanitizeAiMeta(meal.aiMeta) : null,
      };
    });
}

function sanitizeMetricLogs(rawLogs) {
  if (!Array.isArray(rawLogs)) return undefined;
  return rawLogs
    .filter(isRecord)
    .map((item) => ({
      date: safeText(item.date, "", 24),
      label: safeText(item.label, "", 24),
      value: finiteNumber(item.value) ? item.value : null,
    }))
    .filter((item) => item.value !== null)
    .slice(-METRIC_LOG_LIMIT);
}

function sanitizeMealTemplates(rawTemplates) {
  if (!Array.isArray(rawTemplates)) return undefined;
  return rawTemplates
    .filter(isRecord)
    .map((template, index) => ({
      id: typeof template.id === "number" || typeof template.id === "string" ? template.id : `template-${index}`,
      name: safeText(template.name, "常用餐", 40) || "常用餐",
      food: safeText(template.food, "", 240),
      calories: nonNegativeNumber(template.calories),
      protein: nonNegativeNumber(template.protein),
      carbs: nonNegativeNumber(template.carbs),
      fat: nonNegativeNumber(template.fat),
    }))
    .slice(0, 20);
}

function sanitizeActivities(rawActivities) {
  if (!Array.isArray(rawActivities)) return undefined;
  return rawActivities
    .filter(isRecord)
    .map((activity, index) => ({
      id: typeof activity.id === "number" || typeof activity.id === "string" ? activity.id : `activity-${index}`,
      name: safeText(activity.name, "运动", 40) || "运动",
      type: safeText(activity.type, "运动", 40) || "运动",
      minutes: nonNegativeNumber(activity.minutes),
      kcal: nonNegativeNumber(activity.kcal),
      createdAt: safeText(activity.createdAt, "", 24),
    }))
    .slice(0, 100);
}

function sanitizeDailyRecord(rawRecord, fallbackDate = "") {
  if (!isRecord(rawRecord)) return null;
  const record = { ...rawRecord };
  record.date = safeText(record.date, fallbackDate, 24) || fallbackDate;
  if (Array.isArray(record.meals)) record.meals = sanitizeMeals(record.meals) || [];
  else delete record.meals;
  ["waterMl", "steps", "sleep", "weight", "waist", "calorieBudget"].forEach((key) => {
    if (!finiteNumber(record[key])) delete record[key];
  });
  record.customActivities = sanitizeActivities(record.customActivities) || [];
  record.taskOverrides = isRecord(record.taskOverrides) ? record.taskOverrides : {};
  record.workoutDone = Boolean(record.workoutDone);
  return record;
}

export function normalizeAppData(data = {}) {
  const safeData = isRecord(data) ? data : {};
  return {
    state: sanitizeState(safeData.state),
    meals: sanitizeMeals(safeData.meals),
    updatedAt: typeof safeData.updatedAt === "string" ? safeData.updatedAt : null,
  };
}

export function sanitizeState(rawState) {
  if (!isRecord(rawState)) return null;
  const state = { ...rawState };
  transientStateKeys.forEach((key) => delete state[key]);
  delete state.baseBurned;
  delete state.chartData;
  if (state.preferences !== undefined && !isRecord(state.preferences)) delete state.preferences;
  if (state.user !== undefined && !isRecord(state.user)) delete state.user;
  if (state.taskOverrides !== undefined && !isRecord(state.taskOverrides)) state.taskOverrides = {};
  if (state.dailyRecords !== undefined) {
    if (isRecord(state.dailyRecords)) {
      const sanitizedEntries = Object.entries(state.dailyRecords)
        .map(([date, record]) => [date, sanitizeDailyRecord(record, date)])
        .filter(([date, record]) => record && date);
      const timestampOf = (date) => {
        const parsed = Date.parse(String(date));
        return Number.isFinite(parsed) ? parsed : 0;
      };
      sanitizedEntries.sort((a, b) => timestampOf(b[0]) - timestampOf(a[0]));
      state.dailyRecords = Object.fromEntries(sanitizedEntries.slice(0, DAILY_RECORD_LIMIT));
    } else {
      state.dailyRecords = {};
    }
  }
  if (state.mealTemplates !== undefined) {
    const mealTemplates = sanitizeMealTemplates(state.mealTemplates);
    if (mealTemplates) state.mealTemplates = mealTemplates;
    else delete state.mealTemplates;
  }
  if (state.weightLogs !== undefined) {
    const weightLogs = sanitizeMetricLogs(state.weightLogs);
    if (weightLogs) state.weightLogs = weightLogs;
    else delete state.weightLogs;
  }
  if (state.waistLogs !== undefined) {
    const waistLogs = sanitizeMetricLogs(state.waistLogs);
    if (waistLogs) state.waistLogs = waistLogs;
    else delete state.waistLogs;
  }
  if (state.customActivities !== undefined) {
    const customActivities = sanitizeActivities(state.customActivities);
    if (customActivities) state.customActivities = customActivities;
    else delete state.customActivities;
  }
  return state;
}
