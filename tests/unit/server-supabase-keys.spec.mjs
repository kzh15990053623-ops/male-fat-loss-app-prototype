import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const config = vi.hoisted(() => ({
  supabaseUrl: "https://project.test",
  supabaseAnonKey: "sb_publishable_test_key_for_authentication",
  supabaseServiceRoleKey: "sb_secret_test_key_for_server_requests",
  supabaseProbeTimeoutMs: 1000,
  supabaseReadinessTtlMs: 5000,
  supabaseRequestTimeoutMs: 1000,
  localAuthEnabled: false,
  localAuthDataPath: "unused-test-path",
}));
vi.mock("../../server/config.mjs", () => config);

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

// New API keys identify the app via apikey. Only user JWTs belong in Bearer.
function providerResponse(body, init) {
  const headers = new Headers(init.headers);
  if (/^Bearer sb_(publishable|secret)_/.test(headers.get("Authorization") || "")) {
    return jsonResponse({ message: "Invalid JWT" }, 401);
  }
  return jsonResponse(body);
}

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Supabase opaque API key compatibility", () => {
  it("connects readiness and password login with a publishable key", async () => {
    const service = await import("../../server/supabase.mjs");
    fetch.mockImplementationOnce(async (_url, init) => providerResponse({ disable_signup: false }, init));
    await expect(service.probeSupabaseAuth({ force: true })).resolves.toMatchObject({ ready: true, code: "AUTH_READY" });

    fetch.mockImplementationOnce(async (_url, init) => providerResponse({ access_token: "user-jwt" }, init));
    await expect(
      service.requestSupabase("/auth/v1/token?grant_type=password", {
        method: "POST",
        body: { email: "owner@example.test", password: "test-only-password" },
      }),
    ).resolves.toMatchObject({ access_token: "user-jwt" });
    for (const [, init] of fetch.mock.calls) {
      const headers = new Headers(init.headers);
      expect(headers.get("apikey")).toBe(config.supabaseAnonKey);
      expect(headers.has("Authorization")).toBe(false);
    }
  });

  it("keeps the user JWT when reading account data with a publishable key", async () => {
    const service = await import("../../server/supabase.mjs");
    fetch.mockImplementationOnce(async (_url, init) => providerResponse({ id: "owner" }, init));
    await expect(service.requestSupabase("/auth/v1/user", { accessToken: "signed-user-jwt" })).resolves.toEqual({ id: "owner" });
    expect(new Headers(fetch.mock.calls[0][1].headers).get("Authorization")).toBe("Bearer signed-user-jwt");
    expect(new Headers(fetch.mock.calls[0][1].headers).get("apikey")).toBe(config.supabaseAnonKey);
  });

  it("uses the server secret key through apikey for admin requests", async () => {
    const service = await import("../../server/supabase.mjs");
    fetch.mockImplementationOnce(async (_url, init) => providerResponse({}, init));
    await expect(service.deleteSupabaseAccount("test-only-owner")).resolves.toBeUndefined();
    const headers = new Headers(fetch.mock.calls[0][1].headers);
    expect(headers.get("apikey")).toBe(config.supabaseServiceRoleKey);
    expect(headers.has("Authorization")).toBe(false);
  });

  it("preserves JWT-based legacy API key authentication", async () => {
    const service = await import("../../server/supabase.mjs");
    const legacyKey = "eyJhbGciOiJIUzI1NiJ9.test-legacy-anon.signature";
    const fetchImpl = vi.fn(async () => jsonResponse({ disable_signup: false }));
    await expect(service.probeSupabaseAuth({ force: true, anonKey: legacyKey, fetchImpl })).resolves.toMatchObject({ ready: true });
    expect(new Headers(fetchImpl.mock.calls[0][1].headers).get("Authorization")).toBe(`Bearer ${legacyKey}`);
  });
});
