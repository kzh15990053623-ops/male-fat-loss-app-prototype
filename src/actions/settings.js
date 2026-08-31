import { state, runtime, AUTH_EMAIL_KEY, API_STATE_URL, CURRENT_SCHEMA_VERSION } from "../app-state.js";
import { todayKey } from "../app-utils.js";
import { calorieRecommendation, recommendedProteinGrams } from "../app-logic.js";
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

export function openSettings(action = "settings") {
  runtime.settingsReturnAction = action;
  runtime.settingsReturnHash = location.hash.startsWith("#tab-") ? location.hash : `#tab-${state.activeTab}`;
  state.setupFieldErrors = {};
  state.settingsDraft = null;
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
  return values;
}

export function validateCoreSettings(values) {
  const errors = {};
  if (values.height < 120 || values.height > 230) errors.height = "请输入 120–230cm";
  if (values.age < 16 || values.age > 80) errors.age = "请输入 16–80 岁";
  if (values.waist < 50 || values.waist > 180) errors.waist = "请输入 50–180cm";
  if (values.targetWeight < 40 || values.targetWeight > 180) errors.targetWeight = "请输入 40–180kg";
  else if (values.weight && values.targetWeight >= values.weight) errors.targetWeight = "减脂目标必须低于当前体重";
  if (values.targetWaist < 50 || values.targetWaist > 160) errors.targetWaist = "请输入 50–160cm";
  else if (values.waist && values.targetWaist >= values.waist) errors.targetWaist = "目标腰围必须低于当前腰围";
  if (values.calories < 1200 || values.calories > 3600) errors.calories = "请输入 1200–3600 kcal";
  if (values.weeklyLoss < 0.1 || values.weeklyLoss > 1.2) errors.weeklyLoss = "请输入 0.1–1.2kg";
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
  requestAnimationFrame(() => document.querySelector(`[name="${firstKey}"]`)?.focus({ preventScroll: false }));
}

export async function saveSettingsFromForm() {
  if (runtime.pendingActions.has("saveSettings")) return false;
  const values = settingsValuesFromForm();
  const errors = validateCoreSettings(values);
  if (Object.keys(errors).length) return showSettingsErrors(errors, values);
  state.settingsDraft = { ...values };
  return runExclusiveAction("saveSettings", async () => {
    try {
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

export function handleSettingNumberInput(input) {
  if (state.settingsDraft && input.name) state.settingsDraft[input.name] = Number(input.value || 0);
  clearInlineFieldError(input, state.setupFieldErrors, input.name);
}
