import {
  state,
  runtime,
  STORAGE_KEY,
  LEGACY_STORAGE_KEY,
  LEGACY_TOKEN_KEY,
  LEGACY_REFRESH_TOKEN_KEY,
  AUTH_USER_KEY,
  AUTH_EMAIL_KEY,
  AUTH_PROVIDER_KEY,
  AUTH_VERIFIED_KEY,
  OFFLINE_ACCESS_TRUST_KEY,
} from "./app-state.js";
import { isPlainRecord } from "./app-utils.js";
import { migratePayload } from "./app-data.js";
import { archiveSnapshot } from "./history-store.js";
import { nativeRuntime } from "./native-runtime.js";

function storageKeyFor(baseKey = STORAGE_KEY, userId = runtime.authUserId) {
  const normalizedUserId = String(userId || "");
  return normalizedUserId ? `${baseKey}:${normalizedUserId}` : baseKey;
}

function userStorageKey() {
  return storageKeyFor(STORAGE_KEY);
}

function storageFailureMessage(error) {
  const name = String(error?.name || "");
  if (name === "QuotaExceededError") return "本机存储空间不足，当前修改尚未写入缓存";
  if (name === "SecurityError") return "浏览器阻止了本机存储，当前修改尚未写入缓存";
  return "本机缓存写入失败，请检查浏览器存储设置";
}

function noteStorageFailure(error) {
  state.syncErrorKind = "storage";
  state.syncError = storageFailureMessage(error);
}

function safeStorageGet(key) {
  try {
    return { ok: true, value: localStorage.getItem(key) };
  } catch (error) {
    noteStorageFailure(error);
    return { ok: false, value: null, error };
  }
}

function safeStorageSet(key, value) {
  try {
    localStorage.setItem(key, value);
    return { ok: true };
  } catch (error) {
    noteStorageFailure(error);
    return { ok: false, error };
  }
}

function safeStorageRemove(key) {
  try {
    localStorage.removeItem(key);
    return { ok: true };
  } catch (error) {
    noteStorageFailure(error);
    return { ok: false, error };
  }
}

function readStorageValue(key) {
  const result = safeStorageGet(key);
  return result.ok ? result.value || "" : "";
}

function removeStorageValue(key) {
  return safeStorageRemove(key).ok;
}

function parseStoredValue(key) {
  try {
    const read = safeStorageGet(key);
    if (!read.ok) return null;
    const stored = JSON.parse(read.value || "null");
    return isPlainRecord(stored) ? stored : null;
  } catch {
    state.syncErrorKind = "storage";
    state.syncError = "本机缓存损坏，原文件保留。请联网恢复或导入备份";
    return null;
  }
}

function normalizedAuthProvider(value) {
  return value === "local" ? "local" : "supabase";
}

function offlineMarkerKey(baseKey, userId = runtime.authUserId) {
  return storageKeyFor(baseKey, userId);
}

function verifiedSessionMarker(userId = runtime.authUserId) {
  const normalizedUserId = String(userId || "");
  if (!normalizedUserId || normalizedUserId !== runtime.authUserId) return null;
  const marker = parseStoredValue(offlineMarkerKey(AUTH_VERIFIED_KEY, normalizedUserId));
  if (
    marker?.version !== 1 ||
    marker.userId !== normalizedUserId ||
    marker.provider !== normalizedAuthProvider(runtime.authProvider) ||
    typeof marker.verifiedAt !== "string" ||
    !Number.isFinite(Date.parse(marker.verifiedAt))
  ) {
    return null;
  }
  return marker;
}

function recordVerifiedSession(session) {
  const userId = String(session?.user?.id || "");
  const accessToken = String(session?.accessToken || "");
  if (!userId || !accessToken || userId !== runtime.authUserId) return false;
  return safeStorageSet(
    offlineMarkerKey(AUTH_VERIFIED_KEY, userId),
    JSON.stringify({
      version: 1,
      userId,
      provider: normalizedAuthProvider(session.provider),
      verifiedAt: new Date().toISOString(),
    }),
  ).ok;
}

function isOfflineAccessTrusted(userId = runtime.authUserId) {
  const normalizedUserId = String(userId || "");
  if (!normalizedUserId || normalizedUserId !== runtime.authUserId || !verifiedSessionMarker(normalizedUserId)) {
    return false;
  }
  const marker = parseStoredValue(offlineMarkerKey(OFFLINE_ACCESS_TRUST_KEY, normalizedUserId));
  return Boolean(
    marker?.version === 1 &&
    marker.enabled === true &&
    marker.userId === normalizedUserId &&
    marker.provider === normalizedAuthProvider(runtime.authProvider),
  );
}

function setOfflineAccessTrusted(enabled, userId = runtime.authUserId) {
  const normalizedUserId = String(userId || "");
  if (!normalizedUserId || normalizedUserId !== runtime.authUserId) return false;
  const trustKey = offlineMarkerKey(OFFLINE_ACCESS_TRUST_KEY, normalizedUserId);
  if (!enabled) return safeStorageRemove(trustKey).ok;
  if (!runtime.accessToken || runtime.authSessionStatus !== "authenticated" || !verifiedSessionMarker(normalizedUserId)) {
    return false;
  }
  return safeStorageSet(
    trustKey,
    JSON.stringify({
      version: 1,
      enabled: true,
      userId: normalizedUserId,
      provider: normalizedAuthProvider(runtime.authProvider),
      trustedAt: new Date().toISOString(),
    }),
  ).ok;
}

function clearOfflineAccessTrust(userId = runtime.authUserId) {
  const normalizedUserId = String(userId || "");
  if (!normalizedUserId) return true;
  const trustRemoved = safeStorageRemove(offlineMarkerKey(OFFLINE_ACCESS_TRUST_KEY, normalizedUserId)).ok;
  const verificationRemoved = safeStorageRemove(offlineMarkerKey(AUTH_VERIFIED_KEY, normalizedUserId)).ok;
  return trustRemoved && verificationRemoved;
}

function isValidOfflinePayloadEnvelope(value) {
  if (!isPlainRecord(value) || (!isPlainRecord(value.state) && !Array.isArray(value.meals))) return false;
  if (value.state !== undefined && !isPlainRecord(value.state)) return false;
  if (value.meals !== undefined && value.meals !== null && !Array.isArray(value.meals)) return false;
  if (value.state?.dailyRecords !== undefined && !isPlainRecord(value.state.dailyRecords)) return false;
  if (!Object.prototype.hasOwnProperty.call(value, "revision")) return true;
  return typeof value.revision === "number" && Number.isInteger(value.revision) && value.revision >= 0;
}

function readStoredPayload({ requireValidOfflineEnvelope = false } = {}) {
  if (nativeRuntime()) return migratePayload(nativeRuntime().store.latestDevicePayload());
  if (!runtime.authUserId) return null;
  runtime.loadedLegacyStorageKey = "";
  const current = parseStoredValue(storageKeyFor(STORAGE_KEY));
  if (current) return !requireValidOfflineEnvelope || isValidOfflinePayloadEnvelope(current) ? migratePayload(current) : null;
  const legacyKey = storageKeyFor(LEGACY_STORAGE_KEY);
  const legacy = parseStoredValue(legacyKey);
  if (requireValidOfflineEnvelope && legacy && !isValidOfflinePayloadEnvelope(legacy)) return null;
  if (legacy) runtime.loadedLegacyStorageKey = legacyKey;
  return migratePayload(legacy);
}

function readOfflineStoredPayload() {
  if (!runtime.authUserId) return null;
  runtime.loadedLegacyStorageKey = "";
  for (const baseKey of [STORAGE_KEY, LEGACY_STORAGE_KEY]) {
    const key = storageKeyFor(baseKey);
    const read = safeStorageGet(key);
    if (!read.ok) return null;
    if (read.value === null) continue;
    try {
      const raw = JSON.parse(read.value);
      if (!isValidOfflinePayloadEnvelope(raw)) return null;
      if (baseKey === LEGACY_STORAGE_KEY) runtime.loadedLegacyStorageKey = key;
      return migratePayload(raw);
    } catch {
      // Keep damaged cache available for recovery; never fall back to stale
      // legacy data when a current account cache exists but cannot be read.
      return null;
    }
  }
  return null;
}

function writeStoredPayload(payload) {
  if (nativeRuntime()) {
    const normalized = { ...payload, localUpdatedAt: typeof payload.localUpdatedAt === "string" ? payload.localUpdatedAt : "" };
    const pending = nativeRuntime().store.saveDevicePayload(normalized);
    void pending.catch((error) => {
      state.syncErrorKind = "storage";
      state.syncError = error.message || "手机存储写入失败";
    });
    return { ok: true, pending };
  }
  if (!runtime.authUserId) return { ok: true, skipped: true };
  const existing = safeStorageGet(userStorageKey());
  if (existing.ok && existing.value) {
    try {
      JSON.parse(existing.value);
    } catch {
      const preserved = safeStorageSet(`${userStorageKey()}:damaged`, existing.value);
      if (!preserved.ok) return preserved;
    }
  }
  const localUpdatedAt = typeof payload.localUpdatedAt === "string" ? payload.localUpdatedAt : "";
  const write = safeStorageSet(userStorageKey(), JSON.stringify({ ...payload, localUpdatedAt }));
  if (!write.ok) return write;
  if (runtime.loadedLegacyStorageKey) {
    safeStorageRemove(runtime.loadedLegacyStorageKey);
    runtime.loadedLegacyStorageKey = "";
  }
  return globalThis.indexedDB ? { ok: true, pending: archiveSnapshot(payload) } : { ok: true };
}

function storeSession(session) {
  if (runtime.authUserId !== session.user?.id || runtime.authProvider !== normalizedAuthProvider(session.provider)) {
    runtime.authSessionGeneration += 1;
    runtime.historyRows = [];
    runtime.historyConflicts = [];
    runtime.historyBefore = "";
    runtime.historyPage = 0;
  }
  runtime.accessToken = session.accessToken || "";
  runtime.authUserId = session.user?.id || "";
  runtime.authProvider = session.provider === "local" ? "local" : "supabase";
  runtime.authSessionStatus = runtime.accessToken && runtime.authUserId ? "authenticated" : "anonymous";
  runtime.offlineSessionActive = false;
  runtime.offlineSessionReason = "";
  state.authProvider = runtime.authProvider;
  safeStorageRemove(LEGACY_TOKEN_KEY);
  safeStorageRemove(LEGACY_REFRESH_TOKEN_KEY);
  if (runtime.authUserId) safeStorageSet(AUTH_USER_KEY, runtime.authUserId);
  else safeStorageRemove(AUTH_USER_KEY);
  if (session.user?.email) safeStorageSet(AUTH_EMAIL_KEY, session.user.email);
  if (runtime.authUserId) safeStorageSet(AUTH_PROVIDER_KEY, runtime.authProvider);
  else safeStorageRemove(AUTH_PROVIDER_KEY);
  if (runtime.authSessionStatus === "authenticated") recordVerifiedSession(session);
}

function clearSession() {
  runtime.historyRows = [];
  runtime.historyConflicts = [];
  runtime.historyBefore = "";
  runtime.historyPage = 0;
  runtime.recoveryVerified = false;
  runtime.aiNutritionController?.abort();
  runtime.aiNutritionController = null;
  runtime.aiNutritionSequence += 1;
  runtime.mealPhotoSequence += 1;
  runtime.mealPhoto = null;
  runtime.mealPhotoLoading = false;
  runtime.mealPhotoError = "";
  runtime.mealPhotoReviewKey = "";
  runtime.nutritionBudget = null;
  runtime.nutritionBudgetMessage = "";
  runtime.nutritionBudgetLoading = false;
  const previousUserId = runtime.authUserId;
  runtime.authSessionGeneration += 1;
  for (const key of ["saveTimer", "inputSaveTimer", "retryTimer"]) {
    clearTimeout(runtime[key]);
    runtime[key] = undefined;
  }
  if (previousUserId) clearOfflineAccessTrust(previousUserId);
  runtime.accessToken = "";
  runtime.authUserId = "";
  runtime.authProvider = "supabase";
  runtime.authSessionStatus = "anonymous";
  runtime.offlineSessionActive = false;
  runtime.offlineSyncReadRequired = false;
  runtime.offlineSessionReason = "";
  state.authProvider = "supabase";
  clearLegacyAuthStorage();
  safeStorageRemove(AUTH_USER_KEY);
  safeStorageRemove(AUTH_PROVIDER_KEY);
}

function clearLegacyAuthStorage() {
  safeStorageRemove(LEGACY_TOKEN_KEY);
  safeStorageRemove(LEGACY_REFRESH_TOKEN_KEY);
}

// A tab-local checkpoint prevents upgrade votes from replacing another
// tab's unsaved draft in the account's shared browser cache.
function preserveUpgradeDraft() {
  if (!runtime.authUserId) return true;
  try {
    sessionStorage.setItem("wenjian-upgrade-draft", JSON.stringify({ userId: runtime.authUserId, draft: state.mealDraft }));
    return true;
  } catch {
    return false;
  }
}
function restoreUpgradeDraft() {
  try {
    const item = JSON.parse(sessionStorage.getItem("wenjian-upgrade-draft") || "null");
    if (item?.userId !== runtime.authUserId || !isPlainRecord(item.draft)) return;
    state.mealDraft = item.draft;
    sessionStorage.removeItem("wenjian-upgrade-draft");
  } catch {
    /* The account cache is still available. */
  }
}

export {
  storageKeyFor,
  userStorageKey,
  safeStorageGet,
  safeStorageSet,
  safeStorageRemove,
  readStorageValue,
  removeStorageValue,
  parseStoredValue,
  isOfflineAccessTrusted,
  setOfflineAccessTrusted,
  clearOfflineAccessTrust,
  readStoredPayload,
  readOfflineStoredPayload,
  writeStoredPayload,
  storeSession,
  clearSession,
  clearLegacyAuthStorage,
  preserveUpgradeDraft,
  restoreUpgradeDraft,
};
