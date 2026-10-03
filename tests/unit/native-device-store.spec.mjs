import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ connections: new Set(), opened: false, payload: null, consistencyError: null }));

// Keep the real JS connection registry; only simulate the Android plugin boundary.
vi.mock("@capacitor-community/sqlite", async (importOriginal) => ({
  ...(await importOriginal()),
  CapacitorSQLite: {
    async checkConnectionsConsistency({ dbNames }) {
      if (native.consistencyError) throw native.consistencyError;
      if (!dbNames.length) {
        native.connections.clear();
        native.opened = false;
        return { result: false };
      }
      return { result: dbNames.every((name) => native.connections.has(name)) };
    },
    async createConnection({ database }) {
      if (native.connections.has(database)) throw new Error(`Connection ${database} already exists`);
      native.connections.add(database);
    },
    async isDBOpen() {
      return { result: native.opened };
    },
    async open() {
      if (native.opened) throw new Error("Database already opened");
      native.opened = true;
    },
    async execute() {},
    async query() {
      return { values: native.payload ? [{ payload: native.payload }] : [] };
    },
    async run({ values }) {
      native.payload = values[0];
      return { changes: { changes: 1 } };
    },
  },
}));

beforeEach(() => {
  vi.resetModules();
  native.connections.clear();
  native.opened = false;
  native.payload = null;
  native.consistencyError = null;
});

describe("手机数据库重载恢复", () => {
  it("WebView 重载后恢复已有原生连接，保留已保存的记录", async () => {
    const firstPage = await import("../../src/native/device-store.js");
    expect(await firstPage.openDeviceStore()).toBeNull();
    const payload = { schemaVersion: 3, setupCompleted: true, weight: 79.8 };
    await firstPage.saveDevicePayload(payload);
    vi.resetModules();
    const reloadedPage = await import("../../src/native/device-store.js");
    expect(await reloadedPage.openDeviceStore()).toEqual(payload);
    expect(reloadedPage.latestDevicePayload()).toEqual(payload);
    expect(native.connections.size).toBe(1);
  });

  it("同一页面重复打开时复用连接，不重复打开数据库", async () => {
    const store = await import("../../src/native/device-store.js");
    await store.openDeviceStore();
    await store.saveDevicePayload({ weight: 80 });
    expect(await store.openDeviceStore()).toEqual({ weight: 80 });
    expect(native.connections.size).toBe(1);
  });

  it("连接检查失败时保留原记录并报告错误", async () => {
    native.payload = JSON.stringify({ weight: 80 });
    native.consistencyError = new Error("native connection unavailable");
    const store = await import("../../src/native/device-store.js");
    await expect(store.openDeviceStore()).rejects.toThrow("native connection unavailable");
    expect(JSON.parse(native.payload)).toEqual({ weight: 80 });
  });
});
