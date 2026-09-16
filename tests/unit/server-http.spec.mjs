import { describe, expect, it, vi } from "vitest";
import {
  applyHstsHeader,
  baseHeaders,
  clearRefreshCookieHeader,
  cookieFromRequest,
  isSecureRequest,
  refreshCookieHeader,
} from "../../server/http.mjs";

const request = (headers = {}, encrypted = false) => ({ headers, socket: { encrypted } });

describe("HTTP browser security boundaries", () => {
  it("keeps active content same-origin and prevents framing and content sniffing", () => {
    const headers = baseHeaders({ "Content-Type": "application/json" });
    const policy = headers["Content-Security-Policy"];
    for (const directive of ["script-src 'self'", "style-src 'self'", "frame-ancestors 'none'", "form-action 'self'"]) {
      expect(policy.split("; ")).toContain(directive);
    }
    expect(policy).not.toMatch(/unsafe-inline|unsafe-eval/);
    expect(headers).toMatchObject({ "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Content-Type": "application/json" });
  });

  it("requires HTTPS only on encrypted or HTTPS-proxied requests", () => {
    const setHeader = vi.fn();
    const insecure = request();
    expect(isSecureRequest(insecure)).toBe(false);
    applyHstsHeader(insecure, { setHeader });
    expect(setHeader).not.toHaveBeenCalled();
    for (const secure of [request({}, true), request({ "x-forwarded-proto": "https" })]) {
      expect(isSecureRequest(secure)).toBe(true);
      applyHstsHeader(secure, { setHeader });
      expect(setHeader).toHaveBeenLastCalledWith("Strict-Transport-Security", expect.stringMatching(/^max-age=\d+; includeSubDomains$/));
    }
  });

  it("round-trips encoded tokens, including equals signs, without reading another cookie", () => {
    const token = "opaque=token;with spaces/中文";
    const header = refreshCookieHeader(token, request({}, true));
    expect(cookieFromRequest(request({ cookie: `unrelated=value; ${header.split(";", 1)[0]}` }), "fat_loss_refresh")).toBe(token);
    expect(cookieFromRequest(request({ cookie: "unrelated=value" }), "fat_loss_refresh")).toBe("");
    expect(cookieFromRequest(request(), "fat_loss_refresh")).toBe("");
    expect(cookieFromRequest(request({ cookie: "fat_loss_refresh=first; fat_loss_refresh=second" }), "fat_loss_refresh")).toBe("first");
  });

  it("treats malformed cookie encoding as no credential instead of throwing a 500", () => {
    expect(cookieFromRequest(request({ cookie: "fat_loss_refresh=%E0%A4%A" }), "fat_loss_refresh")).toBe("");
  });

  it("sets and clears the same cookie scope while keeping the token inaccessible to JavaScript", () => {
    for (const secure of [false, true]) {
      const req = request({}, secure);
      const set = refreshCookieHeader("token", req);
      const clear = clearRefreshCookieHeader(req);
      for (const cookie of [set, clear]) {
        expect(cookie).toContain("; HttpOnly; SameSite=Lax; Path=/api/auth;");
        expect(cookie.includes("; Secure")).toBe(secure);
      }
      expect(set).toContain("Max-Age=2592000");
      expect(clear).toMatch(/^fat_loss_refresh=;/);
      expect(clear).toContain("Max-Age=0");
    }
  });
});
