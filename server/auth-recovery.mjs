import { requestSupabase, sessionPayload, currentUserFromRequest } from "./supabase.mjs";
import { refreshCookieHeader } from "./http.mjs";
import { assertWithinRateLimit, clientIp } from "./rate-limit.mjs";

export async function handleAuthRecovery(request, response, url, { readJsonBody, sendJson, sendJsonWithHeaders }) {
  if (
    !["/api/auth/callback", "/api/auth/recover", "/api/auth/resend", "/api/auth/verify", "/api/auth/password"].includes(url.pathname) ||
    request.method !== "POST"
  )
    return false;
  if (!String(request.headers["content-type"] || "").startsWith("application/json") || request.headers["sec-fetch-site"] === "cross-site") {
    throw Object.assign(new Error("请从应用内提交账号请求"), { status: 403, code: "AUTH_ORIGIN_REJECTED" });
  }
  const configured = process.env.PUBLIC_APP_ORIGIN;
  const origin =
    configured ||
    (process.env.NODE_ENV === "production" ? "https://male-fat-loss-app-prototype.onrender.com" : `http://${request.headers.host}`);
  if (request.headers.origin && request.headers.origin !== origin)
    throw Object.assign(new Error("请求来源不匹配"), { status: 403, code: "AUTH_ORIGIN_REJECTED" });
  assertWithinRateLimit(`auth-recovery:${clientIp(request)}`, {
    limit: 5,
    windowMs: 15 * 60_000,
    message: "账号邮件请求较频繁，请稍后重试",
    code: "AUTH_RATE_LIMITED",
  });
  const payload = await readJsonBody(request);
  if (url.pathname === "/api/auth/callback") {
    if (typeof payload.refreshToken !== "string" || payload.refreshToken.length < 16 || payload.refreshToken.length > 1024)
      throw Object.assign(new Error("链接无效"), { status: 400, code: "AUTH_LINK_INVALID" });
    const data = await requestSupabase("/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      body: { refresh_token: payload.refreshToken },
    });
    sendJsonWithHeaders(response, 200, sessionPayload(data), { "Set-Cookie": refreshCookieHeader(data.refresh_token, request) });
    return true;
  }
  if (url.pathname === "/api/auth/password") {
    const auth = await currentUserFromRequest(request);
    const password = String(payload.password || "");
    if (password.length < 8 || password.length > 128)
      throw Object.assign(new Error("新密码需要 8–128 位"), { status: 400, code: "AUTH_PASSWORD_INVALID" });
    await requestSupabase("/auth/v1/user", { method: "PUT", accessToken: auth.accessToken, body: { password } });
    sendJson(response, 200, { ok: true });
    return true;
  }
  if (url.pathname === "/api/auth/verify") {
    if (!["signup", "recovery"].includes(payload.type) || !/^[a-zA-Z0-9_-]{16,512}$/.test(payload.tokenHash || ""))
      throw Object.assign(new Error("链接无效或已经过期，请重新发送邮件"), { status: 400, code: "AUTH_LINK_INVALID" });
    const data = await requestSupabase("/auth/v1/verify", { method: "POST", body: { token_hash: payload.tokenHash, type: payload.type } });
    sendJsonWithHeaders(
      response,
      200,
      sessionPayload(data),
      data.refresh_token ? { "Set-Cookie": refreshCookieHeader(data.refresh_token, request) } : {},
    );
    return true;
  }
  const email = String(payload.email || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
    throw Object.assign(new Error("请输入有效邮箱"), { status: 400, code: "AUTH_EMAIL_INVALID" });
  const resend = url.pathname.endsWith("resend");
  try {
    await requestSupabase(`/auth/v1/${resend ? "resend" : "recover"}?redirect_to=${encodeURIComponent(`${origin}/?auth=callback`)}`, {
      method: "POST",
      body: { email, ...(resend ? { type: "signup" } : {}) },
    });
  } catch (error) {
    if (error.status >= 500 || error.status === 429) throw error;
    // Do not reveal whether an email is registered or already confirmed.
  }
  sendJson(response, 200, { ok: true, message: "如果该邮箱符合条件，将收到邮件。请检查收件箱及垃圾邮件。" });
  return true;
}
