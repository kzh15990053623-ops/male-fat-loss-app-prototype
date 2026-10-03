import { state, runtime } from "./app-state.js";
import { nativeRuntime, nativeCloudEnabled, apiFetch, validateCloudOrigin } from "./native-runtime.js";
import { storedPayload, syncBaseSnapshot } from "./app-data.js";
import { loadStoredState, loadServerState, syncStateNow, flushPendingInputSave, saveStoredState } from "./app-sync.js";
import { render, showToast } from "./actions/services.js";

export async function initializeNativeCloud() {
  const native = nativeRuntime();
  let saved;
  let message = "";
  try {
    saved = await native.store.readCloudConfig?.();
    if (saved) {
      saved.origin = validateCloudOrigin(saved.origin);
      if (typeof saved.ownerId !== "string" || typeof saved.email !== "string" || (saved.enabled && !saved.ownerId))
        throw new Error("Invalid cloud profile");
    }
  } catch {
    saved = null;
    message = "云连接配置无法读取，已暂停同步。手机记录仍可使用，请重新连接。";
  }
  native.cloud = {
    config: saved || { origin: native.apiOrigin || "", enabled: false, ownerId: "", email: "" },
    authenticated: false,
    busy: false,
    open: false,
    message,
    resume: resumeNativeCloud,
    refresh: refreshNativeSession,
  };
  if (nativeCloudEnabled()) {
    runtime.authUserId = saved.ownerId;
    runtime.authProvider = "supabase";
    runtime.authSessionStatus = "offline-unverified";
    runtime.offlineSyncReadRequired = true;
    state.authProvider = "supabase";
    state.syncPending = Number.isInteger(runtime.dirtyBaseRevision);
    state.backendStatus = "local";
  }
}

export function expireNativeSession() {
  runtime.accessToken = "";
  runtime.authSessionStatus = "offline-unverified";
  runtime.offlineSyncReadRequired = true;
  state.authRequired = false;
  const cloud = nativeRuntime()?.cloud;
  if (cloud) {
    cloud.authenticated = false;
    cloud.aiReady = false;
    cloud.aiMessage = "重新登录云账号后可恢复 AI 识别。";
    cloud.message = "云账号需要重新登录，手机记录仍可使用。";
  }
}

function acceptSession(data) {
  if (!data?.accessToken || !data?.user?.id || data.provider === "local") throw new Error("云服务没有返回有效的云账号凭证");
  const cloud = nativeRuntime().cloud;
  if (cloud.config.ownerId && cloud.config.ownerId !== data.user.id)
    throw new Error("此手机档案已绑定另一账号，请先导出并清空手机档案再切换账号");
  runtime.authUserId = data.user.id;
  runtime.authProvider = "supabase";
  runtime.accessToken = data.accessToken;
  runtime.authSessionStatus = "authenticated";
  state.authProvider = "supabase";
  state.authRequired = false;
  cloud.authenticated = true;
}

async function checkNativeAi() {
  const cloud = nativeRuntime().cloud;
  const generation = runtime.authSessionGeneration;
  try {
    const response = await apiFetch("/api/ai/budget", { headers: { Authorization: `Bearer ${runtime.accessToken}` } });
    const data = await response.json();
    if (generation !== runtime.authSessionGeneration) return;
    cloud.aiReady = response.ok;
    cloud.aiMessage = response.ok ? "AI 识别已连接，每月预算上限 100 元。" : data.error || "AI 服务暂不可用，饮食仍可手动记录。";
    if (response.ok) runtime.nutritionBudget = data;
  } catch {
    if (generation !== runtime.authSessionGeneration) return;
    cloud.aiReady = false;
    cloud.aiMessage = "暂时无法连接 AI 服务，联网后可重试。";
  }
}

export async function refreshNativeSession({ detailed = false } = {}) {
  const cloud = nativeRuntime()?.cloud;
  if (!cloud?.config.enabled) return detailed ? { status: "anonymous", reason: "disabled" } : false;
  if (!cloud.refreshPromise) {
    const generation = runtime.authSessionGeneration;
    cloud.refreshPromise = (async () => {
      try {
        const response = await apiFetch("/api/auth/refresh", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        if (generation !== runtime.authSessionGeneration) return { status: "anonymous", reason: "stale-session" };
        if (!response.ok || response.status === 204) {
          expireNativeSession();
          return { status: "offline-unverified", reason: response.status >= 500 ? "server" : "no-session" };
        }
        const data = await response.json();
        if (generation !== runtime.authSessionGeneration) return { status: "anonymous", reason: "stale-session" };
        acceptSession(data);
        return { status: "authenticated", reason: "verified" };
      } catch {
        if (generation === runtime.authSessionGeneration) expireNativeSession();
        return { status: "offline-unverified", reason: "network" };
      }
    })().finally(() => {
      cloud.refreshPromise = null;
    });
  }
  const result = await cloud.refreshPromise;
  return detailed ? result : result.status === "authenticated";
}

export async function resumeNativeCloud({ silent = true } = {}) {
  const cloud = nativeRuntime()?.cloud;
  if (!nativeCloudEnabled() || cloud.busy) return false;
  if (cloud.resumePromise) return cloud.resumePromise;
  const generation = runtime.authSessionGeneration;
  cloud.resumePromise = (async () => {
    try {
      if (runtime.syncPromise) await runtime.syncPromise;
      if (generation !== runtime.authSessionGeneration) return false;
      if (!runtime.accessToken && !(await refreshNativeSession())) throw new Error(cloud.message || "联网并登录后可恢复同步");
      if (generation !== runtime.authSessionGeneration) return false;
      runtime.offlineSyncReadRequired = true;
      const loaded = await loadServerState();
      if (generation !== runtime.authSessionGeneration) return false;
      if (!loaded) throw new Error(state.syncError || "暂时无法读取云端，手机修改已保留");
      await nativeRuntime().store.flushDeviceStore();
      if (generation !== runtime.authSessionGeneration) return false;
      const success = state.syncPending ? await syncStateNow({ silent }) : true;
      cloud.message = success ? "云端已同步；离线时会继续保存到手机。" : state.syncError;
      if (success) cloud.retryDelay = 5000;
      if (success && cloud.aiReady !== true) await checkNativeAi();
      return success;
    } catch (error) {
      if (generation !== runtime.authSessionGeneration) return false;
      cloud.message = error.message;
      state.backendStatus = "local";
      if (!silent) showToast(error.message);
      return false;
    } finally {
      if (generation === runtime.authSessionGeneration && (state.activeTab === "profile" || !state.setupCompleted)) render();
    }
  })().finally(() => {
    cloud.resumePromise = null;
  });
  return cloud.resumePromise;
}

export async function connectNativeCloud(form) {
  const native = nativeRuntime();
  const cloud = native?.cloud;
  if (!cloud || cloud.busy) return false;
  const fields = new FormData(form);
  const email = String(fields.get("cloudEmail") || "").trim();
  const password = String(fields.get("cloudPassword") || "");
  const mode = fields.get("cloudMode") === "signup" ? "signup" : "login";
  const choice = fields.get("cloudInitialData");
  const previousConfig = { ...cloud.config };
  let bound = false;
  cloud.busy = true;
  cloud.message = "正在连接云服务…";
  try {
    runtime.authSessionGeneration += 1;
    clearTimeout(runtime.saveTimer);
    clearTimeout(runtime.retryTimer);
    await Promise.allSettled([cloud.resumePromise, cloud.refreshPromise, runtime.syncPromise]);
    const origin = validateCloudOrigin(fields.get("cloudOrigin"));
    if (cloud.config.ownerId && origin !== cloud.config.origin) throw new Error("此档案已绑定现有云服务，请先导出并清空手机档案再切换服务");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 6) throw new Error("请填写有效邮箱和至少 6 位密码");
    cloud.config = { ...cloud.config, origin };
    render();
    const readiness = await apiFetch("/api/readiness?force=1");
    const health = await readiness.json().catch(() => ({}));
    if (!readiness.ok || !health.auth?.ready) throw new Error(health.auth?.message || "云端认证服务未就绪，手机记录仍可使用");
    if (mode === "signup" && health.auth.signupAllowed === false) throw new Error("此云服务暂未开放注册，请使用已有账号登录");
    const response = await apiFetch(`/api/auth/${mode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, provider: "supabase" }),
    });
    const session = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(session.error || "登录失败");
    if (session.needsEmailConfirmation && !session.accessToken) throw new Error("注册成功，请先完成邮件确认，再回来登录");
    acceptSession(session);
    const remoteResponse = await apiFetch("/api/state", { headers: { Authorization: `Bearer ${runtime.accessToken}` } });
    const remote = await remoteResponse.json().catch(() => null);
    if (!remoteResponse.ok || !Number.isInteger(remote?.revision) || remote.revision < 0) throw new Error("无法读取云端档案，尚未开启同步");
    flushPendingInputSave();
    await native.store.flushDeviceStore();
    const local = native.store.latestDevicePayload();
    if (!previousConfig.ownerId) {
      const remoteHasData = Boolean(remote.state || remote.meals);
      if (remoteHasData && state.setupCompleted && !["phone", "cloud"].includes(choice))
        throw new Error("手机和云端都已有档案。请选择首次同步保留手机档案或云端档案，再连接；覆盖前会保存双方副本。");
      const mutationBeforeImport = runtime.localMutationRevision;
      await native.store.saveCloudRecovery({ savedAt: new Date().toISOString(), phone: local, cloud: remote });
      if (mutationBeforeImport !== runtime.localMutationRevision) throw new Error("连接期间手机记录发生变化，请重新连接以保留最新修改");
      if (remoteHasData && (!state.setupCompleted || choice === "cloud")) {
        await native.store.saveDevicePayload({ ...remote, localUpdatedAt: remote.updatedAt || "", dirtyBaseRevision: null });
        if (mutationBeforeImport !== runtime.localMutationRevision) {
          await native.store.saveDevicePayload(storedPayload());
          throw new Error("连接期间手机记录发生变化，已保留最新修改，请重试");
        }
        loadStoredState(native.store.latestDevicePayload());
        state.syncPending = false;
      } else {
        runtime.stateRevision = remote.revision;
        runtime.syncBasePayload = syncBaseSnapshot(remote);
        runtime.dirtyBaseRevision = remote.revision;
        await native.store.saveDevicePayload(storedPayload());
        state.syncPending = true;
      }
    }
    cloud.config = { origin, ownerId: session.user.id, email, enabled: true };
    await native.store.writeCloudConfig(cloud.config);
    bound = true;
    runtime.offlineSyncReadRequired = Boolean(previousConfig.ownerId);
    state.preferences.aiAssist = true;
    saveStoredState();
    cloud.busy = false;
    const success = previousConfig.ownerId ? await resumeNativeCloud() : await syncStateNow();
    cloud.message = success ? "账号已连接，云端已同步。" : "账号已连接，手机记录已保存；云同步稍后重试。";
    await checkNativeAi();
    cloud.open = false;
    return true;
  } catch (error) {
    cloud.message = error.message || "连接失败，请稍后重试";
    if (!bound) {
      cloud.config = previousConfig;
      cloud.authenticated = false;
      runtime.accessToken = "";
      runtime.authUserId = previousConfig.ownerId || "device";
      runtime.authProvider = previousConfig.enabled ? "supabase" : "local";
      state.authProvider = runtime.authProvider;
      state.authRequired = false;
      state.backendStatus = previousConfig.enabled ? "local" : "device";
    }
    return false;
  } finally {
    cloud.busy = false;
    render();
  }
}

export async function disconnectNativeCloud({ forget = false } = {}) {
  const native = nativeRuntime();
  const cloud = native?.cloud;
  if (!cloud || cloud.busy) return false;
  const config = forget ? { origin: cloud.config.origin, enabled: false, ownerId: "", email: "" } : { ...cloud.config, enabled: false };
  await native.store.writeCloudConfig?.(config);
  cloud.config = config;
  runtime.authSessionGeneration += 1;
  runtime.aiNutritionController?.abort();
  runtime.accessToken = "";
  runtime.authUserId = "device";
  runtime.authProvider = "local";
  runtime.authSessionStatus = "anonymous";
  runtime.offlineSyncReadRequired = false;
  state.authProvider = "local";
  state.authRequired = false;
  cloud.authenticated = false;
  cloud.aiReady = false;
  cloud.aiMessage = "";
  runtime.nutritionBudget = null;
  clearTimeout(runtime.saveTimer);
  clearTimeout(runtime.retryTimer);
  await Promise.allSettled([cloud.resumePromise, cloud.refreshPromise, runtime.syncPromise]);
  await native.store.flushDeviceStore();
  await native.Cookies?.clearAllCookies();
  cloud.message = "云同步已暂停，记录继续保存在手机。";
  state.backendStatus = "device";
  state.syncPending = false;
  render();
  return true;
}

export async function exportCloudRecovery() {
  const native = nativeRuntime();
  try {
    const recovery = await native.store.readCloudRecovery();
    if (!recovery) return showToast("暂无首次同步前的副本");
    const files = [];
    for (const key of ["phone", "cloud"]) {
      if (!recovery[key]?.state) continue;
      const path = `backups/before-cloud-${key}.json`;
      await native.Filesystem.writeFile({
        path,
        data: JSON.stringify({ exportedAt: recovery.savedAt, data: recovery[key] }),
        directory: native.Directory.Cache,
        encoding: native.Encoding.UTF8,
        recursive: true,
      });
      files.push((await native.Filesystem.getUri({ path, directory: native.Directory.Cache })).uri);
    }
    if (!files.length) return showToast("副本中没有健康记录");
    await native.Share.share({ title: "首次同步前的档案副本", files });
  } catch (error) {
    showToast(error.message || "副本导出失败");
  }
}
