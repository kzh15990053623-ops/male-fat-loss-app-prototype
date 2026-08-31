import { REFRESH_COOKIE_NAME } from "./config.mjs";

export function baseHeaders(extra = {}) {
  return {
    "Content-Security-Policy": [
      "default-src 'self'",
      "base-uri 'none'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self' https://*.supabase.co",
      "manifest-src 'self'",
      "worker-src 'self'",
      "form-action 'self'",
    ].join("; "),
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "same-origin",
    ...extra,
  };
}

export function isSecureRequest(request) {
  return request.headers["x-forwarded-proto"] === "https" || Boolean(request.socket?.encrypted);
}

const HSTS_POLICY = "max-age=63072000; includeSubDomains";

export function applyHstsHeader(request, response) {
  if (isSecureRequest(request)) {
    response.setHeader("Strict-Transport-Security", HSTS_POLICY);
  }
}

export function cookieFromRequest(request, name) {
  const cookieHeader = request.headers.cookie || "";
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .reduce((value, part) => {
      if (value) return value;
      const [key, ...rawValue] = part.split("=");
      return key === name ? decodeURIComponent(rawValue.join("=")) : "";
    }, "");
}

export function refreshCookieHeader(refreshToken, request) {
  const secure = isSecureRequest(request) ? "; Secure" : "";
  return `${REFRESH_COOKIE_NAME}=${encodeURIComponent(refreshToken)}; HttpOnly; SameSite=Lax; Path=/api/auth; Max-Age=2592000${secure}`;
}

export function clearRefreshCookieHeader(request) {
  const secure = isSecureRequest(request) ? "; Secure" : "";
  return `${REFRESH_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/api/auth; Max-Age=0${secure}`;
}
