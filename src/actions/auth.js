import {
  state,
  runtime,
  API_AUTH_LOGIN_URL,
  API_AUTH_SIGNUP_URL,
  API_AUTH_LOGOUT_URL,
  API_AUTH_ACCOUNT_URL,
  API_AUTH_READINESS_URL,
} from "../app-state.js";
import {
  storeSession,
  clearSession,
  authHeaders,
  refreshSession,
  resetAppData,
  loadStoredState,
  loadServerState,
  setBackendStatus,
  removeStorageValue,
  userStorageKey,
} from "../app-sync.js";
import { render, showToast, activateTab, tabFromLocation, runExclusiveAction, clearInlineFieldError } from "./services.js";

export async function checkAuthReadiness({ force = false } = {}) {
  state.authServiceStatus = "checking";
  state.authServiceMessage = "正在检查认证服务…";
  state.authServiceCode = "";
  if (state.authRequired && !state.appLoading) render();

  try {
    const response = await fetch(`${API_AUTH_READINESS_URL}${force ? "?force=1" : ""}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      credentials: "same-origin",
    });
    const data = await response.json().catch(() => ({}));
    const readiness = data?.auth && typeof data.auth === "object" ? data.auth : {};
    const localReadiness = data?.localAuth && typeof data.localAuth === "object" ? data.localAuth : {};
    state.localAuthAvailable = localReadiness.available === true && localReadiness.ready === true;
    const usingLocal = state.authProvider === "local";
    const ready = usingLocal ? state.localAuthAvailable : response.ok && readiness.ready === true;
    state.authServiceStatus = ready ? "ready" : "unavailable";
    state.authServiceMessage = String(
      usingLocal
        ? localReadiness.message || (ready ? "本机账号模式已就绪。" : "本机账号模式不可用。")
        : readiness.message || (ready ? "认证服务已连接。" : "认证服务暂不可用，请稍后重试。"),
    );
    state.authServiceCode = String(
      usingLocal
        ? localReadiness.code || (ready ? "LOCAL_AUTH_READY" : "LOCAL_AUTH_DISABLED")
        : readiness.code || (ready ? "AUTH_READY" : "AUTH_PROVIDER_UNAVAILABLE"),
    );
    state.authSignupAllowed = usingLocal ? ready : ready && readiness.signupAllowed !== false;
    state.authReadinessCheckedAt = String(readiness.checkedAt || "");
    return {
      ready,
      signupAllowed: state.authSignupAllowed,
      code: state.authServiceCode,
      message: state.authServiceMessage,
    };
  } catch {
    state.authServiceStatus = "unavailable";
    state.authServiceMessage =
      navigator.onLine === false ? "当前设备处于离线状态，联网后才能登录或注册。" : "无法连接本地认证接口，请确认应用服务仍在运行。";
    state.authServiceCode = navigator.onLine === false ? "AUTH_CLIENT_OFFLINE" : "AUTH_GATEWAY_UNREACHABLE";
    state.authSignupAllowed = false;
    state.authReadinessCheckedAt = "";
    return {
      ready: false,
      signupAllowed: false,
      code: state.authServiceCode,
      message: state.authServiceMessage,
    };
  } finally {
    if (state.authRequired && !state.appLoading) render();
  }
}

export async function submitEmailAuth() {
  if (state.authLoading || state.authServiceStatus === "checking") return false;
  const email = document.querySelector("[data-auth-email]")?.value?.trim() || "";
  const password = document.querySelector("[data-auth-password]")?.value || "";
  const isSignup = state.authMode === "signup";
  const fieldErrors = {};
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fieldErrors.email = "请输入有效邮箱地址";
  if (password.length < 6) fieldErrors.password = "密码至少需要 6 位";
  if (Object.keys(fieldErrors).length) {
    state.authEmail = email;
    state.authFieldErrors = fieldErrors;
    state.authError = "";
    render();
    const firstField = Object.keys(fieldErrors)[0];
    requestAnimationFrame(() => document.querySelector(`[name="${firstField}"]`)?.focus({ preventScroll: false }));
    return;
  }
  if (state.authProvider === "supabase" && (state.authServiceStatus !== "ready" || (isSignup && !state.authSignupAllowed))) {
    const readiness = await checkAuthReadiness({ force: true });
    if (!readiness.ready || (isSignup && !readiness.signupAllowed)) return;
  }
  state.authError = "";
  state.authFieldErrors = {};
  state.authLoading = true;
  state.authEmail = email;
  render();
  try {
    const response = await fetch(isSignup ? API_AUTH_SIGNUP_URL : API_AUTH_LOGIN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ email, password, provider: state.authProvider }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const requestError = new Error(data.error || (isSignup ? "注册失败" : "登录失败"));
      requestError.code = String(data.code || (response.status >= 500 ? "AUTH_PROVIDER_UNAVAILABLE" : "AUTH_REQUEST_FAILED"));
      requestError.retryable = typeof data.retryable === "boolean" ? data.retryable : response.status >= 500;
      throw requestError;
    }
    if (data.needsEmailConfirmation && !data.accessToken) {
      state.authMode = "login";
      state.authError = "注册成功，请先去邮箱确认账号，再回来登录。";
      return;
    }
    if (!data.accessToken) throw new Error("没有收到登录凭证，请稍后重试。");
    storeSession(data);
    resetAppData({ blank: true });
    loadStoredState();
    state.authRequired = false;
    state.authEmail = email;
    activateTab("home", { replace: true });
    setBackendStatus(runtime.authProvider === "local" ? "device" : "online");
    render();
    const loadedFromServer = await loadServerState();
    if (loadedFromServer) {
      state.activeTab = tabFromLocation("home");
      state.settingsOpen = false;
      render();
    }
  } catch (error) {
    const serviceCodes = new Set([
      "AUTH_NOT_CONFIGURED",
      "AUTH_CONFIG_INVALID",
      "AUTH_PROJECT_NOT_FOUND",
      "AUTH_KEY_REJECTED",
      "AUTH_PROVIDER_TIMEOUT",
      "AUTH_PROVIDER_UNREACHABLE",
      "AUTH_PROVIDER_UNAVAILABLE",
      "AUTH_TLS_FAILED",
      "LOCAL_AUTH_DISABLED",
      "LOCAL_AUTH_STORE_CORRUPT",
      "LOCAL_AUTH_STORE_UNAVAILABLE",
    ]);
    if (serviceCodes.has(error.code)) {
      state.authServiceStatus = "unavailable";
      state.authServiceMessage = error.message;
      state.authServiceCode = error.code;
      state.authSignupAllowed = false;
      state.authError = "";
    } else if (error.code === "AUTH_SIGNUP_DISABLED") {
      state.authServiceStatus = "ready";
      state.authServiceMessage = error.message;
      state.authServiceCode = error.code;
      state.authSignupAllowed = false;
      state.authError = "";
    } else {
      state.authError = error.message || (isSignup ? "注册失败" : "登录失败");
    }
  } finally {
    state.authLoading = false;
    render();
  }
}

export async function logout() {
  return runExclusiveAction("logout", async () => {
    try {
      await fetch(API_AUTH_LOGOUT_URL, { method: "POST", credentials: "same-origin", headers: authHeaders() });
    } catch {
      // Local logout should still complete if the network is unavailable.
    }
    const aiController = runtime.aiNutritionController;
    runtime.aiNutritionSequence += 1;
    runtime.aiNutritionController = null;
    runtime.aiNutritionDraftKey = "";
    try {
      aiController?.abort();
    } catch {
      // Session teardown still invalidates the request sequence.
    }
    runtime.celebrationOpen = false;
    runtime.celebrationReturnSelector = "";
    runtime.completionFeedback = null;
    runtime.completionAnnouncement = "";
    clearSession();
    resetAppData();
    state.authRequired = true;
    state.authMode = "login";
    state.authError = "";
    state.authFieldErrors = {};
    state.authLoading = false;
    state.authServiceStatus = "checking";
    state.authServiceMessage = "正在检查认证服务…";
    state.authServiceCode = "";
    setBackendStatus("idle");
    render();
    void checkAuthReadiness();
    return true;
  });
}

export async function deleteAccount() {
  return runExclusiveAction("deleteAccount", async () => {
    try {
      if (!runtime.accessToken) throw new Error("请先登录");
      let response = await fetch(API_AUTH_ACCOUNT_URL, { method: "DELETE", headers: authHeaders() });
      if (response.status === 401 && (await refreshSession())) {
        response = await fetch(API_AUTH_ACCOUNT_URL, { method: "DELETE", headers: authHeaders() });
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "账号删除失败，请稍后重试");
      if (runtime.authUserId) removeStorageValue(userStorageKey());
      const aiController = runtime.aiNutritionController;
      runtime.aiNutritionSequence += 1;
      runtime.aiNutritionController = null;
      runtime.aiNutritionDraftKey = "";
      try {
        aiController?.abort();
      } catch {
        // Session teardown still invalidates the request sequence.
      }
      runtime.celebrationOpen = false;
      runtime.celebrationReturnSelector = "";
      runtime.completionFeedback = null;
      runtime.completionAnnouncement = "";
      clearSession();
      resetAppData();
      state.authRequired = true;
      state.deleteAccountOpen = false;
      state.authMode = "login";
      state.authError = "";
      state.authFieldErrors = {};
      state.authLoading = false;
      state.authServiceStatus = "checking";
      state.authServiceMessage = "正在检查认证服务…";
      state.authServiceCode = "";
      setBackendStatus("idle");
      render();
      showToast("账号已删除");
      void checkAuthReadiness();
      return true;
    } catch (error) {
      showToast(error.message || "账号删除失败，请稍后重试");
      return false;
    }
  });
}

export function togglePasswordVisibility(control) {
  state.authPasswordVisible = !state.authPasswordVisible;
  const input = document.querySelector("[data-auth-password]");
  if (input) input.type = state.authPasswordVisible ? "text" : "password";
  control.textContent = state.authPasswordVisible ? "隐藏" : "显示";
  control.setAttribute("aria-label", state.authPasswordVisible ? "隐藏密码" : "显示密码");
  input?.focus({ preventScroll: true });
}

export function switchAuthMode(mode) {
  state.authMode = mode || "login";
  state.authError = "";
  state.authFieldErrors = {};
  render();
}

export function useLocalAuthProvider() {
  state.authProvider = "local";
  state.authError = "";
  state.authFieldErrors = {};
  state.authServiceStatus = state.localAuthAvailable ? "ready" : "unavailable";
  state.authServiceMessage = state.localAuthAvailable ? "本机账号模式已就绪。" : "本机账号模式不可用。";
  state.authServiceCode = state.localAuthAvailable ? "LOCAL_AUTH_READY" : "LOCAL_AUTH_DISABLED";
  state.authSignupAllowed = state.localAuthAvailable;
  render();
}

export function useCloudAuthProvider() {
  state.authProvider = "supabase";
  state.authError = "";
  state.authFieldErrors = {};
  void checkAuthReadiness({ force: true });
}

export function handleAuthEmailInput(input) {
  state.authEmail = input.value;
  clearInlineFieldError(input, state.authFieldErrors, "email", state.authError ? "auth-error" : "");
}

export function handleAuthPasswordInput(input) {
  clearInlineFieldError(input, state.authFieldErrors, "password", state.authError ? "auth-error" : "");
}
