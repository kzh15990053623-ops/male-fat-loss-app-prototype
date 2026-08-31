import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { port } from "./server/config.mjs";
import { handleApi, sendJson, sendJsonWithHeaders } from "./server/api.mjs";
import { applyHstsHeader } from "./server/http.mjs";
import { serveStaticRequest } from "./server/static.mjs";
import { registerGracefulShutdown } from "./server/shutdown.mjs";

export { isRecord, normalizeAppData, sanitizeMeals, sanitizeState } from "./server/data.mjs";

export function startServer(listenPort = port) {
  return createServer(async (request, response) => {
    applyHstsHeader(request, response);
    // Parse inside an error boundary: a malformed request-target (e.g.
    // "GET http://[ HTTP/1.1") must answer 400, never crash the process.
    let url;
    try {
      url = new URL(request.url || "/", "http://localhost:" + listenPort);
    } catch {
      sendJson(response, 400, { error: "请求目标无效", code: "REQUEST_TARGET_INVALID", retryable: false });
      return;
    }
    try {
      if (url.pathname.startsWith("/api/")) {
        const handled = await handleApi(request, response, url);
        if (!handled) sendJson(response, 404, { error: "API route not found" });
        return;
      }
      await serveStaticRequest(request, response, url);
    } catch (error) {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      const status = error.status || 500;
      sendJsonWithHeaders(
        response,
        status,
        {
          error: error.message || "Request failed",
          code: error.code || "REQUEST_FAILED",
          retryable: typeof error.retryable === "boolean" ? error.retryable : status >= 500,
          requestId: error.requestId || null,
          ...(error.retryAfter ? { retryAfter: error.retryAfter } : {}),
          ...(error.conflict ? { conflict: error.conflict } : {}),
        },
        error.headers || {},
      );
      return;
    }
  }).listen(listenPort, () => {
    console.log("Serving at http://localhost:" + listenPort);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = startServer();
  registerGracefulShutdown({ server });
}
