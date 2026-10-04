import { validateStateWrite } from "../state-contract.js";
import {
  archiveSnapshot,
  loadHistoryPage,
  readLocalHistory,
  saveHistoryEdit,
  prepareHistoryRecovery,
  restoreHistoryRecovery,
} from "../history-store.js";
import { state, runtime, AUTH_EMAIL_KEY, STORAGE_KEY, API_STATE_URL, CURRENT_SCHEMA_VERSION } from "../app-state.js";
import { todayKey } from "../app-utils.js";
import { calorieRecommendation, estimateCalorieBudget, recommendedProteinGrams, totalBurned } from "../app-logic.js";
import { numericSettingFields } from "../settings-fields.js";
import { nativeRuntime } from "../native-runtime.js";
import { disconnectNativeCloud } from "../native-cloud.js";
import { isOfflineAccessTrusted, setOfflineAccessTrusted } from "../app-storage.js";
import { clearMealDraftAI } from "./meal.js";
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
  loadStoredState,
  resetAppData,
  saveStoredState,
  syncStateNow,
} from "../app-sync.js";
import { migratePayload, normalizeHistoryRecord, createNewUserState, createBlankMeals } from "../app-data.js";
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

const draftNumber = (value) => (Number(value) > 0 ? value : "");

export function createSettingsDraft() {
  return {
    waterTarget: state.waterTarget,
    stepsTarget: state.stepsTarget,
    sleepTarget: state.sleepTarget || 7,
    height: draftNumber(state.user.height),
    age: draftNumber(state.user.age),
    weight: draftNumber(state.weight),
    waist: draftNumber(state.waist),
    targetWeight: draftNumber(state.targetWeight),
    targetWaist: draftNumber(state.targetWaist),
    weeklyLoss: state.weeklyLossTarget,
    calories: draftNumber(state.user.dailyCalories),
    formula: state.user.formula || "manual",
    activityLevel: state.user.activityLevel || "light",
    goalMode: state.user.goalMode || "loss",
    calorieMode: state.user.dailyCalories > 0 ? "manual" : "auto",
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

function readSettingsDraftFromForm() {
  const draft = readFormValues([
    ...Object.keys(numericSettingFields).map((key) => ({
      key,
      selector: `[data-setting-field="${key}"]`,
      parse: (raw) => raw ?? "",
    })),
    { key: "formula", selector: "[data-setting-formula]", fallback: state.user.formula || "manual" },
    { key: "activityLevel", selector: "[data-setting-activity]", fallback: state.user.activityLevel || "light" },
    { key: "goalMode", selector: "[data-setting-goal-mode]", fallback: state.user.goalMode || "loss" },
    { key: "unit", selector: "[data-setting-unit]", fallback: state.preferences.unit },
    { key: "reminderTime", selector: "[data-setting-reminder]", fallback: state.preferences.reminderTime },
    { key: "aiAssist", selector: "[data-setting-ai]", parse: (raw) => raw !== "off" },
  ]);
  for (const [key, fallback] of [
    ["waterTarget", state.waterTarget],
    ["stepsTarget", state.stepsTarget],
    ["sleepTarget", state.sleepTarget || 7],
  ])
    draft[key] = Number(document.querySelector(`[name="${key}"]`)?.value ?? fallback);
  draft.pushEnabled = Boolean(document.querySelector("[data-setting-push]")?.checked);
  draft.trustedOfflineAccess = document.querySelector("[data-setting-trusted-offline]")?.checked ?? isOfflineAccessTrusted();
  draft.calorieMode = state.settingsDraft?.calorieMode || (state.user.dailyCalories > 0 ? "manual" : "auto");
  return draft;
}

function numericSettingsFromDraft(draft) {
  const values = { ...draft };
  for (const key of Object.keys(numericSettingFields)) {
    const raw = draft[key];
    values[key] = raw === "" || raw === null || raw === undefined ? null : Number(raw);
  }
  return values;
}

export function settingsValuesFromForm() {
  return numericSettingsFromDraft(readSettingsDraftFromForm());
}

export function validateCoreSettings(values) {
  const errors = {};
  Object.entries(numericSettingFields).forEach(([key, field]) => {
    const value = values[key];
    if (value === null || value === undefined || value === "") {
      if (!field.optional && !(key === "height" && values.formula === "manual")) errors[key] = field.required;
    } else if (!Number.isFinite(value) || value < field.min || value > field.max) {
      errors[key] = field.message;
    }
  });
  for (const [key, min, max] of [
    ["waterTarget", 250, 5000],
    ["stepsTarget", 0, 50000],
    ["sleepTarget", 0, 12],
  ])
    if (values[key] !== undefined && (!Number.isFinite(values[key]) || values[key] < min || values[key] > max))
      errors[key] = "习惯目标超出有效范围";
  if (!errors.weight && !errors.targetWeight && values.goalMode !== "maintain" && values.targetWeight >= values.weight) {
    errors.targetWeight = "减脂目标必须低于当前体重";
  }
  if (!errors.waist && !errors.targetWaist && values.waist !== null && values.targetWaist !== null && values.targetWaist >= values.waist) {
    errors.targetWaist = "目标腰围必须低于当前腰围";
  }
  return errors;
}

function applySettingsValues(values) {
  state.user.height = values.height;
  state.user.age = values.age;
  state.weight = Number(values.weight.toFixed(1));
  state.weightDraft = state.weight;
  state.waist = values.waist === null ? 0 : Number(values.waist.toFixed(1));
  state.waistDraft = "";
  state.targetWeight = Number(values.targetWeight.toFixed(1));
  state.targetWaist = values.targetWaist === null ? 0 : Number(values.targetWaist.toFixed(1));
  state.weeklyLossTarget = Number(values.weeklyLoss.toFixed(1));
  state.user.dailyCalories = Math.round(values.calories);
  state.calorieBudget = state.user.dailyCalories;
  state.user.formula = values.formula;
  state.user.activityLevel = values.activityLevel;
  state.user.goalMode = values.goalMode;
  state.user.bmr =
    estimateCalorieBudget({
      height: state.user.height,
      age: state.user.age,
      weight: state.weight,
      weeklyLoss: state.weeklyLossTarget,
      formula: values.formula,
      activityLevel: values.activityLevel,
      goalMode: values.goalMode,
    })?.bmr || 0;
  state.proteinTarget = recommendedProteinGrams(state.weight);
  state.waterTarget = values.waterTarget || state.waterTarget;
  state.stepsTarget = values.stepsTarget ?? state.stepsTarget;
  state.sleepTarget = values.sleepTarget ?? state.sleepTarget ?? 7;
  state.preferences.unit = values.unit;
  state.preferences.reminderTime = values.reminderTime;
  state.preferences.aiAssist = values.aiAssist;
  if (!values.aiAssist) clearMealDraftAI();
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
  const draft = readSettingsDraftFromForm();
  const values = numericSettingsFromDraft(draft);
  const errors = validateCoreSettings(values);
  if (Object.keys(errors).length) return showSettingsErrors(errors, draft);
  state.settingsDraft = draft;
  return runExclusiveAction("saveSettings", async () => {
    try {
      const trustChanged = !nativeRuntime() && values.trustedOfflineAccess !== isOfflineAccessTrusted();
      if (trustChanged && !setOfflineAccessTrusted(values.trustedOfflineAccess)) {
        throw new Error("未能保存此设备的离线查看设置，请确认账号仍处于登录状态");
      }
      applySettingsValues(values);
      state.setupFieldErrors = {};
      upsertMetricLog("weightLogs", state.weight);
      if (state.waist > 0) {
        if (!state.startWaist) state.startWaist = state.waist;
        upsertMetricLog("waistLogs", state.waist);
      }
      await ensureReminderPermission();
      scheduleLocalReminder();
      saveStoredState();
      if (nativeRuntime() && !(await syncStateNow({ localOnly: true }))) throw new Error("设置未能写入手机，请重试");
      state.settingsDraft = null;
      closeSettings();
      showToast("设置已保存");
      return true;
    } catch (error) {
      state.settingsDraft = draft;
      showToast(error?.message || "设置保存失败，请稍后重试");
      return false;
    }
  });
}

export async function completeSetupFromForm() {
  const draft = readSettingsDraftFromForm();
  const values = numericSettingsFromDraft(draft);
  const errors = validateCoreSettings(values);
  if (Object.keys(errors).length) return showSettingsErrors(errors, draft);
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
  if (state.waist > 0) upsertMetricLog("waistLogs", state.waist);
  updateTodayRecord();
  saveStoredState();
  if (nativeRuntime() && !(await syncStateNow({ localOnly: true }))) {
    state.setupCompleted = false;
    state.settingsDraft = draft;
    showToast("建档未能写入手机，请重试");
    render();
    return false;
  }
  scheduleLocalReminder();
  showToast("基础目标已保存");
  render();
  requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: "instant" }));
}

function checkBackupSession(userId, generation) {
  if (!nativeRuntime() && (userId !== runtime.authUserId || generation !== runtime.authSessionGeneration))
    throw new Error("导出或恢复过程中账号已切换，请在原账号重试");
}

export async function exportUserData() {
  const userId = runtime.authUserId;
  const generation = runtime.authSessionGeneration;
  if (nativeRuntime() && !(await syncStateNow({ localOnly: true }))) {
    showToast("手机记录尚未保存，暂不能导出");
    return false;
  }
  if (!nativeRuntime()) {
    try {
      await archiveSnapshot({ state });
      await loadHistoryPage({ all: true });
      checkBackupSession(userId, generation);
    } catch (error) {
      showToast(error.message || "完整历史暂时无法读取，请重试导出");
      return false;
    }
  }
  const full = persistedPayload();
  if (!nativeRuntime()) {
    const history = await readLocalHistory(userId);
    try {
      checkBackupSession(userId, generation);
    } catch (error) {
      showToast(error.message);
      return false;
    }
    full.state.dailyRecords = {
      ...Object.fromEntries(history.filter((row) => row.record).map((row) => [row.date, row.record])),
      ...state.dailyRecords,
      ...Object.fromEntries(history.filter((row) => row.pending && row.record).map((row) => [row.date, row.record])),
    };
    full.historyPending = history.filter((row) => row.pending || row.conflict);
    for (const field of ["weight", "waist"]) {
      const records = Object.entries(full.state.dailyRecords)
        .filter(([, record]) => Number(record[field]) > 0)
        .map(([date, record]) => ({ date, value: record[field] }));
      full.state[field + "Logs"] = [...new Map([...records, ...state[field + "Logs"]].map((item) => [item.date, item])).values()].sort(
        (a, b) => a.date.localeCompare(b.date),
      );
    }
  }
  const payload = {
    exportedAt: new Date().toISOString(),
    user: { id: runtime.authUserId, email: readStorageValue(AUTH_EMAIL_KEY) || state.authEmail || "", provider: runtime.authProvider },
    data: full,
    damagedCache: !nativeRuntime() ? readStorageValue(`${STORAGE_KEY}:${runtime.authUserId}:damaged`) || undefined : undefined,
  };
  if (nativeRuntime()) {
    const { Filesystem, Directory, Encoding, Share } = nativeRuntime();
    try {
      const path = `backups/fitness-data-${todayKey()}.json`;
      await Filesystem.writeFile({
        path,
        data: JSON.stringify(payload, null, 2),
        directory: Directory.Cache,
        encoding: Encoding.UTF8,
        recursive: true,
      });
      const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
      await Share.share({ title: "稳减数据备份", files: [uri], dialogTitle: "保存稳减数据备份" });
      showToast("备份已生成，请选择保存位置");
      return true;
    } catch (error) {
      showToast(error.message || "导出失败，请重试");
      return false;
    }
  }
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
  return true;
}

export async function importUserData(input) {
  const userId = runtime.authUserId;
  const generation = runtime.authSessionGeneration;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return false;
  if (file.size > 8 * 1024 * 1024) return (showToast("备份超过 8MB，请检查文件"), false);
  try {
    const backup = JSON.parse(await file.text());
    checkBackupSession(userId, generation);
    const raw = backup?.data;
    validateStateWrite(raw);
    if (!nativeRuntime() && backup.user?.id && backup.user.id !== runtime.authUserId)
      throw new Error("此备份属于另一个账号，请登录原账号后恢复");
    const migrated = migratePayload(raw);
    if (!migrated) throw new Error("备份数据无法读取");
    const pendingHistory = nativeRuntime()
      ? []
      : prepareHistoryRecovery(raw.historyPending === undefined ? [] : raw.historyPending, userId, raw.state.calorieBudget);
    const days = Object.keys(raw.state.dailyRecords || {}).length;
    const weights = migrated.state.weightLogs?.length || 0;
    if (
      !window.confirm(
        `将恢复这份备份的日常档案，历史按日期合并。\n备份包含 ${days} 天记录、${weights} 条体重记录。\n${nativeRuntime() ? "手机将断开当前云账号。" : "恢复前会下载当前完整备份；冲突双方会保留。"}确认导入？`,
      )
    )
      return false;
    if (!nativeRuntime()) {
      if (!(await exportUserData())) throw new Error("恢复前备份未完成，未修改当前记录");
      checkBackupSession(userId, generation);
      for (const [date, record] of Object.entries(raw.state.dailyRecords)) {
        checkBackupSession(userId, generation);
        await saveHistoryEdit(date, normalizeHistoryRecord(record, date, raw.state.calorieBudget), userId);
      }
      await restoreHistoryRecovery(pendingHistory, userId);
      checkBackupSession(userId, generation);
      const revision = runtime.stateRevision;
      const baseline = runtime.syncBasePayload;
      migrated.revision = revision;
      migrated.dirtyBaseRevision = revision;
      migrated.syncBase = baseline;
      clearMealDraftAI();
      loadStoredState(migrated);
      runtime.syncBasePayload = baseline;
      state.authRequired = false;
      state.settingsOpen = false;
      saveStoredState();
      render();
      showToast("备份已恢复，历史正在同步；冲突可在历史页处理");
      return true;
    }
    if (!(await disconnectNativeCloud({ forget: true }))) throw new Error("请等待云账号操作结束后再导入");
    migrated.revision = 0;
    migrated.dirtyBaseRevision = 0;
    migrated.syncBase = null;
    await nativeRuntime().store.flushDeviceStore();
    await nativeRuntime().store.saveDevicePayload(migrated);
    clearMealDraftAI();
    loadStoredState(migrated);
    state.authRequired = false;
    state.settingsOpen = false;
    state.backendStatus = "device";
    render();
    showToast("备份已导入");
    return true;
  } catch (error) {
    showToast(error.message || "导入失败，请检查备份文件");
    return false;
  }
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
      if (nativeRuntime()) {
        if (!(await disconnectNativeCloud({ forget: true }))) throw new Error("请等待云账号操作结束后再清空");
        await nativeRuntime().store.flushDeviceStore();
        await nativeRuntime().store.saveDevicePayload(
          {
            state: createNewUserState(),
            meals: createBlankMeals(),
            revision: 0,
            localUpdatedAt: new Date().toISOString(),
          },
          { clearRecovery: true },
        );
        resetAppData({ blank: true });
        state.authRequired = false;
        state.clearConfirmOpen = false;
        state.backendStatus = "device";
        render();
        showToast("手机记录已清空");
        return true;
      }
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

function draftCalorieEstimate(draft) {
  return estimateCalorieBudget({
    ...draft,
    activityKcal: state.setupCompleted ? totalBurned() : 0,
    formula: draft.formula,
    activityLevel: draft.activityLevel,
    goalMode: draft.goalMode,
  });
}

function refreshEstimatedCalories() {
  const draft = state.settingsDraft;
  if (draft?.calorieMode !== "auto") return;
  const estimate = draftCalorieEstimate(draft);
  if (estimate) draft.calories = String(estimate.suggested);
  const field = document.querySelector('[data-setting-field="calories"]');
  if (field) {
    field.value = draft.calories;
    if (estimate) clearInlineFieldError(field, state.setupFieldErrors, "calories");
  }
  const note = document.querySelector("[data-calorie-estimate-note]");
  if (note)
    note.textContent = estimate
      ? "估算，可调整"
      : draft.calories
        ? "基础信息有效后更新估算"
        : "填写身高、年龄、当前体重和每周减重目标后自动估算";
}

export function useEstimatedCalories() {
  if (!state.settingsDraft) state.settingsDraft = createSettingsDraft();
  const draft = readSettingsDraftFromForm();
  const estimate = draftCalorieEstimate(draft);
  if (!estimate) {
    showToast("请先填写有效的身高、年龄、当前体重和每周减重目标");
    return;
  }
  state.settingsDraft = { ...draft, calorieMode: "auto" };
  refreshEstimatedCalories();
  document.querySelector('[data-setting-field="calories"]')?.focus();
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
  if (input.name === "calories") state.settingsDraft.calorieMode = "manual";
  clearInlineFieldError(input, state.setupFieldErrors, input.name, input.name === "weeklyLoss" ? "field-hint-weeklyLoss" : "");
  if (["height", "age", "weight", "weeklyLoss", "formula", "activityLevel", "goalMode"].includes(input.name)) refreshEstimatedCalories();
  else if (input.name === "calories") {
    const note = document.querySelector("[data-calorie-estimate-note]");
    if (note) note.textContent = "手动预算；可重新使用估算值";
  }
}

export const handleSettingNumberInput = handleSettingControlInput;
