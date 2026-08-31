import { describe, expect, it, vi } from "vitest";
import { registerGracefulShutdown, SHUTDOWN_TIMEOUT_MS } from "../../server/shutdown.mjs";

function createHarness() {
  const callbacks = { close: null, timer: null, signals: {} };
  const server = {
    close: vi.fn((callback) => {
      callbacks.close = callback;
    }),
    closeIdleConnections: vi.fn(),
    closeAllConnections: vi.fn(),
  };
  const processRef = {
    exitCode: undefined,
    exit: vi.fn(),
    on: vi.fn((signal, callback) => {
      callbacks.signals[signal] = callback;
    }),
  };
  const timer = {
    setTimeout: vi.fn((callback, delay) => {
      callbacks.timer = { callback, delay, unref: vi.fn() };
      return callbacks.timer;
    }),
    clearTimeout: vi.fn(),
  };
  const logger = { info: vi.fn(), error: vi.fn() };
  return { callbacks, server, processRef, timer, logger };
}

describe("优雅关闭生命周期", () => {
  it("注册 SIGTERM 和 SIGINT，且使用 55 秒强退窗口", () => {
    const harness = createHarness();
    registerGracefulShutdown({ ...harness, server: harness.server });

    expect(harness.processRef.on).toHaveBeenNthCalledWith(1, "SIGTERM", expect.any(Function));
    expect(harness.processRef.on).toHaveBeenNthCalledWith(2, "SIGINT", expect.any(Function));
    harness.callbacks.signals.SIGTERM();
    expect(harness.timer.setTimeout).toHaveBeenCalledWith(expect.any(Function), SHUTDOWN_TIMEOUT_MS);
  });

  it("重复信号只关闭一次", () => {
    const harness = createHarness();
    registerGracefulShutdown({ ...harness, server: harness.server });

    harness.callbacks.signals.SIGTERM();
    harness.callbacks.signals.SIGINT();
    harness.callbacks.signals.SIGTERM();

    expect(harness.server.close).toHaveBeenCalledTimes(1);
    expect(harness.server.closeIdleConnections).toHaveBeenCalledTimes(1);
    expect(harness.timer.setTimeout).toHaveBeenCalledTimes(1);
  });

  it("正常 close 清理强退 timer 并设置成功退出状态", () => {
    const harness = createHarness();
    registerGracefulShutdown({ ...harness, server: harness.server });

    harness.callbacks.signals.SIGTERM();
    harness.callbacks.close();

    expect(harness.timer.clearTimeout).toHaveBeenCalledWith(harness.callbacks.timer);
    expect(harness.processRef.exitCode).toBe(0);
    expect(harness.processRef.exit).not.toHaveBeenCalled();
  });

  it("超时关闭剩余连接并强制以失败状态退出", () => {
    const harness = createHarness();
    registerGracefulShutdown({ ...harness, server: harness.server });

    harness.callbacks.signals.SIGTERM();
    harness.callbacks.timer.callback();
    harness.callbacks.close();

    expect(harness.server.closeAllConnections).toHaveBeenCalledTimes(1);
    expect(harness.processRef.exit).toHaveBeenCalledWith(1);
    expect(harness.processRef.exit).toHaveBeenCalledTimes(1);
    expect(harness.processRef.exitCode).toBe(1);
  });
});

it("导入 startServer 不会注册全局信号监听器", async () => {
  const before = {
    term: process.listenerCount("SIGTERM"),
    interrupt: process.listenerCount("SIGINT"),
  };
  const { startServer } = await import("../../server.mjs?unit-no-global-shutdown-listener");
  expect(typeof startServer).toBe("function");
  expect(process.listenerCount("SIGTERM")).toBe(before.term);
  expect(process.listenerCount("SIGINT")).toBe(before.interrupt);
});
