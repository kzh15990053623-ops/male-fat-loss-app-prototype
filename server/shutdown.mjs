export const SHUTDOWN_TIMEOUT_MS = 55_000;

function log(logger, method, ...args) {
  if (typeof logger?.[method] === "function") logger[method](...args);
}

export function registerGracefulShutdown({
  server,
  processRef = process,
  timer = globalThis,
  timeoutMs = SHUTDOWN_TIMEOUT_MS,
  forceExit = (code) => processRef.exit(code),
  logger = console,
} = {}) {
  if (!server || typeof server.close !== "function") throw new TypeError("server.close is required");

  let shutdownStarted = false;
  let settled = false;
  let forceTimer = null;

  function clearForceTimer() {
    if (forceTimer === null) return;
    timer.clearTimeout(forceTimer);
    forceTimer = null;
  }

  function complete(code, force = false) {
    if (settled) return false;
    settled = true;
    clearForceTimer();
    processRef.exitCode = code;
    if (force) forceExit(code);
    return true;
  }

  function shutdown(signal) {
    if (shutdownStarted) return;
    shutdownStarted = true;
    log(logger, "info", `收到 ${signal}，开始优雅关闭`);

    forceTimer = timer.setTimeout(() => {
      if (settled) return;
      log(logger, "error", `优雅关闭超过 ${timeoutMs}ms，强制关闭剩余连接`);
      server.closeAllConnections?.();
      complete(1, true);
    }, timeoutMs);
    forceTimer?.unref?.();

    const finishClose = (error) => {
      if (settled) return;
      if (error) {
        log(logger, "error", "服务器关闭失败，强制结束进程", error);
        server.closeAllConnections?.();
        complete(1, true);
        return;
      }
      log(logger, "info", "服务器已正常关闭");
      complete(0);
    };

    try {
      // close() immediately stops accepting new requests and waits for active
      // requests; idle keep-alive connections can be released separately.
      server.close(finishClose);
      server.closeIdleConnections?.();
    } catch (error) {
      finishClose(error);
    }
  }

  processRef.on("SIGTERM", shutdown);
  processRef.on("SIGINT", shutdown);

  return {
    shutdown,
    isShuttingDown: () => shutdownStarted,
  };
}
