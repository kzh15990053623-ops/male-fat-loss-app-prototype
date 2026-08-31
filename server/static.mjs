import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { extname, normalize, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { constants, createBrotliCompress, createGzip } from "node:zlib";
import { root } from "./config.mjs";
import { baseHeaders } from "./http.mjs";

const allowedStaticFiles = new Set(["", "index.html", "manifest.webmanifest", "sw.js"]);
const allowedStaticDirectories = ["src/"];
const blockedStaticSegments = new Set([".agents", ".git", "data", "scripts", "supabase", "test-results", "node_modules"]);
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};
const compressibleExtensions = new Set([".html", ".css", ".js", ".mjs", ".json", ".webmanifest", ".svg"]);
const MIN_COMPRESS_BYTES = 1024;
const BROTLI_QUALITY = 5;

function staticCacheControl(filePath, url) {
  const extension = extname(filePath);
  if (extension === ".html") return "no-store";
  if (url.searchParams.has("v")) return "public, max-age=31536000, immutable";
  if ([".css", ".js", ".mjs", ".json", ".webmanifest"].includes(extension)) return "no-cache";
  return "public, max-age=3600";
}

function etagForContent(content, variant) {
  const digest = createHash("sha256")
    .update(content)
    .update(`\0${variant || "identity"}`)
    .digest("base64url")
    .slice(0, 24);
  return `W/"${digest}"`;
}

function ifNoneMatchIncludes(header, etag) {
  const normalizedEtag = etag.replace(/^W\//i, "");
  return String(header || "")
    .split(",")
    .map((candidate) => candidate.trim())
    .some((candidate) => candidate === "*" || candidate.replace(/^W\//i, "") === normalizedEtag);
}

// Parse Accept-Encoding with q-values. Explicit entries override `*`, while
// identity remains acceptable by default unless `identity;q=0` (or a bare
// `*;q=0`) excludes it. Ties prefer Brotli, then gzip, then identity.
function preferredEncoding(request, availableCodings = ["br", "gzip", "identity"]) {
  const header = String(request.headers["accept-encoding"] || "").trim();
  if (!header) return "identity";

  const qualities = new Map();
  for (const part of header.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const [coding, ...params] = trimmed.split(";");
    const qParam = params.map((param) => param.trim()).find((param) => param.toLowerCase().startsWith("q="));
    const parsedQuality = qParam ? Number(qParam.slice(2)) : 1;
    const quality = Number.isFinite(parsedQuality) && parsedQuality >= 0 && parsedQuality <= 1 ? parsedQuality : 0;
    qualities.set(coding.trim().toLowerCase(), quality);
  }

  const wildcardQuality = qualities.get("*");
  const qualityFor = (coding) => {
    if (qualities.has(coding)) return qualities.get(coding);
    if (coding === "identity") return wildcardQuality === 0 ? 0 : 1;
    return wildcardQuality ?? 0;
  };
  let preferred = null;
  let highestQuality = 0;
  for (const coding of ["br", "gzip", "identity"].filter((coding) => availableCodings.includes(coding))) {
    const quality = qualityFor(coding);
    if (quality > highestQuality) {
      preferred = coding;
      highestQuality = quality;
    }
  }
  return preferred;
}

function normalizedStaticPath(pathname) {
  try {
    return decodeURIComponent(pathname)
      .replace(/^[/\\]+/, "")
      .replace(/\\/g, "/");
  } catch {
    return null;
  }
}

function isAllowedStaticPath(requestPath) {
  if (requestPath === null) return false;
  if (requestPath === "") return true;
  const normalizedPath = normalize(requestPath).replace(/\\/g, "/");
  if (normalizedPath.startsWith("../") || normalizedPath === "..") return false;
  const segments = normalizedPath.split("/").filter(Boolean);
  if (segments.some((segment) => segment.startsWith(".") || blockedStaticSegments.has(segment))) return false;
  return allowedStaticFiles.has(normalizedPath) || allowedStaticDirectories.some((directory) => normalizedPath.startsWith(directory));
}

function notFound(response) {
  response.writeHead(404, baseHeaders({ "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }));
  response.end("Not found");
}

export async function serveStaticRequest(request, response, url) {
  if (!["GET", "HEAD"].includes(request.method || "GET")) {
    response.writeHead(405, baseHeaders({ Allow: "GET, HEAD" }));
    response.end();
    return;
  }

  const requestPath = normalizedStaticPath(url.pathname);
  if (!isAllowedStaticPath(requestPath)) {
    notFound(response);
    return;
  }
  const filePath = resolve(root, requestPath === "" ? "index.html" : requestPath);

  if (!filePath.startsWith(root + sep)) {
    notFound(response);
    return;
  }

  let stats;
  try {
    stats = await stat(filePath);
  } catch {
    notFound(response);
    return;
  }
  if (!stats.isFile()) {
    notFound(response);
    return;
  }

  let content;
  try {
    content = await readFile(filePath);
  } catch {
    notFound(response);
    return;
  }

  const extension = extname(filePath);
  const cacheControl = staticCacheControl(filePath, url);
  const encodingCapable = compressibleExtensions.has(extension);
  const worthCompressing = encodingCapable && content.length >= MIN_COMPRESS_BYTES;
  let useEncoding;
  if (worthCompressing) useEncoding = preferredEncoding(request);
  else if (preferredEncoding(request, ["identity"]) === "identity") useEncoding = "identity";
  else useEncoding = encodingCapable ? preferredEncoding(request, ["br", "gzip"]) : null;
  if (useEncoding === null) {
    response.writeHead(
      406,
      baseHeaders({
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": cacheControl,
        Vary: "Accept-Encoding",
      }),
    );
    if (request.method === "HEAD") response.end();
    else response.end("No acceptable content encoding");
    return;
  }
  const contentEncoding = useEncoding === "identity" ? null : useEncoding;
  const etag = etagForContent(content, contentEncoding);
  const negotiationHeaders = { Vary: "Accept-Encoding" };

  const ifNoneMatch = String(request.headers["if-none-match"] || "");
  if (ifNoneMatchIncludes(ifNoneMatch, etag)) {
    response.writeHead(304, baseHeaders({ "Cache-Control": cacheControl, ETag: etag, ...negotiationHeaders }));
    response.end();
    return;
  }

  response.writeHead(
    200,
    baseHeaders({
      "Content-Type": types[extension] || "application/octet-stream",
      "Cache-Control": cacheControl,
      ETag: etag,
      ...negotiationHeaders,
      ...(contentEncoding ? { "Content-Encoding": contentEncoding } : {}),
    }),
  );
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  // Brotli tuning goes through `params[BROTLI_PARAM_QUALITY]`; a top-level
  // `quality` option is a deflate-family option that Brotli silently ignores
  // (falling back to the quality-11 default, ~30x slower for this payload).
  const stream = Readable.from(content);
  if (contentEncoding === "br")
    stream.pipe(createBrotliCompress({ params: { [constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY } })).pipe(response);
  else if (contentEncoding === "gzip") stream.pipe(createGzip()).pipe(response);
  else stream.pipe(response);
}

export { etagForContent };
