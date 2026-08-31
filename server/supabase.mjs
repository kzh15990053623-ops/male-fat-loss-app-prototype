import { createHash } from "node:crypto";
import {
  supabaseAnonKey,
  supabaseProbeTimeoutMs,
  supabaseReadinessTtlMs,
  supabaseRequestTimeoutMs,
  supabaseServiceRoleKey,
  supabaseUrl,
} from "./config.mjs";
import { defaultData, isRecord, normalizeAppData, sanitizeMeals, stateRevision, stateWriteRevision, storedStateForWrite } from "./data.mjs";
import { isLocalAccessToken, localAuthService } from "./local-auth.mjs";

let authReadinessCache = { key: "", expiresAt: 0, value: null };

function publicAuthError(message, { status = 503, code = "AUTH_PROVIDER_UNAVAILABLE", retryable = true, cause } = {}) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.status = status;
  error.code = code;
  error.retryable = retryable;
  return error;
}

function hasRealSupabaseValue(value) {
  const text = String(value || "").trim();
  return Boolean(text && !text.includes("your-") && !text.includes("your-project-ref"));
}

export function validateSupabaseConfig({ url = supabaseUrl, anonKey = supabaseAnonKey } = {}) {
  const cleanUrl = String(url || "")
    .trim()
    .replace(/\/+$/, "");
  const cleanKey = String(anonKey || "").trim();
  if (!hasRealSupabaseValue(cleanUrl) || !hasRealSupabaseValue(cleanKey)) {
    return {
      valid: false,
      code: "AUTH_NOT_CONFIGURED",
      message: "认证服务尚未配置，请填写 Supabase Project URL 和 Publishable key。",
    };
  }
  try {
    const parsed = new URL(cleanUrl);
    if (!/^https?:$/.test(parsed.protocol) || !parsed.hostname) throw new Error("invalid protocol");
  } catch {
    return {
      valid: false,
      code: "AUTH_CONFIG_INVALID",
      message: "Supabase Project URL 格式无效，请从项目 API 设置中重新复制。",
    };
  }
  if (cleanKey.length < 20) {
    return {
      valid: false,
      code: "AUTH_CONFIG_INVALID",
      message: "Supabase Publishable key 格式无效，请从项目 API 设置中重新复制。",
    };
  }
  return { valid: true, code: "AUTH_CONFIGURED", message: "认证配置格式有效。", url: cleanUrl, anonKey: cleanKey };
}

export function isSupabaseConfigured() {
  return validateSupabaseConfig().valid;
}

function headersFor(anonKey, accessToken = "", extra = {}) {
  return {
    apikey: anonKey,
    Authorization: `Bearer ${accessToken || anonKey}`,
    ...extra,
  };
}

function supabaseHeaders(accessToken = "", extra = {}) {
  return headersFor(supabaseAnonKey, accessToken, extra);
}

async function parseResponseBody(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function supabaseErrorMessage(data, fallback = "Supabase request failed") {
  if (!data) return fallback;
  const message = typeof data === "string" ? data : data.error_description || data.msg || data.message || data.error || fallback;
  return friendlySupabaseError(message);
}

function friendlySupabaseError(message) {
  const text = String(message || "");
  const lowerText = text.toLowerCase();
  if (lowerText.includes("invalid login credentials")) return "邮箱或密码不正确";
  if (lowerText.includes("email not confirmed")) return "请先完成邮箱确认，再回来登录";
  if (lowerText.includes("user already registered") || lowerText.includes("already been registered")) return "这个邮箱已经注册，请直接登录";
  if (lowerText.includes("password should be at least")) return "密码至少需要 6 位";
  if (lowerText.includes("signup") && lowerText.includes("disabled")) return "当前项目已关闭新用户注册，请联系管理员";
  if (lowerText.includes("invalid api key") || lowerText.includes("no api key"))
    return "认证服务密钥无效，请重新配置 Supabase Publishable key";
  if (lowerText.includes("rate limit")) return "操作太频繁，请稍后再试";
  return text || "请求失败，请稍后再试";
}

function upstreamErrorCode(data, status) {
  const sourceCode = String(data?.error_code || data?.code || "").toLowerCase();
  if (sourceCode === "signup_disabled") return "AUTH_SIGNUP_DISABLED";
  if (sourceCode === "email_exists" || sourceCode === "user_already_exists") return "AUTH_EMAIL_EXISTS";
  if (status === 401 || status === 403) return "AUTH_CREDENTIAL_REJECTED";
  if (status === 429) return "AUTH_RATE_LIMITED";
  return status >= 500 ? "AUTH_PROVIDER_UNAVAILABLE" : "AUTH_REQUEST_REJECTED";
}

export function classifySupabaseNetworkError(error) {
  const causeCode = String(error?.cause?.code || error?.code || "").toUpperCase();
  if (causeCode === "ENOTFOUND") {
    return {
      status: 503,
      code: "AUTH_PROJECT_NOT_FOUND",
      retryable: false,
      message: "认证服务地址不存在，请检查 SUPABASE_URL 是否来自当前 Supabase 项目。",
    };
  }
  if (["ABORT_ERR", "UND_ERR_CONNECT_TIMEOUT", "ETIMEDOUT"].includes(causeCode) || error?.name === "TimeoutError") {
    return {
      status: 504,
      code: "AUTH_PROVIDER_TIMEOUT",
      retryable: true,
      message: "认证服务连接超时，请稍后重试。",
    };
  }
  if (causeCode.includes("CERT") || causeCode.includes("TLS")) {
    return {
      status: 502,
      code: "AUTH_TLS_FAILED",
      retryable: false,
      message: "认证服务的安全连接校验失败，请检查项目地址。",
    };
  }
  return {
    status: 503,
    code: "AUTH_PROVIDER_UNREACHABLE",
    retryable: true,
    message: "暂时无法连接认证服务，请检查网络或 Supabase 项目状态。",
  };
}

function readinessCacheKey(url, anonKey) {
  const keyFingerprint = createHash("sha256").update(anonKey).digest("hex");
  return `${url}|${keyFingerprint}`;
}

export function resetSupabaseReadinessCache() {
  authReadinessCache = { key: "", expiresAt: 0, value: null };
}

export async function probeSupabaseAuth({
  force = false,
  fetchImpl = fetch,
  now = Date.now(),
  timeoutMs = supabaseProbeTimeoutMs,
  ttlMs = supabaseReadinessTtlMs,
  url = supabaseUrl,
  anonKey = supabaseAnonKey,
} = {}) {
  const config = validateSupabaseConfig({ url, anonKey });
  const checkedAt = new Date(now).toISOString();
  if (!config.valid) {
    return {
      configured: false,
      reachable: false,
      ready: false,
      signupAllowed: false,
      code: config.code,
      message: config.message,
      checkedAt,
    };
  }
  const cacheKey = readinessCacheKey(config.url, config.anonKey);
  if (!force && authReadinessCache.key === cacheKey && authReadinessCache.value && authReadinessCache.expiresAt > now) {
    return authReadinessCache.value;
  }

  let result;
  try {
    const response = await fetchImpl(`${config.url}/auth/v1/settings`, {
      method: "GET",
      headers: headersFor(config.anonKey),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await parseResponseBody(response);
    if (!response.ok) {
      const keyRejected = response.status === 401 || response.status === 403;
      result = {
        configured: true,
        reachable: true,
        ready: false,
        signupAllowed: false,
        code: keyRejected ? "AUTH_KEY_REJECTED" : response.status === 404 ? "AUTH_PROJECT_NOT_FOUND" : "AUTH_PROVIDER_UNAVAILABLE",
        message: keyRejected
          ? "Supabase Publishable key 被拒绝，请从项目 API 设置中重新复制。"
          : response.status === 404
            ? "没有找到对应的 Supabase Auth 项目，请检查 Project URL。"
            : "Supabase Auth 当前不可用，请稍后重试。",
        checkedAt,
      };
    } else {
      const signupAllowed = data?.disable_signup !== true;
      result = {
        configured: true,
        reachable: true,
        ready: true,
        signupAllowed,
        emailConfirmationRequired: data?.autoconfirm !== true,
        code: signupAllowed ? "AUTH_READY" : "AUTH_SIGNUP_DISABLED",
        message: signupAllowed ? "认证服务已连接。" : "认证服务可用，但当前项目已关闭新用户注册。",
        checkedAt,
      };
    }
  } catch (error) {
    const classified = classifySupabaseNetworkError(error);
    result = {
      configured: true,
      reachable: false,
      ready: false,
      signupAllowed: false,
      code: classified.code,
      message: classified.message,
      checkedAt,
    };
  }
  authReadinessCache = { key: cacheKey, expiresAt: now + ttlMs, value: result };
  return result;
}

export async function assertSupabaseAuthReady({ forSignup = false, force = false, probe = probeSupabaseAuth } = {}) {
  const readiness = await probe({ force });
  if (!readiness.ready) {
    throw publicAuthError(readiness.message, {
      status: 503,
      code: readiness.code,
      retryable: !["AUTH_NOT_CONFIGURED", "AUTH_CONFIG_INVALID", "AUTH_PROJECT_NOT_FOUND", "AUTH_KEY_REJECTED"].includes(readiness.code),
    });
  }
  if (forSignup && !readiness.signupAllowed) {
    throw publicAuthError(readiness.message, { status: 403, code: "AUTH_SIGNUP_DISABLED", retryable: false });
  }
  return readiness;
}

export async function requestSupabase(
  path,
  { method = "GET", accessToken = "", body, headers = {}, fetchImpl = fetch, timeoutMs = supabaseRequestTimeoutMs } = {},
) {
  const config = validateSupabaseConfig();
  if (!config.valid) {
    throw publicAuthError(config.message, { code: config.code, retryable: false });
  }
  let response;
  try {
    response = await fetchImpl(`${config.url}${path}`, {
      method,
      headers: supabaseHeaders(accessToken, {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...headers,
      }),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    resetSupabaseReadinessCache();
    const classified = classifySupabaseNetworkError(error);
    throw publicAuthError(classified.message, { ...classified, cause: error });
  }
  const data = await parseResponseBody(response);
  if (!response.ok) {
    const error = new Error(supabaseErrorMessage(data));
    error.status = response.status;
    error.code = upstreamErrorCode(data, response.status);
    error.retryable = response.status === 429 || response.status >= 500;
    error.data = data;
    throw error;
  }
  return data;
}

function cleanEmail(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

export function validateAuthInput(payload) {
  const email = cleanEmail(payload.email);
  const password = String(payload.password || "");
  if (!email || !email.includes("@")) {
    const error = new Error("请输入有效邮箱");
    error.status = 400;
    throw error;
  }
  if (password.length < 6) {
    const error = new Error("密码至少需要 6 位");
    error.status = 400;
    throw error;
  }
  return { email, password };
}

export function sessionPayload(data, { includeRefreshToken = false } = {}) {
  const payload = {
    provider: data?.provider === "local" ? "local" : "supabase",
    accessToken: data?.access_token || "",
    expiresIn: data?.expires_in || null,
    user: data?.user ? { id: data.user.id, email: data.user.email } : null,
  };
  if (includeRefreshToken) payload.refreshToken = data?.refresh_token || "";
  return payload;
}

export async function readAppState(accessToken, userId) {
  const rows = await requestSupabase(`/rest/v1/app_states?select=state,meals,updated_at&user_id=eq.${encodeURIComponent(userId)}&limit=1`, {
    accessToken,
  });
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return { ...defaultData, revision: 0 };
  return {
    ...normalizeAppData({
      state: row.state,
      meals: row.meals,
      updatedAt: row.updated_at,
    }),
    revision: stateRevision(row.state),
  };
}

function stateConflictError(message, currentPayload, code = "STATE_CONFLICT") {
  const error = new Error(message);
  error.status = 409;
  error.code = code;
  error.retryable = true;
  error.conflict = currentPayload;
  return error;
}

async function currentAppDataRow(accessToken, userId) {
  const rows = await requestSupabase(`/rest/v1/app_states?select=state,meals,updated_at&user_id=eq.${encodeURIComponent(userId)}&limit=1`, {
    accessToken,
  });
  return Array.isArray(rows) ? rows[0] || null : null;
}

function appDataFromRow(row, fallbackUpdatedAt = null) {
  return {
    ...normalizeAppData({
      state: row?.state,
      meals: row?.meals,
      updatedAt: row?.updated_at || fallbackUpdatedAt,
    }),
    revision: stateRevision(row?.state),
  };
}

export function revisionFilterForState(state) {
  if (!isRecord(state) || !Object.prototype.hasOwnProperty.call(state, "syncRevision") || state.syncRevision === null) {
    return "state->>syncRevision=is.null";
  }
  return `state->>syncRevision=eq.${encodeURIComponent(String(state.syncRevision))}`;
}

// Existing rows use a single conditional PATCH. Initial rows use a regular
// primary-key insert, so concurrent revision-0 creates cannot overwrite one
// another through an upsert.
export async function writeAppState(payload, accessToken, userId) {
  const safePayload = isRecord(payload) ? payload : {};
  const revisionInput = stateWriteRevision(safePayload);
  if (!revisionInput.ok && !revisionInput.missing) {
    const error = new Error("状态版本号必须是非负整数。");
    error.status = 400;
    error.code = "STATE_REVISION_INVALID";
    error.retryable = false;
    throw error;
  }

  const currentRow = await currentAppDataRow(accessToken, userId);
  const currentRevision = stateRevision(currentRow?.state);
  if (revisionInput.missing) {
    throw stateConflictError("状态版本号缺失，请先合并当前记录。", appDataFromRow(currentRow), "STATE_REVISION_REQUIRED");
  }
  if (revisionInput.revision !== currentRevision) {
    throw stateConflictError("云端记录已被其他设备更新，正在自动合并", appDataFromRow(currentRow));
  }

  const nextRevision = currentRevision + 1;
  const updatedAt = new Date().toISOString();
  const data = {
    user_id: userId,
    state: storedStateForWrite(safePayload.state, nextRevision, updatedAt),
    meals: sanitizeMeals(safePayload.meals),
    updated_at: updatedAt,
  };

  if (currentRow) {
    // Rows written before optimistic concurrency have no syncRevision at all:
    // pin the CAS on NULL instead of eq.0 so legacy rows are guarded too.
    const revisionFilter = revisionFilterForState(currentRow.state);
    const rows = await requestSupabase(`/rest/v1/app_states?user_id=eq.${encodeURIComponent(userId)}&${revisionFilter}`, {
      method: "PATCH",
      accessToken,
      headers: { Prefer: "return=representation" },
      body: data,
    });
    if (!Array.isArray(rows) || rows.length === 0) {
      // Lost the race between our read and the conditional update: the stored
      // revision moved. Report the fresh payload for client-side merging.
      const freshRow = await currentAppDataRow(accessToken, userId);
      throw stateConflictError("云端记录已被其他设备更新，正在自动合并", appDataFromRow(freshRow));
    }
    return appDataFromRow(rows[0], data.updated_at);
  }

  try {
    const rows = await requestSupabase("/rest/v1/app_states", {
      method: "POST",
      accessToken,
      headers: { Prefer: "return=representation" },
      body: data,
    });
    return appDataFromRow(Array.isArray(rows) ? rows[0] : null, data.updated_at);
  } catch (error) {
    if (error.status !== 409) throw error;
    const freshRow = await currentAppDataRow(accessToken, userId);
    throw stateConflictError("云端记录已被其他设备更新，正在自动合并", appDataFromRow(freshRow));
  }
}

export async function deleteAppState(accessToken, userId) {
  await requestSupabase(`/rest/v1/app_states?user_id=eq.${encodeURIComponent(userId)}`, {
    method: "DELETE",
    accessToken,
  });
  return defaultData;
}

function bearerTokenFrom(request) {
  const authorization = request.headers.authorization || "";
  if (!authorization.toLowerCase().startsWith("bearer ")) return "";
  return authorization.slice(7).trim();
}

export async function currentUserFromRequest(request) {
  const accessToken = bearerTokenFrom(request);
  if (!accessToken) {
    const error = new Error("请先登录");
    error.status = 401;
    throw error;
  }
  if (isLocalAccessToken(accessToken)) return localAuthService.currentUser(accessToken);
  const data = await requestSupabase("/auth/v1/user", { accessToken });
  if (!data?.id) {
    const error = new Error("登录状态无效，请重新登录");
    error.status = 401;
    throw error;
  }
  return {
    accessToken,
    provider: "supabase",
    user: { id: data.id, email: data.email },
  };
}

// Best-effort server-side revocation: invalidates the refresh-token family of the
// current session so a leaked cookie stops working after logout. Local cookie
// cleanup in the logout route proceeds regardless of the outcome here.
export async function revokeSupabaseSession(request) {
  const accessToken = bearerTokenFrom(request);
  if (!accessToken || !isSupabaseConfigured()) return;
  try {
    await requestSupabase("/auth/v1/logout?scope=global", { method: "POST", accessToken });
  } catch {
    // The client session is still cleared locally even if upstream revocation fails.
  }
}

export function supabaseAccountDeletionAvailable() {
  return Boolean(supabaseServiceRoleKey) && isSupabaseConfigured();
}

// Admin API call keyed by the service-role key. Only used for account deletion.
async function requestSupabaseAdmin(path, { method = "GET" } = {}) {
  const config = validateSupabaseConfig();
  if (!config.valid) {
    throw publicAuthError(config.message, { code: config.code, retryable: false });
  }
  let response;
  try {
    response = await fetch(`${config.url}${path}`, {
      method,
      headers: {
        apikey: supabaseServiceRoleKey,
        Authorization: `Bearer ${supabaseServiceRoleKey}`,
      },
      signal: AbortSignal.timeout(supabaseRequestTimeoutMs),
    });
  } catch (error) {
    const classified = classifySupabaseNetworkError(error);
    throw publicAuthError(classified.message, { ...classified, cause: error });
  }
  if (!response.ok) {
    const data = await parseResponseBody(response);
    const error = new Error(supabaseErrorMessage(data, "删除账号失败，请稍后再试"));
    error.status = response.status;
    error.code = "ACCOUNT_DELETION_FAILED";
    error.retryable = response.status >= 500;
    throw error;
  }
}

export async function deleteSupabaseAccount(userId) {
  if (!supabaseServiceRoleKey) {
    throw publicAuthError("当前部署未配置 SUPABASE_SERVICE_ROLE_KEY，暂不支持云端账号注销。", {
      status: 503,
      code: "ACCOUNT_DELETION_UNAVAILABLE",
      retryable: false,
    });
  }
  await requestSupabaseAdmin(`/auth/v1/admin/users/${encodeURIComponent(userId)}`, { method: "DELETE" });
}
