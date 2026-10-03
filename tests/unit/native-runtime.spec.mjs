import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch, validateCloudOrigin } from "../../src/native-runtime.js";

afterEach(() => vi.unstubAllGlobals());

describe("原生云请求", () => {
  it("只接受独立 HTTPS 根地址，拒绝路径、凭证和本机服务", () => {
    expect(validateCloudOrigin("https://cloud.example.test/")).toBe("https://cloud.example.test");
    for (const url of [
      "http://cloud.example.test",
      "https://localhost",
      "https://u:p@cloud.example.test",
      "https://cloud.example.test/api",
      "https://cloud.example.test/?key=secret",
    ]) {
      expect(() => validateCloudOrigin(url)).toThrow();
    }
  });

  it("使用原生 HTTP、禁止跳转，隐藏刷新 Cookie 响应头", async () => {
    const request = vi.fn(async () => ({ status: 200, data: { ok: true }, headers: { "Set-Cookie": "secret-refresh-token" } }));
    vi.stubGlobal("__WENJIAN_NATIVE__", { apiOrigin: "https://cloud.example.test", Http: { request } });
    const response = await apiFetch("/api/state", {
      method: "PUT",
      body: '{"revision":2}',
      headers: { Authorization: "Bearer test-access" },
    });
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.has("set-cookie")).toBe(false);
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://cloud.example.test/api/state",
        method: "PUT",
        data: { revision: 2 },
        disableRedirects: true,
      }),
    );
    await expect(apiFetch("https://other.example.test/api/state")).rejects.toThrow();
    await expect(apiFetch("/api/../../private")).rejects.toThrow();
  });

  it("取消会立即结束等待，迟到的原生响应不能应用", async () => {
    let finish;
    const request = vi.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    vi.stubGlobal("__WENJIAN_NATIVE__", { apiOrigin: "https://cloud.example.test", Http: { request } });
    const controller = new AbortController();
    const response = apiFetch("/api/ai/nutrition", { signal: controller.signal });
    controller.abort();
    await expect(response).rejects.toMatchObject({ name: "AbortError" });
    finish({ status: 200, data: { calories: 300 } });
  });
});
