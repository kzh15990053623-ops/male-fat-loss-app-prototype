import { localAuthEnabled, MAX_JSON_BODY_BYTES, REFRESH_COOKIE_NAME } from "./config.mjs";
import { baseHeaders, clearRefreshCookieHeader, cookieFromRequest, refreshCookieHeader } from "./http.mjs";
import { isLocalRefreshToken, localAuthService } from "./local-auth.mjs";
import { nutritionAiConfigured, requestNutritionEstimate } from "./nutrition.mjs";
import { assertWithinRateLimit, clientIp } from "./rate-limit.mjs";
import {
  assertSupabaseAuthReady,
  currentUserFromRequest,
  deleteSupabaseAccount,
  isSupabaseConfigured,
  probeSupabaseAuth,
  readAppState,
  requestSupabase,
  revokeSupabaseSession,
  sessionPayload,
  supabaseAccountDeletionAvailable,
  validateAuthInput,
  writeAppState,
} from "./supabase.mjs";

const AUTH_RATE_LIMIT = { limit: 20, windowMs: 5 * 60 * 1000 };
const AI_RATE_LIMIT_MINUTE = { limit: 20, windowMs: 60 * 1000 };
const AI_RATE_LIMIT_DAY = { limit: 200, windowMs: 24 * 60 * 60 * 1000 };

export function sendJson(response, status, data) {
  response.writeHead(
    status,
    baseHeaders({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    }),
  );
  response.end(JSON.stringify(data));
}

export function sendJsonWithHeaders(response, status, data, headers = {}) {
  response.writeHead(
    status,
    baseHeaders({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    }),
  );
  response.end(JSON.stringify(data));
}

// Accumulate raw Buffer chunks and decode once at the end: concatenating
// strings per chunk decodes each Buffer separately, mangling multi-byte
// UTF-8 characters that straddle a chunk boundary. The size limit also
// counts network bytes, not UTF-16 code units.
export function readJsonBody(request) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let receivedBytes = 0;
    let settled = false;
    request.on("data", (chunk) => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      receivedBytes += buffer.length;
      if (receivedBytes > MAX_JSON_BODY_BYTES) {
        settled = true;
        const error = new Error("请求体过大，请减少单次提交的数据量");
        error.status = 413;
        error.code = "REQUEST_BODY_TOO_LARGE";
        error.retryable = false;
        rejectBody(error);
        request.resume();
        return;
      }
      chunks.push(buffer);
    });
    request.on("end", () => {
      if (settled) return;
      try {
        const body = Buffer.concat(chunks).toString("utf8");
        resolveBody(body ? JSON.parse(body) : {});
      } catch {
        const error = new Error("请求 JSON 格式无效");
        error.status = 400;
        error.code = "REQUEST_BODY_INVALID";
        error.retryable = false;
        rejectBody(error);
      }
    });
    request.on("error", rejectBody);
  });
}

export async function handleApi(request, response, url) {
  if (url.pathname === "/api/health") {
    sendJson(response, 200, {
      ok: true,
      liveness: "ok",
      auth: "supabase",
      supabaseConfigured: isSupabaseConfigured(),
      readinessUrl: "/api/readiness",
      localAuthEnabled,
      nutritionAiConfigured: nutritionAiConfigured(),
    });
    return true;
  }

  if (url.pathname === "/api/readiness" && request.method === "GET") {
    const auth = await probeSupabaseAuth({ force: url.searchParams.get("force") === "1" });
    sendJson(response, auth.ready ? 200 : 503, {
      ok: auth.ready,
      auth,
      localAuth: {
        available: localAuthEnabled,
        ready: localAuthEnabled,
        code: localAuthEnabled ? "LOCAL_AUTH_READY" : "LOCAL_AUTH_DISABLED",
        message: localAuthEnabled ? "本机账号模式可用。" : "本机账号模式未启用。",
      },
    });
    return true;
  }

  if (url.pathname === "/api/auth/signup" && request.method === "POST") {
    assertWithinRateLimit(`auth-signup:${clientIp(request)}`, {
      ...AUTH_RATE_LIMIT,
      message: "注册请求太频繁，请稍后再试",
      code: "AUTH_RATE_LIMITED",
    });
    const payload = await readJsonBody(request);
    const { email, password } = validateAuthInput(payload);
    if (payload.provider === "local") {
      const data = await localAuthService.signup(email, password);
      sendJsonWithHeaders(response, 200, sessionPayload(data), {
        "Set-Cookie": refreshCookieHeader(data.refresh_token, request),
      });
      return true;
    }
    await assertSupabaseAuthReady({ forSignup: true });
    const data = await requestSupabase("/auth/v1/signup", {
      method: "POST",
      body: { email, password },
    });
    const headers = data?.refresh_token ? { "Set-Cookie": refreshCookieHeader(data.refresh_token, request) } : {};
    sendJsonWithHeaders(
      response,
      200,
      {
        ...sessionPayload(data),
        needsEmailConfirmation: !data?.access_token,
      },
      headers,
    );
    return true;
  }

  if (url.pathname === "/api/auth/login" && request.method === "POST") {
    assertWithinRateLimit(`auth-login:${clientIp(request)}`, {
      ...AUTH_RATE_LIMIT,
      message: "登录尝试太频繁，请稍后再试",
      code: "AUTH_RATE_LIMITED",
    });
    const payload = await readJsonBody(request);
    const { email, password } = validateAuthInput(payload);
    if (payload.provider === "local") {
      const data = await localAuthService.login(email, password);
      sendJsonWithHeaders(response, 200, sessionPayload(data), {
        "Set-Cookie": refreshCookieHeader(data.refresh_token, request),
      });
      return true;
    }
    await assertSupabaseAuthReady();
    const data = await requestSupabase("/auth/v1/token?grant_type=password", {
      method: "POST",
      body: { email, password },
    });
    const headers = data?.refresh_token ? { "Set-Cookie": refreshCookieHeader(data.refresh_token, request) } : {};
    sendJsonWithHeaders(response, 200, sessionPayload(data), headers);
    return true;
  }

  if (url.pathname === "/api/auth/refresh" && request.method === "POST") {
    await readJsonBody(request); // Drain the request body; the refresh token only travels via the HttpOnly cookie.
    const refreshToken = String(cookieFromRequest(request, REFRESH_COOKIE_NAME) || "");
    if (!refreshToken) {
      response.writeHead(204, baseHeaders({ "Cache-Control": "no-store" }));
      response.end();
      return true;
    }
    if (isLocalRefreshToken(refreshToken)) {
      const data = await localAuthService.refresh(refreshToken);
      sendJsonWithHeaders(response, 200, sessionPayload(data), {
        "Set-Cookie": refreshCookieHeader(data.refresh_token, request),
      });
      return true;
    }
    const data = await requestSupabase("/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      body: { refresh_token: refreshToken },
    });
    const headers = data?.refresh_token ? { "Set-Cookie": refreshCookieHeader(data.refresh_token, request) } : {};
    sendJsonWithHeaders(response, 200, sessionPayload(data), headers);
    return true;
  }

  if (url.pathname === "/api/auth/logout" && request.method === "POST") {
    const refreshToken = String(cookieFromRequest(request, REFRESH_COOKIE_NAME) || "");
    if (isLocalRefreshToken(refreshToken)) await localAuthService.logout(refreshToken);
    else await revokeSupabaseSession(request);
    sendJsonWithHeaders(response, 200, { ok: true }, { "Set-Cookie": clearRefreshCookieHeader(request) });
    return true;
  }

  const auth = await currentUserFromRequest(request);

  if (url.pathname === "/api/auth/user" && request.method === "GET") {
    sendJson(response, 200, { user: auth.user });
    return true;
  }

  if (url.pathname === "/api/state" && request.method === "GET") {
    sendJson(
      response,
      200,
      auth.provider === "local" ? await localAuthService.readAppState(auth.user.id) : await readAppState(auth.accessToken, auth.user.id),
    );
    return true;
  }

  if (url.pathname === "/api/state" && (request.method === "PUT" || request.method === "POST")) {
    const payload = await readJsonBody(request);
    sendJson(
      response,
      200,
      auth.provider === "local"
        ? await localAuthService.writeAppState(payload, auth.user.id)
        : await writeAppState(payload, auth.accessToken, auth.user.id),
    );
    return true;
  }

  if (url.pathname === "/api/state" && request.method === "DELETE") {
    sendJsonWithHeaders(
      response,
      405,
      { error: "状态清空必须使用带版本号的 PUT 请求。", code: "STATE_DELETE_UNSUPPORTED", retryable: false },
      { Allow: "GET, PUT, POST" },
    );
    return true;
  }

  if (url.pathname === "/api/auth/account" && request.method === "DELETE") {
    assertWithinRateLimit(`auth-account:${auth.user.id}`, {
      limit: 5,
      windowMs: 60 * 60 * 1000,
      message: "账号操作太频繁，请稍后再试",
      code: "AUTH_RATE_LIMITED",
    });
    if (auth.provider === "local") {
      await localAuthService.deleteAccount(auth.user.id);
    } else {
      // Fail fast before touching any data when admin deletion is not configured.
      if (!supabaseAccountDeletionAvailable()) {
        const error = new Error("当前部署未配置 SUPABASE_SERVICE_ROLE_KEY，暂不支持云端账号注销。");
        error.status = 503;
        error.code = "ACCOUNT_DELETION_UNAVAILABLE";
        error.retryable = false;
        throw error;
      }
      // Delete the Auth user first; the migration's ON DELETE CASCADE removes
      // the app_states row. If this admin call fails, the account and its
      // records are both still intact — data must never be destroyed before
      // the step that can fail has succeeded.
      await deleteSupabaseAccount(auth.user.id);
    }
    sendJsonWithHeaders(response, 200, { ok: true }, { "Set-Cookie": clearRefreshCookieHeader(request) });
    return true;
  }

  if (url.pathname === "/api/ai/nutrition" && request.method === "POST") {
    assertWithinRateLimit(`ai-nutrition:${auth.user.id}`, {
      ...AI_RATE_LIMIT_MINUTE,
      message: "AI 识别请求太频繁，请稍后再试",
      code: "AI_RATE_LIMITED",
    });
    assertWithinRateLimit(`ai-nutrition-day:${auth.user.id}`, {
      ...AI_RATE_LIMIT_DAY,
      message: "今日 AI 识别次数已用完，请明天再试或手动记录",
      code: "AI_DAILY_QUOTA_EXCEEDED",
    });
    const payload = await readJsonBody(request);
    const result = await requestNutritionEstimate(payload.foodText, payload.context || {}, {
      locale: "zh-CN",
    });
    sendJson(response, 200, result);
    return true;
  }

  return false;
}
