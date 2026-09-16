import { state, runtime, AUTH_EMAIL_KEY, API_STATE_URL, CURRENT_SCHEMA_VERSION } from "../app-state.js";
import { todayKey } from "../app-utils.js";
import { calorieRecommendation, recommendedProteinGrams } from "../app-logic.js";
import { isOfflineAccessTrusted, setOfflineAccessTrusted } from "../app-storage.js";
import {
  upsertMetricLog,
  updateTodayRecord,
  persistedPayload,
  readStorageValue,
  authHeaders,
  refreshSession,
  setBackendStatus,
  stateWriteAcknowledgement,
  adoptRemoteClear,
  saveStoredState,
} from "../app-sync.js";
import {
  render,
  showToast,
  activateTab,
  focusSettingsPanel,
  runExclusiveAction,
  readFormValues,
  scheduleLocalReminder,
  ensureReminderPermission,
  clearInlineFieldError,
} from "./services.js";

const numericSettingRanges = {
  height: { min: 120, max: 230, message: "请输入 120–230cm" },
  age: { min: 16, max: 80, message: "请输入 16–80 岁" },
  weight: { min: 40, max: 200, message: "请输入 40–200kg" },
  waist: { min: 50, max: 180, message: "请输入 50–180cm" },
  targetWeight: { min: 40, max: 180, message: "请输入 40–180kg" },
  targetWaist: { min: 50, max: 160, message: "请输入 50–160cm" },
  calories: { min: 1200, max: 3600, message: "请输入 1200–3600 kcal" },
  weeklyLoss: { min: 0.1, max: 1.2, message: "请输入 0.1–1.2kg" },
};

export function createSettingsDraft() {
  return {
    height: state.user.height,
    age: state.user.age,
    weight: state.weight,
    waist: state.waist,
    targetWeight: state.targetWeight,
    targetWaist: state.targetWaist,
    weeklyLoss: state.weeklyLossTarget,
    calories: state.user.dailyCalories,
    unit: state.preferences.unit,
    reminderTime: state.preferences.reminderTime,
    aiAssist: state.preferences.aiAssist,
    pushEnabled: Boolean(state.preferences.pushEnabled),
    trustedOfflineAccess: isOfflineAccessTrusted(),
  };
}

export function openSettings(action = "settings") {
  runtime.settingsReturnAction = action;
  runtime.settingsReturnHash = location.hash.startsWith("#tab-") ? location.hash : `#tab-${state.activeTab}`;
  state.setupFieldErrors = {};
  state.settingsDraft = createSettingsDraft();
  state.settingsOpen = true;
  if (location.hash !== "#settings") history.pushState(null, "", "#settings");
  render();
  requestAnimationFrame(focusSettingsPanel);
}

export function closeSettings(restoreFocus = true) {
  state.settingsOpen = false;
  state.setupFieldErrors = {};
  state.settingsDraft = null;
  if (location.hash === "#settings") {
    history.replaceState(null, "", runtime.settingsReturnHash || `#tab-${state.activeTab}`);
  }
  render();
  if (!restoreFocus) return;
  setTimeout(() => {
    document.querySelector(`[data-app-action="${runtime.settingsReturnAction}"]`)?.focus({ preventScroll: true });
  }, 0);
}

export function openClearConfirm() {
  state.clearConfirmOpen = true;
  render();
  requestAnimationFrame(focusSettingsPanel);
}

export function closeClearConfirm(restoreFocus = true) {
  state.clearConfirmOpen = false;
  render();
  if (!restoreFocus) return;
  setTimeout(() => {
    document.querySelector("[data-clear-data]")?.focus({ preventScroll: true });
  }, 0);
}

export function openDeleteAccountConfirm() {
  state.deleteAccountOpen = true;
  render();
  requestAnimationFrame(focusSettingsPanel);
}

export function closeDeleteAccountConfirm(restoreFocus = true) {
  state.deleteAccountOpen = false;
  render();
  if (!restoreFocus) return;
  setTimeout(() => {
    document.querySelector("[data-delete-account]")?.focus({ preventScroll: true });
  }, 0);
}

export function settingsValuesFromForm() {
  const values = readFormValues([
    { key: "height", selector: '[data-setting-field="height"]', numeric: true },
    { key: "age", selector: '[data-setting-field="age"]', numeric: true },
    { key: "weight", selector: '[data-setting-field="weight"]', numeric: true },
    { key: "waist", selector: '[data-setting-field="waist"]', numeric: true },
    { key: "targetWeight", selector: '[data-setting-field="targetWeight"]', numeric: true },
    { key: "targetWaist", selector: '[data-setting-field="targetWaist"]', numeric: true },
    { key: "weeklyLoss", selector: '[data-setting-field="weeklyLoss"]', numeric: true },
    { key: "calories", selector: '[data-setting-field="calories"]', numeric: true },
    { key: "unit", selector: "[data-setting-unit]", fallback: state.preferences.unit },
    { key: "reminderTime", selector: "[data-setting-reminder]", fallback: state.preferences.reminderTime },
    { key: "aiAssist", selector: "[data-setting-ai]", parse: (raw) => raw !== "off" },
  ]);
  values.pushEnabled = Boolean(document.querySelector("[data-setting-push]")?.checked);
  values.trustedOfflineAccess = document.querySelector("[data-setting-trusted-offline]")?.checked ?? isOfflineAccessTrusted();
  return values;
}

export function validateCoreSettings(values) {
  const errors = {};
  Object.entries(numericSettingRanges).forEach(([key, range]) => {
    if (!Number.isFinite(values[key]) || values[key] < range.min || values[key] > range.max) errors[key] = range.message;
  });
  if (!errors.weight && !errors.targetWeight && values.targetWeight >= values.weight) {
    errors.targetWeight = "减脂目标必须低于当前体重";
  }
  if (!errors.waist && !errors.targetWaist && values.targetWaist >= values.waist) {
    errors.targetWaist = "目标腰围必须低于当前腰围";
  }
  return errors;
}

function applySettingsValues(values) {
  state.user.height = values.height;
  state.user.age = values.age;
  state.weight = Number(values.weight.toFixed(1));
  state.weightDraft = state.weight;
  state.waist = Number(values.waist.toFixed(1));
  state.waistDraft = state.waist;
  state.targetWeight = Number(values.targetWeight.toFixed(1));
  state.targetWaist = Number(values.targetWaist.toFixed(1));
  state.weeklyLossTarget = Number(values.weeklyLoss.toFixed(1));
  state.user.dailyCalories = Math.round(values.calories);
  state.calorieBudget = state.user.dailyCalories;
  state.user.bmr = Math.round(10 * state.weight + 6.25 * state.user.height - 5 * state.user.age + 5);
  state.proteinTarget = recommendedProteinGrams(state.weight);
  state.preferences.unit = values.unit;
  state.preferences.reminderTime = values.reminderTime;
  state.preferences.aiAssist = values.aiAssist;
  state.preferences.pushEnabled = values.pushEnabled;
}

function showSettingsErrors(errors, values) {
  state.setupFieldErrors = errors;
  state.settingsDraft = values;
  render();
  const firstKey = Object.keys(errors)[0];
  requestAnimationFrame(() => document.querySelector(`[data-setting-field="${firstKey}"]`)?.focus({ preventScroll: false }));
}

export async function saveSettingsFromForm() {
  if (runtime.pendingActions.has("saveSettings")) return false;
  const values = settingsValuesFromForm();
  const errors = validateCoreSettings(values);
  if (Object.keys(errors).length) return showSettingsErrors(errors, values);
  state.settingsDraft = { ...values };
  return runExclusiveAction("saveSettings", async () => {
    try {
      const trustChanged = values.trustedOfflineAccess !== isOfflineAccessTrusted();
      if (trustChanged && !setOfflineAccessTrusted(values.trustedOfflineAccess)) {
        throw new Error("未能保存此设备的离线查看设置，请确认账号仍处于登录状态");
      }
      applySettingsValues(values);
      state.setupFieldErrors = {};
      upsertMetricLog("weightLogs", state.weight);
      upsertMetricLog("waistLogs", state.waist);
      await ensureReminderPermission();
      scheduleLocalReminder();
      saveStoredState();
      state.settingsDraft = null;
      closeSettings();
      showToast("设置已保存");
      return true;
    } catch (error) {
      state.settingsDraft = { ...values };
      showToast(error?.message || "设置保存失败，请稍后重试");
      return false;
    }
  });
}

export function completeSetupFromForm() {
  const values = settingsValuesFromForm();
  const errors = validateCoreSettings(values);
  if (Object.keys(errors).length) return showSettingsErrors(errors, values);
  applySettingsValues(values);
  state.setupFieldErrors = {};
  state.settingsDraft = null;
  state.setupCompleted = true;
  activateTab("home", { replace: true });
  state.startWeight = state.weight;
  state.startWaist = state.waist;
  state.weightLogs = [];
  state.waistLogs = [];
  upsertMetricLog("weightLogs", state.weight);
  upsertMetricLog("waistLogs", state.waist);
  updateTodayRecord();
  saveStoredState();
  scheduleLocalReminder();
  showToast("基础目标已保存");
  render();
}

export function exportUserData() {
  const payload = {
    exportedAt: new Date().toISOString(),
    user: { id: runtime.authUserId, email: readStorageValue(AUTH_EMAIL_KEY) || state.authEmail || "", provider: runtime.authProvider },
    data: persistedPayload(),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `fitness-data-${todayKey()}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast("数据已导出");
}

function cancelScheduledStateWrites() {
  ["saveTimer", "inputSaveTimer", "retryTimer"].forEach((key) => {
    clearTimeout(runtime[key]);
    runtime[key] = undefined;
  });
}

async function putClearTombstone(payload) {
  let response = await fetch(API_STATE_URL, {
    method: "PUT",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
  });
  if (response.status === 401 && (await refreshSession())) {
    response = await fetch(API_STATE_URL, {
      method: "PUT",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });
  }
  return response;
}

export async function clearUserData() {
  return runExclusiveAction("clearData", async () => {
    try {
      cancelScheduledStateWrites();
      if (runtime.syncPromise) await runtime.syncPromise;
      cancelScheduledStateWrites();
      if (!runtime.accessToken) throw new Error("当前离线，联网后才能安全清空全部记录");
      // Write a tombstone instead of deleting the row outright: other devices
      // holding stale local copies can see the clear revision and wipe instead
      // of resurrecting data. The server replaces clearedAt with its own clock.
      const clearedAt = new Date().toISOString();
      let tombstone = {
        state: { schemaVersion: CURRENT_SCHEMA_VERSION, clearedAt },
        meals: null,
        revision: runtime.stateRevision,
      };
      let response = await putClearTombstone(tombstone);
      if (response.status === 409) {
        const conflict = (await response.json().catch(() => null))?.conflict;
        if (typeof conflict?.revision === "number" && Number.isInteger(conflict.revision) && conflict.revision >= 0) {
          runtime.stateRevision = conflict.revision;
          tombstone = { ...tombstone, revision: conflict.revision };
          response = await putClearTombstone(tombstone);
        }
      }
      if (!response.ok) throw new Error(runtime.authProvider === "local" ? "本机账号清空失败" : "云端清空失败");
      const responseData = await response.json().catch(() => null);
      if (!stateWriteAcknowledgement(responseData) || !adoptRemoteClear(responseData)) {
        throw new Error("服务器返回的清空确认无效");
      }
      state.clearConfirmOpen = false;
      setBackendStatus(runtime.authProvider === "local" ? "device" : "online");
      showToast("数据已清空");
      return true;
    } catch (error) {
      showToast(error.message || "清空失败，请稍后再试");
      return false;
    }
  });
}

export function applyRecommendedCalories() {
  const recommendation = calorieRecommendation();
  state.user.dailyCalories = recommendation.suggested;
  state.calorieBudget = recommendation.suggested;
  saveStoredState();
  showToast("已应用推荐热量预算");
  render();
}

export function handleSettingControlInput(input) {
  if (!input.name) return;
  if (!state.settingsDraft) state.settingsDraft = createSettingsDraft();
  let value = input.value;
  if (input.matches('[type="checkbox"]')) value = input.checked;
  // 保留空值、0 和小数输入的原样草稿；提交时再统一转成数字校验。
  else if (input.matches("[data-setting-field]")) value = input.value;
  else if (input.matches("[data-setting-ai]")) value = input.value !== "off";
  state.settingsDraft[input.name] = value;
  clearInlineFieldError(input, state.setupFieldErrors, input.name);
}

export const handleSettingNumberInput = handleSettingControlInput;
