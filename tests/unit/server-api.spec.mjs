import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentUserFromRequest: vi.fn(),
  probeSupabaseAuth: vi.fn(),
  assertSupabaseAuthReady: vi.fn(),
  requestSupabase: vi.fn(),
  readAppState: vi.fn(),
  writeAppState: vi.fn(),
  deleteSupabaseAccount: vi.fn(),
  supabaseAccountDeletionAvailable: vi.fn(),
  revokeSupabaseSession: vi.fn(),
  isSupabaseConfigured: vi.fn(),
  validateAuthInput: vi.fn(),
  sessionPayload: vi.fn(),
  assertWithinRateLimit: vi.fn(),
  requestNutritionEstimate: vi.fn(),
  nutritionAiConfigured: vi.fn(),
  local: {
    signup: vi.fn(),
    login: vi.fn(),
    refresh: vi.fn(),
    logout: vi.fn(),
    readAppState: vi.fn(),
    writeAppState: vi.fn(),
    deleteAccount: vi.fn(),
  },
}));
vi.mock("../../server/config.mjs", () => ({
  localAuthEnabled: true,
  MAX_JSON_BODY_BYTES: 1000000,
  REFRESH_COOKIE_NAME: "fat_loss_refresh",
}));
vi.mock("../../server/supabase.mjs", () => mocks);
vi.mock("../../server/local-auth.mjs", () => ({
  localAuthService: mocks.local,
  isLocalRefreshToken: (token) => token.startsWith("local-"),
}));
vi.mock("../../server/rate-limit.mjs", () => ({ assertWithinRateLimit: mocks.assertWithinRateLimit, clientIp: () => "127.0.0.1" }));
vi.mock("../../server/nutrition.mjs", () => ({
  requestNutritionEstimate: mocks.requestNutritionEstimate,
  nutritionAiConfigured: mocks.nutritionAiConfigured,
}));
import { handleApi } from "../../server/api.mjs";

function request(path, method = "GET", body, headers = {}) {
  const req = Readable.from(body === undefined ? [] : [typeof body === "string" ? body : JSON.stringify(body)]);
  Object.assign(req, { method, headers, socket: { remoteAddress: "127.0.0.1" } });
  const res = {
    writeHead: vi.fn((status, responseHeaders) => {
      res.status = status;
      res.headers = responseHeaders;
    }),
    end: vi.fn((text) => {
      res.body = text ? JSON.parse(text) : null;
    }),
  };
  return { req, res, run: () => handleApi(req, res, new URL(path, "http://localhost")) };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.currentUserFromRequest.mockResolvedValue({ user: { id: "user-a" }, accessToken: "access", provider: "supabase" });
  mocks.isSupabaseConfigured.mockReturnValue(true);
  mocks.nutritionAiConfigured.mockReturnValue(true);
  mocks.validateAuthInput.mockImplementation(({ email, password }) => ({ email, password }));
  mocks.sessionPayload.mockImplementation(({ access_token, user }) => ({ accessToken: access_token, user }));
  mocks.supabaseAccountDeletionAvailable.mockReturnValue(true);
  for (const provider of [mocks, mocks.local]) {
    provider.readAppState.mockResolvedValue({ state: { weight: 80 }, revision: 1 });
    provider.writeAppState.mockResolvedValue({ revision: 2 });
  }
});

describe("API contracts and failure boundaries", () => {
  it("health does not need authentication and readiness reports dependency failure", async () => {
    const health = request("/api/health");
    await health.run();
    expect(health.res.status).toBe(200);
    expect(health.res.body).toMatchObject({ liveness: "ok", supabaseConfigured: true });
    expect(mocks.currentUserFromRequest).not.toHaveBeenCalled();
    for (const ready of [false, true]) {
      mocks.probeSupabaseAuth.mockResolvedValue({ ready });
      const check = request("/api/readiness?force=1");
      await check.run();
      expect(check.res.status).toBe(ready ? 200 : 503);
    }
  });

  it.each(["signup", "login"])("supports local and cloud %s while keeping refresh tokens out of JSON", async (action) => {
    const session = { access_token: "access", refresh_token: "refresh", user: { id: "user-a" } };
    for (const provider of ["local", "supabase"]) {
      mocks.local[action].mockResolvedValue(session);
      mocks.requestSupabase.mockResolvedValue(session);
      const call = request(`/api/auth/${action}`, "POST", { email: "a@example.com", password: "strong-password", provider });
      expect(await call.run()).toBe(true);
      expect(call.res.status).toBe(200);
      expect(call.res.body).toMatchObject({ accessToken: "access", user: { id: "user-a" } });
      expect(call.res.body.refresh_token).toBeUndefined();
      expect(call.res.headers["Set-Cookie"]).toContain("HttpOnly");
    }
  });

  it("supports email-confirmation signup without setting an empty session cookie", async () => {
    mocks.requestSupabase.mockResolvedValue({ user: { id: "user-a" } });
    const call = request("/api/auth/signup", "POST", { email: "a@example.com", password: "strong-password" });
    await call.run();
    expect(call.res.body.needsEmailConfirmation).toBe(true);
    expect(call.res.headers["Set-Cookie"]).toBeUndefined();
  });

  it("rejects malformed JSON and rate-limited logins before authentication", async () => {
    await expect(request("/api/auth/login", "POST", "{broken").run()).rejects.toMatchObject({ status: 400, code: "REQUEST_BODY_INVALID" });
    mocks.assertWithinRateLimit.mockImplementationOnce(() => {
      throw Object.assign(new Error("too many"), { status: 429 });
    });
    await expect(request("/api/auth/login", "POST", {}).run()).rejects.toMatchObject({ status: 429 });
    expect(mocks.requestSupabase).not.toHaveBeenCalled();
    expect(mocks.local.login).not.toHaveBeenCalled();
  });

  it("refresh requires the cookie and ignores a token supplied in the body", async () => {
    const missing = request("/api/auth/refresh", "POST", { refresh_token: "attacker-token" });
    await missing.run();
    expect(missing.res.status).toBe(204);
    expect(mocks.requestSupabase).not.toHaveBeenCalled();
    for (const token of ["local-refresh", "cloud-refresh"]) {
      const session = { access_token: "access", refresh_token: "rotated", user: { id: "user-a" } };
      mocks.local.refresh.mockResolvedValue(session);
      mocks.requestSupabase.mockResolvedValue(session);
      const call = request("/api/auth/refresh", "POST", {}, { cookie: `fat_loss_refresh=${token}` });
      await call.run();
      expect(call.res.headers["Set-Cookie"]).toContain("rotated");
    }
  });

  it.each(["local-refresh", "cloud-refresh"])("clears cookies during logout: %s", async (token) => {
    const call = request("/api/auth/logout", "POST", {}, { cookie: `fat_loss_refresh=${token}` });
    await call.run();
    expect(call.res.body).toEqual({ ok: true });
    expect(call.res.headers["Set-Cookie"]).toContain("Max-Age=0");
  });

  it("refuses private data without authentication before calling storage", async () => {
    mocks.currentUserFromRequest.mockRejectedValue(Object.assign(new Error("login required"), { status: 401 }));
    await expect(request("/api/state").run()).rejects.toMatchObject({ status: 401 });
    expect(mocks.readAppState).not.toHaveBeenCalled();
    expect(mocks.local.readAppState).not.toHaveBeenCalled();
  });

  it.each(["local", "supabase"])("routes state read/write to the authenticated %s account", async (provider) => {
    mocks.currentUserFromRequest.mockResolvedValue({ user: { id: "user-a" }, accessToken: "access", provider });
    const service = provider === "local" ? mocks.local : mocks;
    const read = request("/api/state");
    await read.run();
    expect(read.res.body).toMatchObject({ state: { weight: 80 }, revision: 1 });
    for (const method of ["PUT", "POST"]) {
      const write = request("/api/state", method, { state: { weight: 79 }, revision: 1 });
      await write.run();
      expect(write.res.body.revision).toBe(2);
    }
    expect(service.writeAppState.mock.calls[0][0]).toMatchObject({ revision: 1 });
    expect(service.writeAppState.mock.calls[0].at(-1)).toBe("user-a");
  });

  it("propagates storage conflicts with their conflict payload", async () => {
    mocks.writeAppState.mockRejectedValue(
      Object.assign(new Error("conflict"), { status: 409, code: "STATE_CONFLICT", conflict: { revision: 3 } }),
    );
    await expect(request("/api/state", "PUT", { revision: 1 }).run()).rejects.toMatchObject({ status: 409, conflict: { revision: 3 } });
    const unsupported = request("/api/state", "DELETE");
    await unsupported.run();
    expect(unsupported.res.status).toBe(405);
    expect(unsupported.res.headers.Allow).toBe("GET, PUT, POST");
  });

  it("does not delete account or health data when cloud admin deletion is unavailable", async () => {
    mocks.supabaseAccountDeletionAvailable.mockReturnValue(false);
    await expect(request("/api/auth/account", "DELETE").run()).rejects.toMatchObject({ status: 503, code: "ACCOUNT_DELETION_UNAVAILABLE" });
    expect(mocks.deleteSupabaseAccount).not.toHaveBeenCalled();
    expect(mocks.writeAppState).not.toHaveBeenCalled();
  });

  it.each(["local", "supabase"])("deletes only the authenticated %s account and clears its cookie", async (provider) => {
    mocks.currentUserFromRequest.mockResolvedValue({ user: { id: "user-a" }, provider });
    const call = request("/api/auth/account", "DELETE");
    await call.run();
    expect(provider === "local" ? mocks.local.deleteAccount : mocks.deleteSupabaseAccount).toHaveBeenCalledWith("user-a");
    expect(call.res.headers["Set-Cookie"]).toContain("Max-Age=0");
  });

  it("applies user-specific minute and daily AI quotas and preserves structured provider errors", async () => {
    mocks.requestNutritionEstimate.mockResolvedValue({ calories: 500, source: "model" });
    const call = request("/api/ai/nutrition", "POST", { foodText: "米饭", context: { oilGrams: 5 } });
    await call.run();
    expect(mocks.assertWithinRateLimit).toHaveBeenCalledWith("ai-nutrition:user-a", expect.objectContaining({ limit: 20 }));
    expect(mocks.assertWithinRateLimit).toHaveBeenCalledWith("ai-nutrition-day:user-a", expect.objectContaining({ limit: 200 }));
    expect(call.res.body.calories).toBe(500);
    mocks.requestNutritionEstimate.mockRejectedValue(
      Object.assign(new Error("timeout"), { code: "AI_TIMEOUT", status: 504, requestId: "test-id" }),
    );
    await expect(request("/api/ai/nutrition", "POST", { foodText: "米饭" }).run()).rejects.toMatchObject({
      code: "AI_TIMEOUT",
      status: 504,
      requestId: "test-id",
    });
  });

  it("returns the current user and leaves unknown routes to the server's 404 handler", async () => {
    const user = request("/api/auth/user");
    await user.run();
    expect(user.res.body).toEqual({ user: { id: "user-a" } });
    expect(await request("/api/not-found").run()).toBe(false);
  });
});
