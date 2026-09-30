import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { etagForContent, serveStaticRequest } from "../../server/static.mjs";
import { closeHttpServer, startFetchSafeHttpServer } from "../../scripts/test-http-server.mjs";

let origin;
let server;

beforeAll(async () => {
  const started = await startFetchSafeHttpServer(() =>
    createServer((request, response) => {
      const url = new URL(request.url || "/", "http://localhost");
      serveStaticRequest(request, response, url).catch((error) => {
        response.destroy(error);
      });
    }),
  );
  server = started.server;
  origin = started.origin;
});

afterAll(async () => {
  await closeHttpServer(server);
});

const assetUrl = () => `${origin}/src/app-render.js`;

describe("静态资源 Accept-Encoding 协商", () => {
  it("遵守 q 值并在同权重时优先 Brotli、gzip、identity", async () => {
    const gzip = await fetch(assetUrl(), {
      headers: { "Accept-Encoding": "br;q=0, gzip;q=1, identity;q=0.5" },
    });
    expect(gzip.status).toBe(200);
    expect(gzip.headers.get("content-encoding")).toBe("gzip");
    await gzip.arrayBuffer();

    const brotli = await fetch(assetUrl(), {
      headers: { "Accept-Encoding": "identity;q=1, gzip;q=1, br;q=1" },
    });
    expect(brotli.headers.get("content-encoding")).toBe("br");
    await brotli.arrayBuffer();

    const identity = await fetch(assetUrl(), {
      headers: { "Accept-Encoding": "br;q=0.4, gzip;q=0.5, identity;q=0.9" },
    });
    expect(identity.headers.get("content-encoding")).toBe(null);
    expect(identity.headers.get("vary")).toContain("Accept-Encoding");
    await identity.arrayBuffer();
  });

  it("用通配符补足未显式列出的编码，显式条目仍优先", async () => {
    const response = await fetch(assetUrl(), {
      headers: { "Accept-Encoding": "br;q=0, identity;q=0, *;q=0.8" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-encoding")).toBe("gzip");
    await response.arrayBuffer();
  });

  it("所有可用表示均被拒绝时返回 406", async () => {
    const response = await fetch(assetUrl(), {
      headers: { "Accept-Encoding": "br;q=0, gzip;q=0, identity;q=0, *;q=0" },
    });
    expect(response.status).toBe(406);
    expect(response.headers.get("vary")).toContain("Accept-Encoding");
    expect(await response.text()).toContain("No acceptable content encoding");
  });

  it("小型文本在 identity 被拒绝时使用可接受编码", async () => {
    const response = await fetch(`${origin}/manifest.webmanifest`, {
      headers: { "Accept-Encoding": "identity;q=0, gzip;q=1, br;q=0" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-encoding")).toBe("gzip");
    expect(response.headers.get("vary")).toContain("Accept-Encoding");
    await response.arrayBuffer();
  });

  it("不可编码资源在 identity 被拒绝时返回 406", async () => {
    const response = await fetch(`${origin}/src/app-icon-192.png`, {
      headers: { "Accept-Encoding": "identity;q=0, gzip;q=1" },
    });
    expect(response.status).toBe(406);
    expect(response.headers.get("content-encoding")).toBe(null);
    expect(response.headers.get("vary")).toContain("Accept-Encoding");

    const identity = await fetch(`${origin}/src/app-icon-192.png`, {
      headers: { "Accept-Encoding": "identity" },
    });
    expect(identity.status).toBe(200);
    expect(identity.headers.get("vary")).toContain("Accept-Encoding");
    await identity.arrayBuffer();
  });
});

describe("静态资源表示特定缓存验证", () => {
  it("同尺寸内容变化也会生成不同 ETag", () => {
    expect(etagForContent(Buffer.from("alpha"), null)).not.toBe(etagForContent(Buffer.from("bravo"), null));
    expect(etagForContent(Buffer.from("alpha"), "br")).not.toBe(etagForContent(Buffer.from("alpha"), "gzip"));
  });

  it("其他编码的 ETag 不会误命中当前表示", async () => {
    const brotli = await fetch(assetUrl(), { headers: { "Accept-Encoding": "br" } });
    const brotliEtag = brotli.headers.get("etag");
    await brotli.arrayBuffer();

    const gzip = await fetch(assetUrl(), {
      headers: { "Accept-Encoding": "gzip", "If-None-Match": brotliEtag },
    });
    expect(gzip.status).toBe(200);
    expect(gzip.headers.get("content-encoding")).toBe("gzip");
    expect(gzip.headers.get("etag")).not.toBe(brotliEtag);
    expect(gzip.headers.get("vary")).toContain("Accept-Encoding");
    await gzip.arrayBuffer();
  });

  it("当前编码的 304 与 identity 的 200/304 都携带 Vary", async () => {
    const brotli = await fetch(assetUrl(), { headers: { "Accept-Encoding": "br" } });
    const brotliEtag = brotli.headers.get("etag");
    await brotli.arrayBuffer();
    const brotliCached = await fetch(assetUrl(), {
      headers: { "Accept-Encoding": "br", "If-None-Match": brotliEtag },
    });
    expect(brotliCached.status).toBe(304);
    expect(brotliCached.headers.get("etag")).toBe(brotliEtag);
    expect(brotliCached.headers.get("vary")).toContain("Accept-Encoding");

    const identity = await fetch(assetUrl(), { headers: { "Accept-Encoding": "identity" } });
    const identityEtag = identity.headers.get("etag");
    expect(identity.status).toBe(200);
    expect(identity.headers.get("content-encoding")).toBe(null);
    expect(identity.headers.get("vary")).toContain("Accept-Encoding");
    await identity.arrayBuffer();
    const identityCached = await fetch(assetUrl(), {
      headers: { "Accept-Encoding": "identity", "If-None-Match": identityEtag },
    });
    expect(identityCached.status).toBe(304);
    expect(identityCached.headers.get("etag")).toBe(identityEtag);
    expect(identityCached.headers.get("vary")).toContain("Accept-Encoding");
  });

  it("If-None-Match 列表按 GET 弱比较匹配当前表示", async () => {
    const response = await fetch(assetUrl(), { headers: { "Accept-Encoding": "gzip" } });
    const etag = response.headers.get("etag");
    await response.arrayBuffer();
    const cached = await fetch(assetUrl(), {
      headers: { "Accept-Encoding": "gzip", "If-None-Match": `"unrelated", ${etag.replace(/^W\//, "")}` },
    });
    expect(cached.status).toBe(304);
    expect(cached.headers.get("etag")).toBe(etag);
  });
});
