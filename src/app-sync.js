import { state, meals, runtime, API_STATE_URL, API_AUTH_REFRESH_URL, CURRENT_SCHEMA_VERSION } from "./app-state.js";
import { isPlainRecord, timestampMs } from "./app-utils.js";
import { backendStatusText } from "./app-logic.js";
import {
  normalizeMealList,
  normalizeMetricLogs,
  hydrateTodayFromRecords,
  persistedStateFrom,
  migratePayload,
  hasStoredAppData,
  resetAppData,
  persistedPayload,
  storedPayload,
  syncBaseSnapshot,
  capturePersistedDataFingerprint,
  prepareLocalMutation,
  mergePayloads,
} from "./app-data.js";
import {
  userStorageKey,
  safeStorageRemove,
  readStoredPayload,
  readOfflineStoredPayload,
  writeStoredPayload,
  storeSession,
  clearSession,
  isOfflineAccessTrusted,
} from "./app-storage.js";

let syncFeedbackHandler = () => {};

function setSyncFeedbackHandler(handler) {
  syncFeedbackHandler = typeof handler === "function" ? handler : () => {};
}

function applyPersistedData(rawStored) {
  const stored = migratePayload(rawStored);
  if (!stored) return;
  if (stored.state) {
    const storedState = stored.state;
    Object.keys(persistedStateFrom(state)).forEach((key) => {
      if (!Object.prototype.hasOwnProperty.call(storedState, key)) delete state[key];
    });
    Object.assign(state, storedState, {
      activityDraft: { ...state.activityDraft, ...(storedState.activityDraft || {}) },
      mealDraft: {
        ...state.mealDraft,
        ...(storedState.mealDraft || {}),
        aiResult: null,
        aiStatus: "idle",
        aiError: "",
        aiErrorCode: "",
        aiRequestId: "",
        aiRetryable: false,
      },
      preferences: { ...state.preferences, ...(storedState.preferences || {}) },
      user: { ...state.user, ...(storedState.user || {}) },
      mealTemplates: Array.isArray(storedState.mealTemplates) ? storedState.mealTemplates : [],
      weightLogs: normalizeMetricLogs(storedState.weightLogs),
      waistLogs: normalizeMetricLogs(storedState.waistLogs),
      taskOverrides: { ...(storedState.taskOverrides || {}) },
      dailyRecords: isPlainRecord(storedState.dailyRecords) ? storedState.dailyRecords : {},
    });
    state.setupCompleted = storedState.setupCompleted === true;
    state.schemaVersion = CURRENT_SCHEMA_VERSION;
    state.toast = "";
    state.authError = "";
    state.setupFieldErrors = {};
  }
  if (Array.isArray(stored.meals)) meals.splice(0, meals.length, ...normalizeMealList(stored.meals, meals));
  hydrateTodayFromRecords();
  capturePersistedDataFingerprint();
}

function payloadRevisionOf(payload) {
  const revision = Number(payload?.revision);
  return Number.isInteger(revision) && revision >= 0 ? revision : 0;
}

function hasValidClearRevision(payload) {
  return (
    typeof payload?.revision === "number" &&
    Number.isInteger(payload.revision) &&
    payload.revision >= 0 &&
    typeof payload?.state?.syncRevision === "number" &&
    Number.isInteger(payload.state.syncRevision) &&
    payload.state.syncRevision === payload.revision
  );
}

function clearMarkerOf(payload) {
  const value = payload?.state?.clearedAt;
  return typeof value === "string" && timestampMs(value) ? value : "";
}

// A device may only replace a remote tombstone after it has observed that exact
// (or a newer) revision and then made a real edit, which removes its local
// marker. Cross-device wall clocks are not reliable enough for this decision.
function shouldRetainLocalAfterRemoteClear(localPayload, remotePayload) {
  if (!hasStoredAppData(localPayload) || clearMarkerOf(localPayload) || !hasValidClearRevision(remotePayload)) return false;
  const dirtyBaseRevision = localPayload?.dirtyBaseRevision;
  return (
    typeof dirtyBaseRevision === "number" && Number.isInteger(dirtyBaseRevision) && dirtyBaseRevision >= payloadRevisionOf(remotePayload)
  );
}

function adoptRemoteClear(rawData) {
  const clearedAt = clearMarkerOf(rawData);
  const updatedAt = typeof rawData?.updatedAt === "string" && timestampMs(rawData.updatedAt) ? rawData.updatedAt : clearedAt;
  if (!clearedAt || !updatedAt) return null;
  const revision = payloadRevisionOf(rawData);

  // Remove the stale health payload first, then retain only the marker and CAS
  // metadata. If marker persistence fails, the in-memory state still stays
  // blank and the next server load will attempt the wipe again.
  safeStorageRemove(userStorageKey());
  resetAppData({ blank: true, revision, localUpdatedAt: updatedAt });
  runtime.syncBasePayload = syncBaseSnapshot(rawData);
  state.clearedAt = clearedAt;
  state.authRequired = false;
  state.lastSyncedAt = updatedAt;
  writeStoredPayload({
    state: { schemaVersion: CURRENT_SCHEMA_VERSION, clearedAt },
    meals: null,
    localUpdatedAt: updatedAt,
    revision,
    dirtyBaseRevision: null,
  });
  return { revision, updatedAt, clearedAt };
}

function loadStoredState(rawStored) {
  const stored = rawStored === undefined ? readStoredPayload() : rawStored;
  if (!stored) return null;
  runtime.stateRevision = payloadRevisionOf(stored);
  runtime.localUpdatedAt = stored.localUpdatedAt || "";
  runtime.dirtyBaseRevision = stored.dirtyBaseRevision;
  runtime.syncBasePayload = stored.syncBase || (stored.dirtyBaseRevision === null ? syncBaseSnapshot(stored) : null);
  applyPersistedData(stored);
  writeStoredPayload(storedPayload());
  return stored;
}

function isTrustedOfflineSession() {
  return (
    runtime.authSessionStatus === "offline-unverified" &&
    runtime.offlineSessionActive === true &&
    !runtime.accessToken &&
    isOfflineAccessTrusted()
  );
}

function loadTrustedOfflineState() {
  runtime.offlineSessionActive = false;
  if (runtime.authSessionStatus !== "offline-unverified" || runtime.accessToken || !isOfflineAccessTrusted()) return null;
  const stored = readOfflineStoredPayload();
  if (!stored) return null;
  const loaded = loadStoredState(stored);
  if (!loaded) return null;
  runtime.offlineSessionActive = true;
  runtime.offlineSyncReadRequired = true;
  state.syncPending = Number.isInteger(stored.dirtyBaseRevision) && stored.dirtyBaseRevision >= 0;
  state.authRequired = false;
  state.backendStatus = "offline";
  state.syncErrorKind = runtime.offlineSessionReason === "network" ? "network" : "server";
  state.syncError =
    runtime.offlineSessionReason === "network"
      ? "当前离线，正在显示这台设备上的缓存；联网并验证账号后再同步"
      : "认证服务暂不可用，正在显示这台设备上的缓存；恢复后验证账号再同步";
  return loaded;
}

async function loadServerState(options = {}) {
  const generation = runtime.authSessionGeneration;
  const loaded = await loadServerStateRound(options);
  if (loaded && generation === runtime.authSessionGeneration) runtime.offlineSyncReadRequired = false;
  return loaded;
}

async function loadServerStateRound({ retried = false } = {}) {
  const userId = runtime.authUserId;
  const generation = runtime.authSessionGeneration;
  const sessionChanged = () => userId !== runtime.authUserId || generation !== runtime.authSessionGeneration;
  try {
    if (!runtime.accessToken) {
      state.authRequired = !isTrustedOfflineSession();
      return false;
    }
    const response = await fetch(API_STATE_URL, { cache: "no-store", headers: authHeaders() });
    if (sessionChanged()) return false;
    if (response.status === 401) {
      if (!retried) {
        const refresh = await refreshSession({ detailed: true });
        if (refresh.status === "authenticated") return loadServerState({ retried: true });
        if (refresh.status === "offline-unverified") {
          state.syncErrorKind = refresh.reason === "network" ? "network" : "server";
          state.syncError = refresh.reason === "network" ? "当前离线，联网后可重试" : "认证服务暂不可用，恢复后可重试";
          setBackendStatus("offline");
          return false;
        }
      }
      state.authRequired = true;
      clearSession();
      return false;
    }
    if (!response.ok) {
      state.syncErrorKind = "server";
      state.syncError = "暂时无法读取云端记录";
      setBackendStatus("offline");
      return false;
    }
    const rawData = await response.json();
    if (sessionChanged()) return false;
    // Edits can arrive while the GET is in flight. Persist their draft before
    // taking the local merge input; the reconnect gate prevents an early PUT.
    flushPendingInputSave();
    const data = migratePayload(rawData) || rawData;
    runtime.stateRevision = payloadRevisionOf(rawData);
    const localPayload = readStoredPayload();
    state.authRequired = false;
    if (state.syncErrorKind !== "storage") {
      state.syncErrorKind = "none";
      state.syncError = "";
    }
    setBackendStatus(runtime.authProvider === "local" ? "device" : "online");
    if (clearMarkerOf(rawData)) {
      if (!shouldRetainLocalAfterRemoteClear(localPayload, rawData)) {
        adoptRemoteClear(rawData);
        return true;
      }
      // This payload is based on the tombstone revision and its marker was
      // removed by a real edit, so it is safe to replace the remote clear.
      runtime.localUpdatedAt = localPayload.localUpdatedAt || "";
      applyPersistedData(localPayload);
      state.syncPending = true;
      setBackendStatus("local");
      scheduleSyncRetry({ silent: true, delay: 0 });
      return true;
    }
    const serverHasData = Boolean(rawData.state || rawData.meals);
    const remoteBase = syncBaseSnapshot(rawData);
    if (!serverHasData) {
      if (hasStoredAppData(localPayload)) {
        runtime.syncBasePayload = remoteBase;
        runtime.dirtyBaseRevision = payloadRevisionOf(rawData);
        runtime.localUpdatedAt = localPayload.localUpdatedAt || "";
        applyPersistedData(localPayload);
        writeStoredPayload(storedPayload());
        state.syncPending = true;
        setBackendStatus("local");
        scheduleSyncRetry({ silent: true, delay: 0 });
        return true;
      }
      resetAppData({ blank: true, revision: payloadRevisionOf(rawData), localUpdatedAt: rawData.updatedAt || "" });
      runtime.syncBasePayload = remoteBase;
      state.authRequired = false;
      return true;
    }
    if (hasStoredAppData(localPayload)) {
      const localIsDirty = Number.isInteger(localPayload.dirtyBaseRevision) && localPayload.dirtyBaseRevision >= 0;
      if (!localIsDirty) {
        runtime.localUpdatedAt = rawData.updatedAt || "";
        runtime.dirtyBaseRevision = data.migrated ? payloadRevisionOf(rawData) : null;
        runtime.syncBasePayload = remoteBase;
        applyPersistedData(data);
        writeStoredPayload(storedPayload());
        if (data.migrated) {
          state.syncPending = true;
          setBackendStatus("local");
          scheduleSyncRetry({ silent: true, delay: 0 });
        }
        return true;
      }
      const mergeInput =
        !localPayload.syncBase && localPayload.dirtyBaseRevision === payloadRevisionOf(rawData)
          ? { ...localPayload, syncBase: remoteBase }
          : localPayload;
      const mergedResult = mergePayloads(mergeInput, data, rawData);
      if (!mergedResult.safeMerge) {
        runtime.stateRevision = payloadRevisionOf(localPayload);
        state.syncPending = true;
        state.syncErrorKind = "server";
        state.syncError = "本机修改缺少可验证的同步基线，已停止自动覆盖云端记录";
        setBackendStatus("local");
        return false;
      }
      runtime.syncBasePayload = remoteBase;
      runtime.dirtyBaseRevision = mergedResult.localContributed || data.migrated ? payloadRevisionOf(rawData) : null;
      runtime.localUpdatedAt = mergedResult.payload.localUpdatedAt || "";
      applyPersistedData(mergedResult.payload);
      writeStoredPayload(storedPayload());
      if (mergedResult.localContributed || data.migrated) {
        state.syncPending = true;
        setBackendStatus("local");
        scheduleSyncRetry({ silent: true, delay: 0 });
      }
      return true;
    }
    runtime.localUpdatedAt = rawData.updatedAt || "";
    runtime.dirtyBaseRevision = data.migrated ? payloadRevisionOf(rawData) : null;
    runtime.syncBasePayload = remoteBase;
    applyPersistedData(data);
    writeStoredPayload(storedPayload());
    if (data.migrated) {
      state.syncPending = true;
      scheduleSyncRetry({ silent: true, delay: 0 });
    }
    return true;
  } catch {
    if (sessionChanged()) return false;
    state.syncErrorKind = navigator.onLine === false ? "network" : "server";
    state.syncError = navigator.onLine === false ? "当前离线，联网后可重试" : "暂时无法连接云端";
    setBackendStatus("offline");
    return false;
  }
}

function authHeaders(extra = {}) {
  return runtime.accessToken ? { ...extra, Authorization: `Bearer ${runtime.accessToken}` } : extra;
}

function finishRefreshSession(outcome, detailed) {
  runtime.authSessionStatus = outcome.status;
  runtime.offlineSessionActive = false;
  runtime.offlineSessionReason = outcome.status === "offline-unverified" ? outcome.reason : "";
  if (outcome.status !== "authenticated") runtime.accessToken = "";
  if (outcome.status === "offline-unverified") runtime.offlineSyncReadRequired = true;
  return detailed ? outcome : outcome.status === "authenticated";
}

async function refreshSession({ detailed = false } = {}) {
  const expectedUserId = runtime.authUserId;
  const expectedProvider = runtime.authProvider;
  const generation = runtime.authSessionGeneration;
  const superseded = () =>
    generation !== runtime.authSessionGeneration || expectedUserId !== runtime.authUserId || expectedProvider !== runtime.authProvider;
  const staleOutcome = () => (detailed ? { status: "anonymous", httpStatus: null, retryable: false, reason: "stale-session" } : false);
  let response;
  try {
    response = await fetch(API_AUTH_REFRESH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({}),
    });
  } catch {
    if (superseded()) return staleOutcome();
    return finishRefreshSession({ status: "offline-unverified", httpStatus: null, retryable: true, reason: "network" }, detailed);
  }
  if (superseded()) return staleOutcome();
  if (response.status >= 500 || response.status === 408 || response.status === 429) {
    return finishRefreshSession({ status: "offline-unverified", httpStatus: response.status, retryable: true, reason: "server" }, detailed);
  }
  if (response.status === 204 || response.status === 401 || response.status === 403) {
    const httpStatus = response.status;
    clearSession();
    return finishRefreshSession({ status: "anonymous", httpStatus, retryable: false, reason: "no-session" }, detailed);
  }
  const data = await response.json().catch(() => null);
  if (superseded()) return staleOutcome();
  if (!response.ok || !data?.accessToken || !data?.user?.id) {
    const httpStatus = response.status;
    clearSession();
    return finishRefreshSession({ status: "anonymous", httpStatus, retryable: false, reason: "invalid-response" }, detailed);
  }
  const provider = data.provider === "local" ? "local" : "supabase";
  if (expectedUserId && (data.user.id !== expectedUserId || provider !== expectedProvider)) {
    clearSession();
    return finishRefreshSession(
      { status: "anonymous", httpStatus: response.status, retryable: false, reason: "account-changed" },
      detailed,
    );
  }
  storeSession(data);
  return finishRefreshSession({ status: "authenticated", httpStatus: response.status, retryable: false, reason: "verified" }, detailed);
}

function setBackendStatus(status) {
  state.backendStatus = status;
  const busy = status === "connecting" || status === "saving";
  const retryable = status === "local" || status === "offline";
  const statusText = backendStatusText();

  document.querySelectorAll("[data-backend-status]").forEach((container) => {
    container.dataset.status = status;
    container.dataset.errorKind = state.syncErrorKind || "none";
    container.setAttribute("aria-busy", String(busy));
    const text = container.querySelector("[data-backend-status-text]");
    if (text) text.textContent = statusText;
  });

  document.querySelectorAll("[data-sync-retry]").forEach((button) => {
    button.hidden = !retryable;
    button.disabled = !retryable || busy;
    button.setAttribute("aria-busy", String(busy));
    button.setAttribute("aria-label", state.syncErrorKind === "storage" ? "重试保存" : "重试同步");
  });

  document.querySelectorAll("[data-sync-now]:not([data-sync-retry])").forEach((button) => {
    button.disabled = busy;
    button.setAttribute("aria-busy", String(busy));
    button.classList.toggle("is-sync-busy", busy);
    const label = button.querySelector("[data-sync-manual-label]");
    if (label) label.textContent = busy ? "同步中…" : runtime.authProvider === "local" ? "立即保存" : "重试同步";
  });
}

// A 409 STATE_CONFLICT means another device wrote newer records since our
// last load. Merge our local payload into the server's current payload
// (per-day last-write-wins, same rules as load-time merging), adopt the
// server revision, and let the caller retry once with the merged result.
function captureSyncSessionGuard() {
  const userId = runtime.authUserId;
  const generation = runtime.authSessionGeneration;
  return () => {
    if (userId === runtime.authUserId && generation === runtime.authSessionGeneration) return;
    const error = new Error("账号已切换，已忽略原账号的同步响应");
    error.kind = "stale-session";
    throw error;
  };
}

async function mergeWithServerConflict(response, checkSession) {
  const conflict = (await response.json().catch(() => null))?.conflict;
  checkSession();
  if (!conflict || !isPlainRecord(conflict)) return null;
  if (clearMarkerOf(conflict)) {
    if (shouldRetainLocalAfterRemoteClear(persistedPayload(), conflict)) {
      runtime.stateRevision = payloadRevisionOf(conflict);
      return { retry: true };
    }
    const acknowledgement = adoptRemoteClear(conflict);
    return acknowledgement ? { retry: false, acknowledgement } : null;
  }
  const migratedServer = migratePayload(conflict) || conflict;
  const currentLocal = storedPayload();
  const remoteRevision = payloadRevisionOf(conflict);
  const mergeInput =
    !currentLocal.syncBase && currentLocal.dirtyBaseRevision === remoteRevision
      ? { ...currentLocal, syncBase: syncBaseSnapshot(conflict) }
      : currentLocal;
  const merged = mergePayloads(mergeInput, migratedServer, conflict);
  if (!merged.safeMerge) return null;
  runtime.stateRevision = remoteRevision;
  runtime.syncBasePayload = syncBaseSnapshot(conflict);
  runtime.dirtyBaseRevision = remoteRevision;
  runtime.localUpdatedAt = merged.payload.localUpdatedAt || runtime.localUpdatedAt;
  applyPersistedData(merged.payload);
  const localWrite = writeStoredPayload(storedPayload());
  if (!localWrite.ok && !localWrite.skipped) {
    const error = new Error("冲突已合并，但无法安全保存新的同步基线");
    error.kind = "storage";
    throw error;
  }
  return { retry: true, merged };
}

function stateWriteAcknowledgement(data) {
  if (!isPlainRecord(data)) return null;
  if (typeof data.revision !== "number" || !Number.isInteger(data.revision) || data.revision < 0) return null;
  if (typeof data.updatedAt !== "string" || !timestampMs(data.updatedAt)) return null;
  return { revision: data.revision, updatedAt: data.updatedAt };
}

async function putStatePayload(payload, checkSession) {
  let response = await fetch(API_STATE_URL, {
    method: "PUT",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
  });
  checkSession();
  if (response.status === 401) {
    const refreshed = await refreshSession();
    checkSession();
    if (refreshed) {
      response = await fetch(API_STATE_URL, {
        method: "PUT",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
      });
      checkSession();
    }
  }
  return response;
}

async function writeStateRound(checkSession) {
  let sentMutationRevision = runtime.localMutationRevision;
  let payload = persistedPayload();
  let response = await putStatePayload(payload, checkSession);
  const conflictResolution = response.status === 409 ? await mergeWithServerConflict(response, checkSession) : null;
  checkSession();
  if (conflictResolution && !conflictResolution.retry) {
    return {
      acknowledgement: conflictResolution.acknowledgement,
      sentMutationRevision: runtime.localMutationRevision,
      remoteClearAdopted: true,
    };
  }
  if (conflictResolution?.retry) {
    sentMutationRevision = runtime.localMutationRevision;
    payload = persistedPayload();
    response = await putStatePayload(payload, checkSession);
  }
  if (!response.ok) {
    const error = new Error(response.status === 409 ? "云端记录再次发生冲突，请稍后重试" : "同步失败");
    error.kind = response.status === 401 ? "auth" : "server";
    throw error;
  }
  const responseData = await response.json().catch(() => null);
  checkSession();
  const acknowledgement = stateWriteAcknowledgement(responseData);
  if (!acknowledgement) {
    const error = new Error("服务器返回的同步确认无效");
    error.kind = "server";
    throw error;
  }
  const acknowledgedPayload = syncBaseSnapshot({
    state: isPlainRecord(responseData?.state) ? responseData.state : payload.state,
    meals: Array.isArray(responseData?.meals) ? responseData.meals : payload.meals,
    localUpdatedAt: acknowledgement.updatedAt,
    updatedAt: acknowledgement.updatedAt,
    revision: acknowledgement.revision,
  });
  return { acknowledgement, acknowledgedPayload, sentPayload: payload, sentMutationRevision };
}

function rebasePendingLocalChanges(round) {
  const acknowledgement = round.acknowledgement;
  const acknowledgedPayload = round.acknowledgedPayload;
  const sentBase = syncBaseSnapshot({
    ...round.sentPayload,
    revision: acknowledgement.revision,
    updatedAt: acknowledgement.updatedAt,
    localUpdatedAt: acknowledgement.updatedAt,
  });
  if (!sentBase || !acknowledgedPayload) return false;
  const latestLocal = {
    ...persistedPayload(),
    dirtyBaseRevision: acknowledgement.revision,
    syncBase: sentBase,
  };
  const migratedAcknowledgement = migratePayload(acknowledgedPayload);
  const rebased = migratedAcknowledgement ? mergePayloads(latestLocal, migratedAcknowledgement, acknowledgedPayload) : null;
  if (!rebased?.safeMerge) return false;
  runtime.syncBasePayload = acknowledgedPayload;
  runtime.dirtyBaseRevision = acknowledgement.revision;
  runtime.localUpdatedAt = rebased.payload.localUpdatedAt || runtime.localUpdatedAt;
  applyPersistedData(rebased.payload);
  return true;
}

async function syncStateNow({ silent = true } = {}) {
  if (runtime.syncPromise) return runtime.syncPromise;
  const checkSession = captureSyncSessionGuard();
  if (clearMarkerOf(persistedPayload())) {
    state.syncPending = false;
    setBackendStatus(runtime.authProvider === "local" ? "device" : "online");
    return true;
  }
  runtime.syncPromise = (async () => {
    const initialLocalWrite = writeStoredPayload(storedPayload());
    const locallySaved = initialLocalWrite.ok;
    state.syncPending = true;

    if (!runtime.accessToken || runtime.offlineSyncReadRequired) {
      if (!locallySaved && !initialLocalWrite.skipped) setBackendStatus("offline");
      return locallySaved;
    }
    setBackendStatus("saving");
    try {
      let acknowledgement;
      let remoteClearAdopted = false;
      while (true) {
        const round = await writeStateRound(checkSession);
        checkSession();
        acknowledgement = round.acknowledgement;
        remoteClearAdopted ||= Boolean(round.remoteClearAdopted);
        runtime.stateRevision = acknowledgement.revision;
        if (runtime.localMutationRevision === round.sentMutationRevision) {
          if (round.acknowledgedPayload) {
            runtime.syncBasePayload = round.acknowledgedPayload;
            applyPersistedData(round.acknowledgedPayload);
          }
          break;
        }
        if (!rebasePendingLocalChanges(round)) {
          const error = new Error("无法把同步期间的新修改安全合并到服务器确认结果");
          error.kind = "server";
          throw error;
        }
        state.syncPending = true;
        writeStoredPayload(storedPayload());
      }
      runtime.localUpdatedAt = acknowledgement.updatedAt;
      state.lastSyncedAt = acknowledgement.updatedAt;
      state.syncPending = false;
      runtime.dirtyBaseRevision = null;
      const finalLocalWrite = writeStoredPayload(storedPayload());
      if (finalLocalWrite.ok) {
        state.syncError = "";
        state.syncErrorKind = "none";
      } else {
        state.syncErrorKind = "storage";
        state.syncError = "云端已同步，但本机缓存写入失败";
      }
      setBackendStatus(runtime.authProvider === "local" ? "device" : "online");
      if (remoteClearAdopted) {
        syncFeedbackHandler("另一设备已清空记录，本机未同步的旧修改没有被恢复");
      } else if (!silent) {
        const successMessage = runtime.authProvider === "local" ? "本机账号已保存" : "云端已同步";
        syncFeedbackHandler(finalLocalWrite.ok ? successMessage : `${successMessage}，本机缓存暂不可用`);
      }
      return true;
    } catch (error) {
      if (error.kind === "stale-session") {
        if (!runtime.authUserId) {
          state.authRequired = true;
          syncFeedbackHandler("请重新登录后继续同步");
        }
        return false;
      }
      if (locallySaved) {
        state.syncErrorKind = error.kind || (navigator.onLine === false ? "network" : "server");
        state.syncError = navigator.onLine === false ? "当前离线，联网后可重试" : error.message || "同步失败";
      } else {
        state.syncErrorKind = "storage";
        state.syncError = "本机缓存写入失败，云端同步也未完成";
      }
      state.syncPending = true;
      setBackendStatus(locallySaved ? "local" : "offline");
      scheduleSyncRetry();
      if (!silent) {
        syncFeedbackHandler(locallySaved ? "已存本机，联网后会继续同步" : "保存失败，请检查网络与浏览器存储");
      }
      return false;
    }
  })();
  try {
    return await runtime.syncPromise;
  } finally {
    runtime.syncPromise = null;
  }
}

function scheduleSyncRetry({ silent = true, delay = 2500 } = {}) {
  clearTimeout(runtime.retryTimer);
  if (!runtime.accessToken || runtime.offlineSyncReadRequired) return;
  runtime.retryTimer = setTimeout(() => {
    if (!state.syncPending && state.backendStatus !== "local") return;
    syncStateNow({ silent });
  }, delay);
}

function saveStoredState() {
  clearTimeout(runtime.inputSaveTimer);
  runtime.inputSaveTimer = undefined;
  const payload = prepareLocalMutation();
  if (!runtime.lastMutationChanged) return true;
  const localWrite = writeStoredPayload(payload);
  state.syncPending = true;
  clearTimeout(runtime.saveTimer);
  if (!localWrite.ok && !localWrite.skipped) setBackendStatus("offline");
  if (!runtime.accessToken || runtime.offlineSyncReadRequired) return localWrite.ok;
  if (!runtime.syncPromise) runtime.saveTimer = setTimeout(() => syncStateNow(), 250);
  return localWrite.ok;
}

// Trailing-edge debounce for keystroke-driven saves: serializing the whole
// payload on every keystroke gets expensive as daily records accumulate.
function saveStoredStateThrottled(delay = 400) {
  clearTimeout(runtime.inputSaveTimer);
  runtime.inputSaveTimer = setTimeout(() => {
    runtime.inputSaveTimer = undefined;
    saveStoredState();
  }, delay);
}

function flushPendingInputSave() {
  if (!runtime.inputSaveTimer) return;
  clearTimeout(runtime.inputSaveTimer);
  runtime.inputSaveTimer = undefined;
  saveStoredState();
}

export {
  setSyncFeedbackHandler,
  loadStoredState,
  loadTrustedOfflineState,
  isTrustedOfflineSession,
  loadServerState,
  authHeaders,
  refreshSession,
  setBackendStatus,
  stateWriteAcknowledgement,
  clearMarkerOf,
  shouldRetainLocalAfterRemoteClear,
  adoptRemoteClear,
  syncStateNow,
  scheduleSyncRetry,
  saveStoredState,
  saveStoredStateThrottled,
  flushPendingInputSave,
};
export {
  METRIC_LOG_LIMIT,
  DAILY_RECORD_LIMIT,
  createBlankMeals,
  createNewUserState,
  normalizeMealList,
  normalizeMetricLogs,
  pruneDailyRecords,
  createBlankDailyRecord,
  upsertMetricLog,
  currentDailyRecord,
  updateTodayRecord,
  hydrateTodayFromRecords,
  persistedStateFrom,
  migratePayload,
  mergePayloads,
  syncBaseSnapshot,
  persistedPayload,
  storedPayload,
  capturePersistedDataFingerprint,
  prepareLocalMutation,
  resetAppData,
} from "./app-data.js";
export {
  userStorageKey,
  readStorageValue,
  removeStorageValue,
  storeSession,
  clearSession,
  clearLegacyAuthStorage,
  isOfflineAccessTrusted,
  setOfflineAccessTrusted,
  clearOfflineAccessTrust,
} from "./app-storage.js";
