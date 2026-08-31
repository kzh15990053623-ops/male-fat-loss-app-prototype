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
} from "./app-state.js";
import { isPlainRecord } from "./app-utils.js";
import { migratePayload } from "./app-data.js";

function storageKeyFor(baseKey = STORAGE_KEY) {
  return runtime.authUserId ? `${baseKey}:${runtime.authUserId}` : baseKey;
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
    safeStorageRemove(key);
    return null;
  }
}

function readStoredPayload() {
  if (!runtime.authUserId) return null;
  runtime.loadedLegacyStorageKey = "";
  const current = parseStoredValue(storageKeyFor(STORAGE_KEY));
  if (current) return migratePayload(current);
  const legacyKey = storageKeyFor(LEGACY_STORAGE_KEY);
  const legacy = parseStoredValue(legacyKey);
  if (legacy) runtime.loadedLegacyStorageKey = legacyKey;
  return migratePayload(legacy);
}

function writeStoredPayload(payload) {
  if (!runtime.authUserId) return { ok: true, skipped: true };
  const localUpdatedAt = typeof payload.localUpdatedAt === "string" ? payload.localUpdatedAt : "";
  const write = safeStorageSet(userStorageKey(), JSON.stringify({ ...payload, localUpdatedAt }));
  if (!write.ok) return write;
  if (runtime.loadedLegacyStorageKey) {
    safeStorageRemove(runtime.loadedLegacyStorageKey);
    runtime.loadedLegacyStorageKey = "";
  }
  return { ok: true };
}

function storeSession(session) {
  runtime.accessToken = session.accessToken || "";
  runtime.authUserId = session.user?.id || "";
  runtime.authProvider = session.provider === "local" ? "local" : "supabase";
  state.authProvider = runtime.authProvider;
  safeStorageRemove(LEGACY_TOKEN_KEY);
  safeStorageRemove(LEGACY_REFRESH_TOKEN_KEY);
  if (runtime.authUserId) safeStorageSet(AUTH_USER_KEY, runtime.authUserId);
  else safeStorageRemove(AUTH_USER_KEY);
  if (session.user?.email) safeStorageSet(AUTH_EMAIL_KEY, session.user.email);
  if (runtime.authUserId) safeStorageSet(AUTH_PROVIDER_KEY, runtime.authProvider);
  else safeStorageRemove(AUTH_PROVIDER_KEY);
}

function clearSession() {
  runtime.accessToken = "";
  runtime.authUserId = "";
  runtime.authProvider = "supabase";
  state.authProvider = "supabase";
  clearLegacyAuthStorage();
  safeStorageRemove(AUTH_USER_KEY);
  safeStorageRemove(AUTH_PROVIDER_KEY);
}

function clearLegacyAuthStorage() {
  safeStorageRemove(LEGACY_TOKEN_KEY);
  safeStorageRemove(LEGACY_REFRESH_TOKEN_KEY);
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
  readStoredPayload,
  writeStoredPayload,
  storeSession,
  clearSession,
  clearLegacyAuthStorage,
};
