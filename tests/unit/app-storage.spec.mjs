import { beforeEach, describe, expect, it } from "vitest";
import {
  AUTH_EMAIL_KEY,
  AUTH_PROVIDER_KEY,
  AUTH_USER_KEY,
  LEGACY_STORAGE_KEY,
  LEGACY_TOKEN_KEY,
  STORAGE_KEY,
  runtime,
  state,
} from "../../src/app-state.js";
import {
  clearSession,
  parseStoredValue,
  readStoredPayload,
  safeStorageGet,
  safeStorageRemove,
  safeStorageSet,
  storageKeyFor,
  storeSession,
  writeStoredPayload,
} from "../../src/app-storage.js";

let values;

beforeEach(() => {
  values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(String(key)) ?? null,
    setItem: (key, value) => values.set(String(key), String(value)),
    removeItem: (key) => values.delete(String(key)),
  };
  runtime.accessToken = "";
  runtime.authUserId = "storage-user";
  runtime.authProvider = "supabase";
  runtime.loadedLegacyStorageKey = "";
  state.authProvider = "supabase";
  state.syncError = "";
  state.syncErrorKind = "none";
});

describe("app storage", () => {
  it("round-trips revision and explicit timestamps without inventing time", () => {
    const payload = {
      state: { schemaVersion: 3, setupCompleted: true, dailyRecords: {} },
      meals: [],
      localUpdatedAt: "2026-08-30T01:02:03.000Z",
      revision: 7,
    };
    expect(writeStoredPayload(payload)).toEqual({ ok: true });
    const raw = JSON.parse(values.get(STORAGE_KEY + ":storage-user"));
    expect(raw.localUpdatedAt).toBe(payload.localUpdatedAt);
    expect(raw.revision).toBe(7);
    expect(readStoredPayload()).toMatchObject({ localUpdatedAt: payload.localUpdatedAt, revision: 7 });

    expect(writeStoredPayload({ ...payload, localUpdatedAt: undefined })).toEqual({ ok: true });
    expect(JSON.parse(values.get(STORAGE_KEY + ":storage-user")).localUpdatedAt).toBe("");
  });

  it("migrates the legacy user key and removes it after a successful current write", () => {
    const legacyKey = LEGACY_STORAGE_KEY + ":storage-user";
    values.set(
      legacyKey,
      JSON.stringify({ state: { schemaVersion: 2, setupCompleted: true }, meals: [], updatedAt: "2026-08-29T00:00:00.000Z" }),
    );
    expect(readStoredPayload()).toMatchObject({ localUpdatedAt: "2026-08-29T00:00:00.000Z" });
    expect(runtime.loadedLegacyStorageKey).toBe(legacyKey);

    expect(writeStoredPayload({ state: { schemaVersion: 3 }, meals: [], localUpdatedAt: "", revision: 0 })).toEqual({ ok: true });
    expect(values.has(legacyKey)).toBe(false);
    expect(runtime.loadedLegacyStorageKey).toBe("");
  });

  it("removes malformed JSON and records storage failures", () => {
    const key = storageKeyFor();
    values.set(key, "{bad-json");
    expect(parseStoredValue(key)).toBe(null);
    expect(values.has(key)).toBe(false);

    globalThis.localStorage.setItem = () => {
      throw new DOMException("full", "QuotaExceededError");
    };
    expect(safeStorageSet(key, "value").ok).toBe(false);
    expect(state.syncErrorKind).toBe("storage");
    expect(state.syncError).toContain("空间不足");

    globalThis.localStorage.getItem = () => {
      throw new DOMException("blocked", "SecurityError");
    };
    expect(safeStorageGet(key).ok).toBe(false);
    expect(state.syncError).toContain("浏览器阻止");
  });

  it("stores and clears session metadata without retaining legacy tokens", () => {
    values.set(LEGACY_TOKEN_KEY, "legacy");
    storeSession({
      accessToken: "access",
      provider: "local",
      user: { id: "local-user", email: "local@example.com" },
    });
    expect(runtime.authUserId).toBe("local-user");
    expect(runtime.authProvider).toBe("local");
    expect(values.get(AUTH_USER_KEY)).toBe("local-user");
    expect(values.get(AUTH_EMAIL_KEY)).toBe("local@example.com");
    expect(values.get(AUTH_PROVIDER_KEY)).toBe("local");
    expect(values.has(LEGACY_TOKEN_KEY)).toBe(false);

    clearSession();
    expect(runtime.accessToken).toBe("");
    expect(runtime.authUserId).toBe("");
    expect(runtime.authProvider).toBe("supabase");
    expect(values.has(AUTH_USER_KEY)).toBe(false);
    expect(values.has(AUTH_PROVIDER_KEY)).toBe(false);
  });

  it("skips user payload writes when no authenticated user is selected", () => {
    runtime.authUserId = "";
    expect(writeStoredPayload({ state: {}, meals: [], localUpdatedAt: "", revision: 0 })).toEqual({ ok: true, skipped: true });
    expect(safeStorageRemove("missing")).toEqual({ ok: true });
  });
});
