import { state, meals, runtime, initialStateSnapshot, initialMealsSnapshot, CURRENT_SCHEMA_VERSION } from "./app-state.js";
import { cloneData, isPlainRecord, finiteNumber, todayKey, dateLabel, timestampMs } from "./app-utils.js";

// Keep in sync with server/data.mjs (validated by scripts/validate-data-model.mjs).
const METRIC_LOG_LIMIT = 90;
const DAILY_RECORD_LIMIT = 180;

function createBlankMeals() {
  return initialMealsSnapshot.map((meal) => ({
    ...cloneData(meal),
    calories: 0,
    status: "待记录",
    foods: [],
    macros: { protein: 0, carbs: 0, fat: 0 },
    nutritionSource: "manual",
    aiMeta: null,
  }));
}

function normalizeAiMeta(value) {
  if (!isPlainRecord(value)) return null;
  return {
    requestId: typeof value.requestId === "string" ? value.requestId : "",
    model: typeof value.model === "string" ? value.model : "",
    confidence: finiteNumber(value.confidence) ? Math.max(0, Math.min(1, value.confidence)) : null,
    needsReview: Boolean(value.needsReview),
    edited: Boolean(value.edited),
  };
}

function normalizeMealList(rawMeals, fallbackMeals = createBlankMeals()) {
  if (!Array.isArray(rawMeals)) return fallbackMeals;
  const normalized = rawMeals.filter(isPlainRecord).map((meal, index) => {
    const fallback = fallbackMeals[index] || initialMealsSnapshot[index] || {};
    const macros = isPlainRecord(meal.macros) ? meal.macros : {};
    const nutritionSource = meal.nutritionSource === "ai" ? "ai" : "manual";
    return {
      ...fallback,
      id: typeof meal.id === "string" ? meal.id : fallback.id || `meal-${index}`,
      name: typeof meal.name === "string" ? meal.name : fallback.name || "餐次",
      calories: finiteNumber(meal.calories) ? Math.max(0, meal.calories) : fallback.calories || 0,
      status: typeof meal.status === "string" ? meal.status : fallback.status || "待记录",
      foods: Array.isArray(meal.foods) ? meal.foods.map(String).slice(0, 20) : [],
      macros: {
        protein: finiteNumber(macros.protein) ? Math.max(0, macros.protein) : 0,
        carbs: finiteNumber(macros.carbs) ? Math.max(0, macros.carbs) : 0,
        fat: finiteNumber(macros.fat) ? Math.max(0, macros.fat) : 0,
      },
      nutritionSource,
      aiMeta: nutritionSource === "ai" ? normalizeAiMeta(meal.aiMeta) : null,
    };
  });
  return normalized.length ? normalized : fallbackMeals;
}

function createNewUserState() {
  const nextState = cloneData(initialStateSnapshot);
  Object.assign(nextState, {
    setupCompleted: false,
    setupFieldErrors: {},
    schemaVersion: CURRENT_SCHEMA_VERSION,
    currentDate: todayKey(),
    dailyRecords: {},
    lastSyncedAt: "",
    syncError: "",
    syncPending: false,
    settingsOpen: false,
    clearConfirmOpen: false,
    deleteAccountOpen: false,
    undoActivity: null,
  });
  return nextState;
}

function normalizeMetricLogs(rawLogs = []) {
  if (!Array.isArray(rawLogs)) return [];
  return rawLogs
    .filter(isPlainRecord)
    .map((item) => ({
      date: typeof item.date === "string" ? item.date : "",
      label: typeof item.label === "string" ? item.label : "",
      value: Number(item.value),
    }))
    .filter((item) => item.date && Number.isFinite(item.value))
    .sort((a, b) => timestampMs(a.date) - timestampMs(b.date))
    .slice(-METRIC_LOG_LIMIT);
}

function pruneDailyRecords(rawRecords, limit = DAILY_RECORD_LIMIT) {
  if (!isPlainRecord(rawRecords)) return {};
  const entries = Object.entries(rawRecords).filter(([date, record]) => date && isPlainRecord(record));
  if (entries.length <= limit) return Object.fromEntries(entries);
  entries.sort((a, b) => timestampMs(b[0]) - timestampMs(a[0]));
  return Object.fromEntries(entries.slice(0, limit));
}

function metricValueForDate(logKey, date) {
  const item = normalizeMetricLogs(state[logKey]).find((entry) => entry.date === date);
  return item ? item.value : null;
}

function createBlankDailyRecord(date = todayKey()) {
  return {
    date,
    meals: createBlankMeals(),
    waterMl: 0,
    steps: 0,
    sleep: 0,
    calorieBudget: state.calorieBudget || 0,
    weight: metricValueForDate("weightLogs", date),
    waist: metricValueForDate("waistLogs", date),
    customActivities: [],
    taskOverrides: {},
    workoutDone: false,
    updatedAt: "",
  };
}

function upsertMetricLog(logKey, value, date = todayKey()) {
  if (!finiteNumber(Number(value))) return;
  const logs = normalizeMetricLogs(state[logKey]);
  const next = { date, label: dateLabel(date), value: Number(Number(value).toFixed(1)) };
  const existingIndex = logs.findIndex((item) => item.date === date);
  if (existingIndex >= 0) logs[existingIndex] = next;
  else logs.push(next);
  state[logKey] = logs.sort((a, b) => timestampMs(a.date) - timestampMs(b.date)).slice(-METRIC_LOG_LIMIT);
}

function currentDailyRecord(date = todayKey(), updatedAt = "") {
  return {
    date,
    meals: cloneData(meals),
    waterMl: state.waterMl,
    steps: state.steps,
    sleep: state.sleep,
    calorieBudget: state.calorieBudget,
    weight: metricValueForDate("weightLogs", date),
    waist: metricValueForDate("waistLogs", date),
    customActivities: cloneData(state.customActivities || []),
    taskOverrides: cloneData(state.taskOverrides || {}),
    workoutDone: Boolean(state.workoutDone),
    updatedAt: typeof updatedAt === "string" ? updatedAt : "",
  };
}

function updateTodayRecord(updatedAt = new Date().toISOString()) {
  const date = todayKey();
  state.schemaVersion = CURRENT_SCHEMA_VERSION;
  state.currentDate = date;
  state.dailyRecords = isPlainRecord(state.dailyRecords) ? state.dailyRecords : {};
  state.dailyRecords[date] = currentDailyRecord(date, updatedAt);
}

function applyDailyRecord(record) {
  if (!isPlainRecord(record)) return;
  if (Array.isArray(record.meals)) meals.splice(0, meals.length, ...normalizeMealList(record.meals));
  if (finiteNumber(record.waterMl)) state.waterMl = record.waterMl;
  if (finiteNumber(record.steps)) state.steps = record.steps;
  if (finiteNumber(record.sleep)) state.sleep = record.sleep;
  if (finiteNumber(record.weight)) {
    state.weight = record.weight;
    state.weightDraft = record.weight;
  }
  if (finiteNumber(record.waist)) {
    state.waist = record.waist;
    state.waistDraft = record.waist;
  }
  state.customActivities = Array.isArray(record.customActivities) ? record.customActivities : [];
  state.taskOverrides = isPlainRecord(record.taskOverrides) ? record.taskOverrides : {};
  state.workoutDone = Boolean(record.workoutDone);
}

function hydrateTodayFromRecords() {
  const date = todayKey();
  state.currentDate = date;
  state.dailyRecords = isPlainRecord(state.dailyRecords) ? state.dailyRecords : {};
  applyDailyRecord(state.dailyRecords[date] || createBlankDailyRecord(date));
}

function persistedStateFrom(rawState) {
  if (!isPlainRecord(rawState)) return {};
  const {
    toast,
    appLoading,
    authError,
    authFieldErrors,
    authLoading,
    authMode,
    authEmail,
    authPasswordVisible,
    authProvider,
    localAuthAvailable,
    authServiceStatus,
    authServiceMessage,
    authServiceCode,
    authSignupAllowed,
    authReadinessCheckedAt,
    settingsOpen,
    clearConfirmOpen,
    deleteAccountOpen,
    activeTab,
    authRequired,
    backendStatus,
    syncError,
    syncErrorKind,
    syncPending,
    setupFieldErrors,
    settingsDraft,
    undoActivity,
    baseBurned,
    chartData,
    streak,
    bestStreak,
    ...persistedState
  } = cloneData(rawState);

  if (!isPlainRecord(persistedState.preferences)) delete persistedState.preferences;
  if (!isPlainRecord(persistedState.user)) delete persistedState.user;
  if (!isPlainRecord(persistedState.taskOverrides)) persistedState.taskOverrides = {};
  persistedState.dailyRecords = pruneDailyRecords(persistedState.dailyRecords);
  if (!Array.isArray(persistedState.mealTemplates)) persistedState.mealTemplates = [];
  if (!Array.isArray(persistedState.weightLogs)) persistedState.weightLogs = [];
  if (!Array.isArray(persistedState.waistLogs)) persistedState.waistLogs = [];
  if (!Array.isArray(persistedState.customActivities)) persistedState.customActivities = [];
  if (isPlainRecord(persistedState.mealDraft)) {
    persistedState.mealDraft.aiResult = null;
    persistedState.mealDraft.aiStatus = "idle";
    persistedState.mealDraft.aiError = "";
    persistedState.mealDraft.aiErrorCode = "";
    persistedState.mealDraft.aiRequestId = "";
    persistedState.mealDraft.aiRetryable = false;
  }
  persistedState.schemaVersion = CURRENT_SCHEMA_VERSION;
  return persistedState;
}

function migratePayloadCore(rawPayload) {
  if (!isPlainRecord(rawPayload)) return null;
  const sourceVersion = Number(rawPayload.state?.schemaVersion || 2);
  const migratedState = persistedStateFrom(rawPayload.state || {});
  if (sourceVersion < 3 && rawPayload.state?.setupCompleted === undefined) migratedState.setupCompleted = true;
  migratedState.schemaVersion = CURRENT_SCHEMA_VERSION;
  migratedState.dailyRecords = pruneDailyRecords(
    Object.fromEntries(
      Object.entries(isPlainRecord(migratedState.dailyRecords) ? migratedState.dailyRecords : {})
        .filter(([, record]) => isPlainRecord(record))
        .map(([date, record]) => [
          date,
          {
            ...record,
            date,
            meals: normalizeMealList(record.meals),
            calorieBudget: finiteNumber(record.calorieBudget) ? record.calorieBudget : Number(migratedState.calorieBudget || 0),
          },
        ]),
    ),
  );
  return {
    state: migratedState,
    meals: normalizeMealList(rawPayload.meals),
    localUpdatedAt:
      (typeof rawPayload.localUpdatedAt === "string" && rawPayload.localUpdatedAt) ||
      (typeof rawPayload.updatedAt === "string" && rawPayload.updatedAt) ||
      "",
    updatedAt: rawPayload.updatedAt || null,
    revision: Number.isInteger(Number(rawPayload.revision)) && Number(rawPayload.revision) >= 0 ? Number(rawPayload.revision) : 0,
    migrated: sourceVersion < CURRENT_SCHEMA_VERSION,
  };
}

function syncBaseSnapshot(rawPayload) {
  const migrated = migratePayloadCore(rawPayload);
  if (!migrated) return null;
  return {
    state: migrated.state,
    meals: migrated.meals,
    localUpdatedAt: migrated.localUpdatedAt,
    updatedAt: migrated.updatedAt,
    revision: migrated.revision,
  };
}

function migratePayload(rawPayload) {
  const migrated = migratePayloadCore(rawPayload);
  if (!migrated) return null;
  return {
    ...migrated,
    dirtyBaseRevision:
      typeof rawPayload.dirtyBaseRevision === "number" &&
      Number.isInteger(rawPayload.dirtyBaseRevision) &&
      rawPayload.dirtyBaseRevision >= 0
        ? rawPayload.dirtyBaseRevision
        : null,
    syncBase: syncBaseSnapshot(rawPayload.syncBase),
  };
}

function persistedPayload() {
  return {
    state: persistedStateFrom(state),
    meals: cloneData(meals),
    localUpdatedAt: runtime.localUpdatedAt,
    revision: runtime.stateRevision,
    dirtyBaseRevision: runtime.dirtyBaseRevision,
  };
}

function storedPayload() {
  const payload = persistedPayload();
  if (Number.isInteger(runtime.dirtyBaseRevision) && runtime.dirtyBaseRevision >= 0 && runtime.syncBasePayload) {
    payload.syncBase = cloneData(runtime.syncBasePayload);
  }
  return payload;
}

function canonicalData(value) {
  if (Array.isArray(value)) return value.map(canonicalData);
  if (!isPlainRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalData(value[key])]),
  );
}

function dailyRecordContent(record) {
  if (!isPlainRecord(record)) return null;
  const content = cloneData(record);
  delete content.updatedAt;
  return canonicalData(content);
}

function persistedDataFingerprint() {
  const persistedState = persistedStateFrom(state);
  delete persistedState.clearedAt;
  delete persistedState.syncRevision;
  delete persistedState.lastSyncedAt;
  delete persistedState.currentDate;
  Object.values(persistedState.dailyRecords || {}).forEach((record) => {
    if (isPlainRecord(record)) delete record.updatedAt;
  });
  return JSON.stringify(canonicalData({ state: persistedState, meals: cloneData(meals) }));
}

function capturePersistedDataFingerprint() {
  runtime.lastPersistedDataFingerprint = persistedDataFingerprint();
  runtime.lastMutationChanged = false;
  if (!Number.isInteger(runtime.dirtyBaseRevision) || runtime.dirtyBaseRevision < 0) {
    runtime.syncBasePayload = syncBaseSnapshot(persistedPayload());
  }
  return runtime.lastPersistedDataFingerprint;
}

function prepareLocalMutation(now = new Date().toISOString()) {
  const changedAt = typeof now === "string" && timestampMs(now) ? now : new Date().toISOString();
  const fingerprint = persistedDataFingerprint();
  if (runtime.lastPersistedDataFingerprint && fingerprint === runtime.lastPersistedDataFingerprint) {
    runtime.lastMutationChanged = false;
    return storedPayload();
  }
  // A persisted clearedAt marks an observed server tombstone. The first real
  // local edit replaces that marker; serialization/manual sync alone must not.
  delete state.clearedAt;
  const date = todayKey();
  state.schemaVersion = CURRENT_SCHEMA_VERSION;
  state.currentDate = date;
  state.dailyRecords = isPlainRecord(state.dailyRecords) ? state.dailyRecords : {};
  const existing = state.dailyRecords[date];
  const candidate = currentDailyRecord(date, typeof existing?.updatedAt === "string" ? existing.updatedAt : "");
  if (!existing || JSON.stringify(dailyRecordContent(existing)) !== JSON.stringify(dailyRecordContent(candidate))) {
    state.dailyRecords[date] = { ...candidate, updatedAt: changedAt };
  }
  runtime.localUpdatedAt = changedAt;
  if (!Number.isInteger(runtime.dirtyBaseRevision) || runtime.dirtyBaseRevision < 0) {
    runtime.dirtyBaseRevision = runtime.stateRevision;
  }
  const currentMutationRevision = Number(runtime.localMutationRevision);
  runtime.localMutationRevision =
    (Number.isInteger(currentMutationRevision) && currentMutationRevision >= 0 ? currentMutationRevision : 0) + 1;
  runtime.lastMutationChanged = true;
  runtime.lastPersistedDataFingerprint = persistedDataFingerprint();
  return storedPayload();
}

function hasStoredAppData(payload) {
  return isPlainRecord(payload) && (isPlainRecord(payload.state) || Array.isArray(payload.meals));
}

function mergeDailyRecordsByDate(localRecords, serverRecords, localPackageNewer) {
  const local = isPlainRecord(localRecords) ? localRecords : {};
  const server = isPlainRecord(serverRecords) ? serverRecords : {};
  const merged = {};
  let localContributed = false;
  const dates = new Set([...Object.keys(server), ...Object.keys(local)]);
  dates.forEach((date) => {
    const localRecord = local[date];
    const serverRecord = server[date];
    if (localRecord && !serverRecord) {
      merged[date] = localRecord;
      localContributed = true;
      return;
    }
    if (serverRecord && !localRecord) {
      merged[date] = serverRecord;
      return;
    }
    const localNewer = timestampMs(localRecord.updatedAt) > timestampMs(serverRecord.updatedAt);
    const serverNewer = timestampMs(serverRecord.updatedAt) > timestampMs(localRecord.updatedAt);
    if (localNewer || (!serverNewer && localPackageNewer)) {
      merged[date] = localRecord;
      localContributed = true;
    } else {
      merged[date] = serverRecord;
    }
  });
  return { merged: pruneDailyRecords(merged), localContributed };
}

function mergeMetricLogsByDate(localLogs, serverLogs, localPackageNewer) {
  const byDate = new Map(normalizeMetricLogs(serverLogs).map((item) => [item.date, item]));
  let localContributed = false;
  normalizeMetricLogs(localLogs).forEach((item) => {
    const existing = byDate.get(item.date);
    if (!existing) {
      byDate.set(item.date, item);
      localContributed = true;
      return;
    }
    if (existing.value !== item.value && localPackageNewer) {
      byDate.set(item.date, item);
      localContributed = true;
    }
  });
  const merged = [...byDate.values()].sort((a, b) => timestampMs(a.date) - timestampMs(b.date)).slice(-METRIC_LOG_LIMIT);
  return { merged, localContributed };
}

function mergePayloadsLegacy(localPayload, migratedServerPayload, rawServerData) {
  const localState = isPlainRecord(localPayload.state) ? localPayload.state : {};
  const serverState = isPlainRecord(migratedServerPayload.state) ? migratedServerPayload.state : {};
  const localPackageNewer = timestampMs(localPayload.localUpdatedAt) > timestampMs(rawServerData.updatedAt);
  const daily = mergeDailyRecordsByDate(localState.dailyRecords, serverState.dailyRecords, localPackageNewer);
  const weight = mergeMetricLogsByDate(localState.weightLogs, serverState.weightLogs, localPackageNewer);
  const waist = mergeMetricLogsByDate(localState.waistLogs, serverState.waistLogs, localPackageNewer);
  const baseState = cloneData(localPackageNewer ? localState : serverState);
  baseState.weightLogs = weight.merged;
  baseState.waistLogs = waist.merged;
  baseState.dailyRecords = daily.merged;
  const timestampCandidates = [localPayload.localUpdatedAt, rawServerData.updatedAt, migratedServerPayload.localUpdatedAt]
    .filter((value) => typeof value === "string" && timestampMs(value))
    .sort((a, b) => timestampMs(b) - timestampMs(a));
  return {
    payload: {
      state: baseState,
      meals: localPackageNewer && Array.isArray(localPayload.meals) ? localPayload.meals : migratedServerPayload.meals,
      localUpdatedAt: timestampCandidates[0] || "",
      revision:
        Number.isInteger(Number(rawServerData.revision)) && Number(rawServerData.revision) >= 0 ? Number(rawServerData.revision) : 0,
      migrated: Boolean(migratedServerPayload.migrated),
    },
    localContributed: localPackageNewer || daily.localContributed || weight.localContributed || waist.localContributed,
    safeMerge: false,
  };
}

const MISSING_MERGE_VALUE = Symbol("missing-merge-value");

function mergeValuesEqual(left, right) {
  if (left === MISSING_MERGE_VALUE || right === MISSING_MERGE_VALUE) return left === right;
  return JSON.stringify(canonicalData(left)) === JSON.stringify(canonicalData(right));
}

function cloneMergeValue(value) {
  return value === MISSING_MERGE_VALUE ? MISSING_MERGE_VALUE : cloneData(value);
}

function stableArrayIdentity(path) {
  const key = path[path.length - 1];
  if (key === "weightLogs" || key === "waistLogs") return "date";
  if (key === "meals" || key === "customActivities" || key === "mealTemplates") return "id";
  return "";
}

function keyedArrayEntries(value, identity) {
  if (value === MISSING_MERGE_VALUE) return { order: [], values: new Map() };
  if (!Array.isArray(value)) return null;
  const order = [];
  const values = new Map();
  for (const item of value) {
    if (!isPlainRecord(item) || item[identity] === undefined || item[identity] === null) return null;
    const key = `${typeof item[identity]}:${String(item[identity])}`;
    if (values.has(key)) return null;
    order.push(key);
    values.set(key, item);
  }
  return { order, values };
}

function mergeKeyedArrays(base, local, remote, path, localWinsConflict) {
  const identity = stableArrayIdentity(path);
  if (!identity) return null;
  const baseEntries = keyedArrayEntries(base, identity);
  const localEntries = keyedArrayEntries(local, identity);
  const remoteEntries = keyedArrayEntries(remote, identity);
  if (!baseEntries || !localEntries || !remoteEntries) return null;
  const preferredOrder = localWinsConflict ? localEntries.order : remoteEntries.order;
  const keys = [...preferredOrder, ...(localWinsConflict ? remoteEntries.order : localEntries.order), ...baseEntries.order].filter(
    (key, index, all) => all.indexOf(key) === index,
  );
  const merged = [];
  keys.forEach((key) => {
    const value = mergeThreeWayValue(
      baseEntries.values.has(key) ? baseEntries.values.get(key) : MISSING_MERGE_VALUE,
      localEntries.values.has(key) ? localEntries.values.get(key) : MISSING_MERGE_VALUE,
      remoteEntries.values.has(key) ? remoteEntries.values.get(key) : MISSING_MERGE_VALUE,
      [...path, key],
      localWinsConflict,
    );
    if (value !== MISSING_MERGE_VALUE) merged.push(value);
  });
  return merged;
}

function mergeThreeWayValue(base, local, remote, path, localWinsConflict) {
  if (mergeValuesEqual(local, base)) return cloneMergeValue(remote);
  if (mergeValuesEqual(remote, base) || mergeValuesEqual(local, remote)) return cloneMergeValue(local);

  if (path.includes("dailyRecords") && path[path.length - 1] === "updatedAt") {
    const timestamps = [local, remote, base]
      .filter((value) => value !== MISSING_MERGE_VALUE && typeof value === "string" && timestampMs(value))
      .sort((left, right) => timestampMs(right) - timestampMs(left));
    return timestamps[0] || "";
  }

  // An explicit removal on either side must not be resurrected merely because
  // the other side edited the same entity after the shared base.
  if (local === MISSING_MERGE_VALUE || remote === MISSING_MERGE_VALUE) return MISSING_MERGE_VALUE;

  const keyedArray = mergeKeyedArrays(base, local, remote, path, localWinsConflict);
  if (keyedArray) return keyedArray;

  if (isPlainRecord(local) && isPlainRecord(remote) && (isPlainRecord(base) || base === MISSING_MERGE_VALUE)) {
    const baseRecord = isPlainRecord(base) ? base : {};
    const keys = new Set([...Object.keys(baseRecord), ...Object.keys(local), ...Object.keys(remote)]);
    const merged = {};
    keys.forEach((key) => {
      const value = mergeThreeWayValue(
        Object.prototype.hasOwnProperty.call(baseRecord, key) ? baseRecord[key] : MISSING_MERGE_VALUE,
        Object.prototype.hasOwnProperty.call(local, key) ? local[key] : MISSING_MERGE_VALUE,
        Object.prototype.hasOwnProperty.call(remote, key) ? remote[key] : MISSING_MERGE_VALUE,
        [...path, key],
        localWinsConflict,
      );
      if (value !== MISSING_MERGE_VALUE) merged[key] = value;
    });
    return merged;
  }

  // Same-leaf concurrent edits cannot both survive. Prefer the unsynced local
  // value without consulting cross-device wall clocks.
  return cloneMergeValue(local);
}

// New clients persist the exact server base behind their first dirty edit.
// A 409 can therefore merge independent fields without an entire newer local
// package overwriting unrelated remote changes. Legacy payloads without that
// base keep the old load-time behavior, but conflict retries reject it.
function mergePayloads(localPayload, migratedServerPayload, rawServerData) {
  const dirtyBaseRevision = localPayload?.dirtyBaseRevision;
  const syncBase = syncBaseSnapshot(localPayload?.syncBase);
  const hasSafeMergeBase =
    typeof dirtyBaseRevision === "number" &&
    Number.isInteger(dirtyBaseRevision) &&
    dirtyBaseRevision >= 0 &&
    syncBase?.revision === dirtyBaseRevision;
  if (!hasSafeMergeBase) return mergePayloadsLegacy(localPayload, migratedServerPayload, rawServerData);

  const localState = persistedStateFrom(localPayload.state || {});
  const serverState = persistedStateFrom(migratedServerPayload.state || {});
  const baseState = persistedStateFrom(syncBase.state || {});
  const mergedState = mergeThreeWayValue(baseState, localState, serverState, ["state"], true);
  mergedState.dailyRecords = pruneDailyRecords(mergedState.dailyRecords);
  mergedState.weightLogs = normalizeMetricLogs(mergedState.weightLogs);
  mergedState.waistLogs = normalizeMetricLogs(mergedState.waistLogs);
  mergedState.schemaVersion = CURRENT_SCHEMA_VERSION;
  delete mergedState.clearedAt;
  const mergedMeals = mergeThreeWayValue(syncBase.meals, localPayload.meals, migratedServerPayload.meals, ["meals"], true);
  const timestampCandidates = [localPayload.localUpdatedAt, rawServerData.updatedAt, migratedServerPayload.localUpdatedAt]
    .filter((value) => typeof value === "string" && timestampMs(value))
    .sort((a, b) => timestampMs(b) - timestampMs(a));
  const payload = {
    state: mergedState,
    meals: normalizeMealList(mergedMeals),
    localUpdatedAt: timestampCandidates[0] || "",
    revision: Number.isInteger(Number(rawServerData.revision)) && Number(rawServerData.revision) >= 0 ? Number(rawServerData.revision) : 0,
    migrated: Boolean(migratedServerPayload.migrated),
  };
  return {
    payload,
    localContributed:
      !mergeValuesEqual(mergedState, serverState) || !mergeValuesEqual(payload.meals, normalizeMealList(migratedServerPayload.meals)),
    safeMerge: true,
  };
}

function resetAppData({ blank = false, revision = 0, localUpdatedAt = "" } = {}) {
  const authProvider = runtime.authProvider === "local" ? "local" : "supabase";
  const localAuthAvailable = Boolean(state.localAuthAvailable);
  const nextState = blank ? createNewUserState() : cloneData(initialStateSnapshot);
  const nextMeals = blank ? createBlankMeals() : cloneData(initialMealsSnapshot);
  Object.keys(state).forEach((key) => delete state[key]);
  Object.assign(state, nextState);
  state.appLoading = false;
  state.authProvider = authProvider;
  state.localAuthAvailable = localAuthAvailable;
  meals.splice(0, meals.length, ...nextMeals);
  runtime.stateRevision = Number.isInteger(Number(revision)) && Number(revision) >= 0 ? Number(revision) : 0;
  runtime.localUpdatedAt = typeof localUpdatedAt === "string" ? localUpdatedAt : "";
  runtime.localMutationRevision = 0;
  runtime.dirtyBaseRevision = null;
  runtime.syncBasePayload = null;
  hydrateTodayFromRecords();
  capturePersistedDataFingerprint();
}

if (!runtime.lastPersistedDataFingerprint) capturePersistedDataFingerprint();

export {
  METRIC_LOG_LIMIT,
  DAILY_RECORD_LIMIT,
  createBlankMeals,
  createNewUserState,
  normalizeMealList,
  normalizeMetricLogs,
  pruneDailyRecords,
  metricValueForDate,
  createBlankDailyRecord,
  upsertMetricLog,
  currentDailyRecord,
  updateTodayRecord,
  hydrateTodayFromRecords,
  persistedStateFrom,
  migratePayload,
  syncBaseSnapshot,
  persistedPayload,
  storedPayload,
  persistedDataFingerprint,
  capturePersistedDataFingerprint,
  prepareLocalMutation,
  hasStoredAppData,
  mergePayloads,
  resetAppData,
};
