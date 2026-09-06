import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTH_USER_KEY,
  AUTH_VERIFIED_KEY,
  LEGACY_STORAGE_KEY,
  OFFLINE_ACCESS_TRUST_KEY,
  STORAGE_KEY,
  runtime,
  state,
} from "../../src/app-state.js";
import {
  clearOfflineAccessTrust,
  clearSession,
  isOfflineAccessTrusted,
  readOfflineStoredPayload,
  setOfflineAccessTrusted,
  storeSession,
  writeStoredPayload,
} from "../../src/app-storage.js";
import {
  isTrustedOfflineSession,
  loadServerState,
  loadTrustedOfflineState,
  persistedPayload,
  refreshSession,
  resetAppData,
  saveStoredState,
  syncStateNow,
} from "../../src/app-sync.js";
import { deleteAccount, logout } from "../../src/actions/auth.js";

vi.mock("../../src/actions/services.js", () => ({
  render: vi.fn(),
  showToast: vi.fn(),
  activateTab: vi.fn(),
  tabFromLocation: () => "home",
  runExclusiveAction: (_name, action) => action(),
  clearInlineFieldError: vi.fn(),
}));

let values;
const session = (id = "user-a", provider = "supabase") => ({
  accessToken: `access-${id}`,
  provider,
  user: { id, email: `${id}@example.test` },
});
const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function cacheTrustedAccount() {
  storeSession(session());
  state.setupCompleted = true;
  state.weight = 83;
  const payload = { ...persistedPayload(), revision: 3, localUpdatedAt: "2026-09-01T00:00:00.000Z", dirtyBaseRevision: null };
  writeStoredPayload(payload);
  expect(setOfflineAccessTrusted(true)).toBe(true);
  return payload;
}

async function goOffline() {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
  expect(await refreshSession({ detailed: true })).toMatchObject({ status: "offline-unverified", reason: "network" });
}

beforeEach(() => {
  values = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key) => values.get(String(key)) ?? null,
    setItem: (key, value) => values.set(String(key), String(value)),
    removeItem: (key) => values.delete(String(key)),
  });
  vi.stubGlobal("document", { querySelectorAll: () => [] });
  vi.stubGlobal("navigator", { onLine: true });
  Object.assign(runtime, {
    accessToken: "",
    authUserId: "",
    authProvider: "supabase",
    authSessionStatus: "anonymous",
    authSessionGeneration: 0,
    offlineSessionActive: false,
    offlineSyncReadRequired: false,
    offlineSessionReason: "",
    syncPromise: null,
  });
  resetAppData({ blank: true });
  state.appLoading = false;
  state.authRequired = true;
});

afterEach(() => {
  for (const key of ["saveTimer", "inputSaveTimer", "retryTimer"]) clearTimeout(runtime[key]);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("explicit device-local offline trust", () => {
  it("defaults off even after a verified login and cannot be enabled by cached user metadata", () => {
    runtime.authUserId = "user-a";
    values.set(AUTH_USER_KEY, "user-a");
    expect(setOfflineAccessTrusted(true)).toBe(false);
    storeSession(session());
    expect(isOfflineAccessTrusted()).toBe(false);
    expect(values.has(`${AUTH_VERIFIED_KEY}:user-a`)).toBe(true);
    expect(setOfflineAccessTrusted(true)).toBe(true);
    expect(isOfflineAccessTrusted()).toBe(true);
  });

  it("requires both matching verification and explicit trust, including provider", () => {
    cacheTrustedAccount();
    const trustKey = `${OFFLINE_ACCESS_TRUST_KEY}:user-a`;
    const verifiedKey = `${AUTH_VERIFIED_KEY}:user-a`;
    const trust = values.get(trustKey);
    const verification = values.get(verifiedKey);
    values.delete(verifiedKey);
    expect(isOfflineAccessTrusted()).toBe(false);
    values.set(verifiedKey, verification);
    values.set(trustKey, JSON.stringify({ ...JSON.parse(trust), userId: "user-b" }));
    expect(isOfflineAccessTrusted()).toBe(false);
    values.set(trustKey, trust);
    runtime.authProvider = "local";
    expect(isOfflineAccessTrusted()).toBe(false);
    expect(setOfflineAccessTrusted(true, "user-b")).toBe(false);
  });

  it("keeps device trust out of exported/synced health data and separate for each account", () => {
    cacheTrustedAccount();
    expect(JSON.stringify(persistedPayload())).not.toContain("trustedOfflineAccess");
    storeSession(session("user-b"));
    expect(isOfflineAccessTrusted()).toBe(false);
    expect(isOfflineAccessTrusted("user-a")).toBe(false);
    expect(setOfflineAccessTrusted(true)).toBe(true);
    expect(clearOfflineAccessTrust("user-a")).toBe(true);
    expect(isOfflineAccessTrusted()).toBe(true);
  });

  it("opens only trusted cached records after a temporary network failure", async () => {
    cacheTrustedAccount();
    resetAppData({ blank: true });
    await goOffline();
    expect(loadTrustedOfflineState()).not.toBe(null);
    expect(state.weight).toBe(83);
    expect(state.authRequired).toBe(false);
    expect(state.backendStatus).toBe("offline");
    expect(state.syncError).toContain("验证账号后再同步");
    expect(isTrustedOfflineSession()).toBe(true);
    state.weight = 82;
    expect(saveStoredState()).toBe(true);
    expect(runtime.saveTimer).toBe(undefined);
    expect(JSON.parse(values.get(`${STORAGE_KEY}:user-a`)).state.weight).toBe(82);
    expect(await loadServerState()).toBe(false);
    expect(state.authRequired).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("cannot enable trust while offline, but can revoke it", async () => {
    cacheTrustedAccount();
    await goOffline();
    expect(setOfflineAccessTrusted(true)).toBe(false);
    expect(setOfflineAccessTrusted(false)).toBe(true);
    expect(loadTrustedOfflineState()).toBe(null);
  });

  it.each([500, 503, 408, 429])("allows trusted fallback on temporary HTTP %i without revoking trust", async (status) => {
    cacheTrustedAccount();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, status)));
    expect(await refreshSession({ detailed: true })).toMatchObject({ status: "offline-unverified", retryable: true, reason: "server" });
    expect(isOfflineAccessTrusted()).toBe(true);
    expect(loadTrustedOfflineState()).not.toBe(null);
  });

  it.each([204, 401, 403])("revokes trust on authoritative HTTP %i and refuses cached access", async (status) => {
    cacheTrustedAccount();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status })));
    expect(await refreshSession({ detailed: true })).toMatchObject({ status: "anonymous", retryable: false });
    expect(runtime.authUserId).toBe("");
    expect(values.has(`${OFFLINE_ACCESS_TRUST_KEY}:user-a`)).toBe(false);
    expect(values.has(`${AUTH_VERIFIED_KEY}:user-a`)).toBe(false);
    expect(loadTrustedOfflineState()).toBe(null);
    expect(values.has(`${STORAGE_KEY}:user-a`)).toBe(true);
  });

  it.each([{}, { accessToken: "token" }, { user: { id: "user-a" } }])("rejects an invalid success response %j", async (body) => {
    cacheTrustedAccount();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(body)));
    expect(await refreshSession({ detailed: true })).toMatchObject({ status: "anonymous", reason: "invalid-response" });
    expect(loadTrustedOfflineState()).toBe(null);
  });

  it("does not open data without cache or when trust was never enabled", async () => {
    cacheTrustedAccount();
    values.delete(`${STORAGE_KEY}:user-a`);
    await goOffline();
    expect(loadTrustedOfflineState()).toBe(null);
    expect(state.authRequired).toBe(true);
    expect(runtime.offlineSessionActive).toBe(false);
    storeSession(session());
    setOfflineAccessTrusted(false);
    writeStoredPayload({ ...persistedPayload(), revision: 1 });
    await goOffline();
    expect(loadTrustedOfflineState()).toBe(null);
  });

  it.each(["{bad-json", "{}", '{"state":"broken","meals":[]}', '{"state":{},"revision":-1}', '{"state":{"dailyRecords":[]}}'])(
    "rejects corrupted cache %s without destroying it or using stale legacy data",
    async (raw) => {
      const payload = cacheTrustedAccount();
      values.set(`${LEGACY_STORAGE_KEY}:user-a`, JSON.stringify(payload));
      values.set(`${STORAGE_KEY}:user-a`, raw);
      await goOffline();
      expect(loadTrustedOfflineState()).toBe(null);
      expect(values.get(`${STORAGE_KEY}:user-a`)).toBe(raw);
    },
  );

  it("supports a valid per-account legacy cache and fails closed when storage is blocked", () => {
    const payload = cacheTrustedAccount();
    values.delete(`${STORAGE_KEY}:user-a`);
    values.set(`${LEGACY_STORAGE_KEY}:user-a`, JSON.stringify(payload));
    expect(readOfflineStoredPayload()).toMatchObject({ state: { weight: 83 }, revision: 3 });
    localStorage.getItem = () => {
      throw new DOMException("blocked", "SecurityError");
    };
    expect(readOfflineStoredPayload()).toBe(null);
  });
});

describe("offline reconnect and session teardown", () => {
  it.each([200, 409])("ignores a delayed PUT response (%s) after another account signs in", async (status) => {
    cacheTrustedAccount();
    state.weight = 82;
    saveStoredState();
    clearTimeout(runtime.saveTimer);
    let resolveWrite;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise((resolve) => {
            resolveWrite = resolve;
          }),
      ),
    );
    const syncing = syncStateNow();
    clearSession();
    storeSession(session("user-b"));
    resetAppData({ blank: true });
    state.weight = 65;
    state.authRequired = false;
    resolveWrite(
      jsonResponse(
        { state: { weight: 82 }, revision: 4, updatedAt: "2026-09-06T00:00:00.000Z", conflict: { state: { weight: 82 } } },
        status,
      ),
    );
    expect(await syncing).toBe(false);
    expect(state.weight).toBe(65);
    expect(runtime.authUserId).toBe("user-b");
    expect(values.has(`${STORAGE_KEY}:user-b`)).toBe(false);
  });

  it("keeps edits local until the reconnect GET finishes and merges edits made during that GET", async () => {
    const remotePayload = cacheTrustedAccount();
    await goOffline();
    loadTrustedOfflineState();
    let resolveRead;
    const pendingRead = new Promise((resolve) => {
      resolveRead = resolve;
    });
    const writes = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init = {}) => {
        if (url === "/api/auth/refresh") return jsonResponse(session());
        if (init.method === "PUT") {
          writes.push(JSON.parse(init.body));
          return jsonResponse({ revision: 4, updatedAt: "2026-09-06T00:00:00.000Z" });
        }
        return pendingRead;
      }),
    );
    expect(await refreshSession()).toBe(true);
    const loading = loadServerState();
    state.weight = 81;
    saveStoredState();
    expect(runtime.saveTimer).toBeUndefined();
    await syncStateNow();
    expect(writes).toEqual([]);
    resolveRead(jsonResponse({ ...remotePayload, updatedAt: remotePayload.localUpdatedAt }));
    expect(await loading).toBe(true);
    expect(runtime.offlineSyncReadRequired).toBe(false);
    expect(state.weight).toBe(81);
    await syncStateNow();
    expect(writes).toHaveLength(1);
    expect(writes[0].state.weight).toBe(81);
  });

  it("revalidates the same account before loading server data and syncing offline edits", async () => {
    const remotePayload = cacheTrustedAccount();
    await goOffline();
    loadTrustedOfflineState();
    state.weight = 82;
    saveStoredState();
    const calls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init = {}) => {
        calls.push(`${init.method || "GET"} ${url}`);
        if (url === "/api/auth/refresh") return jsonResponse(session());
        expect(init.headers.Authorization).toBe("Bearer access-user-a");
        if (init.method === "PUT") {
          expect(JSON.parse(init.body).state.weight).toBe(82);
          return jsonResponse({ revision: 4, updatedAt: "2026-09-06T00:00:00.000Z" });
        }
        return jsonResponse({ ...remotePayload, updatedAt: remotePayload.localUpdatedAt });
      }),
    );
    expect(await refreshSession()).toBe(true);
    expect(await loadServerState()).toBe(true);
    clearTimeout(runtime.retryTimer);
    expect(await syncStateNow()).toBe(true);
    expect(calls).toEqual(["POST /api/auth/refresh", "GET /api/state", "PUT /api/state"]);
    expect(runtime.offlineSessionActive).toBe(false);
    expect(state.syncPending).toBe(false);
    expect(state.weight).toBe(82);
  });

  it.each([session("user-b"), session("user-a", "local")])(
    "refuses a refreshed different account/provider without uploading old data",
    async (other) => {
      cacheTrustedAccount();
      await goOffline();
      loadTrustedOfflineState();
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(other)));
      expect(await refreshSession({ detailed: true })).toMatchObject({ status: "anonymous", reason: "account-changed" });
      expect(runtime.accessToken).toBe("");
      expect(runtime.authUserId).toBe("");
      expect(loadTrustedOfflineState()).toBe(null);
      expect(values.has(`${OFFLINE_ACCESS_TRUST_KEY}:user-a`)).toBe(false);
      expect(values.has(`${STORAGE_KEY}:user-b`)).toBe(false);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it("does not restore a session when a refresh arrives after local logout", async () => {
    cacheTrustedAccount();
    let release;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      ),
    );
    const pending = refreshSession({ detailed: true });
    clearSession();
    release(jsonResponse(session()));
    expect(await pending).toMatchObject({ status: "anonymous", reason: "stale-session" });
    expect(runtime.authUserId).toBe("");
    expect(isOfflineAccessTrusted()).toBe(false);
  });

  it("revokes local trust immediately during logout even before the network request completes", async () => {
    cacheTrustedAccount();
    let release;
    vi.stubGlobal(
      "fetch",
      vi.fn((url) =>
        url === "/api/auth/logout"
          ? new Promise((resolve) => {
              release = resolve;
            })
          : Promise.resolve(jsonResponse({})),
      ),
    );
    const pending = logout();
    expect(runtime.authUserId).toBe("");
    expect(state.authRequired).toBe(true);
    expect(values.has(`${OFFLINE_ACCESS_TRUST_KEY}:user-a`)).toBe(false);
    release(new Response(null, { status: 204 }));
    expect(await pending).toBe(true);
  });

  it("removes account cache and offline trust after successful account deletion", async () => {
    cacheTrustedAccount();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => jsonResponse({ ok: true })),
    );
    expect(await deleteAccount()).toBe(true);
    expect(runtime.authUserId).toBe("");
    expect(values.has(`${STORAGE_KEY}:user-a`)).toBe(false);
    expect(values.has(`${OFFLINE_ACCESS_TRUST_KEY}:user-a`)).toBe(false);
    expect(values.has(`${AUTH_VERIFIED_KEY}:user-a`)).toBe(false);
  });
});
