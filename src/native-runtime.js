export function nativeRuntime() {
  return globalThis.__WENJIAN_NATIVE__ || null;
}

export function isNativeApp() {
  return Boolean(nativeRuntime());
}

export function nativeCloudEnabled() {
  return nativeRuntime()?.cloud?.config?.enabled === true;
}

export function aiAvailable() {
  return (
    !isNativeApp() || (nativeCloudEnabled() && Boolean(nativeRuntime()?.cloud?.authenticated) && nativeRuntime()?.cloud?.aiReady !== false)
  );
}

export function validateCloudOrigin(value) {
  const url = new URL(String(value || "").trim());
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    /^(localhost|127\.|\[?::1\]?$)/i.test(url.hostname)
  ) {
    throw new Error("请输入独立部署的 HTTPS 服务地址，不包含路径或登录信息");
  }
  return url.origin;
}

// Android uses its native HTTP stack and HttpOnly cookie jar. Provider secrets
// stay on the server; browser requests retain the existing same-origin behavior.
export async function apiFetch(path, options = {}) {
  const native = nativeRuntime();
  if (!native) return fetch(path, options);
  const origin = validateCloudOrigin(native.cloud?.config?.origin || native.apiOrigin);
  if (typeof path !== "string" || !path.startsWith("/api/") || path.includes("\\")) throw new Error("无效的服务接口");
  const url = new URL(path, origin);
  if (url.origin !== origin || !url.pathname.startsWith("/api/")) throw new Error("无效的服务接口");
  if (options.signal?.aborted) throw new DOMException("请求已取消", "AbortError");
  const request = native.Http.request({
    url: url.href,
    method: options.method || "GET",
    headers: { Accept: "application/json", ...options.headers },
    ...(options.body ? { data: JSON.parse(options.body) } : {}),
    responseType: "json",
    connectTimeout: 15000,
    readTimeout: 55000,
    disableRedirects: true,
  });
  let abort;
  try {
    const result = options.signal
      ? await Promise.race([
          request,
          new Promise((_, reject) => {
            abort = () => reject(new DOMException("请求已取消", "AbortError"));
            options.signal.addEventListener("abort", abort, { once: true });
          }),
        ])
      : await request;
    const headers = Object.fromEntries(Object.entries(result.headers || {}).filter(([key]) => key.toLowerCase() !== "set-cookie"));
    return new Response(result.status === 204 ? null : typeof result.data === "string" ? result.data : JSON.stringify(result.data), {
      status: result.status,
      headers,
    });
  } finally {
    if (abort) options.signal.removeEventListener("abort", abort);
  }
}
