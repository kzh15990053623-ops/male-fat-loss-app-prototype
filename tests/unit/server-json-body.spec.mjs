import { describe, expect, it } from "vitest";
import { Readable } from "node:stream";
import { readJsonBody } from "../../server/api.mjs";

function requestFromChunks(chunks) {
  const request = new Readable({ read() {} });
  chunks.forEach((chunk) => request.push(chunk));
  request.push(null);
  return request;
}

describe("readJsonBody 分块解码与字节上限", () => {
  it("UTF-8 多字节字符跨分块边界时不被拆坏", async () => {
    const payload = Buffer.from(JSON.stringify({ foodText: "鸡胸肉沙拉" }), "utf8");
    // 在“鸡”（3 字节）的中间切一刀：按块解码的实现会把首尾两个残缺字节替换成 U+FFFD
    const splitAt = payload.indexOf(Buffer.from("鸡", "utf8")) + 1;
    const parsed = await readJsonBody(requestFromChunks([payload.subarray(0, splitAt), payload.subarray(splitAt)]));
    expect(parsed.foodText).toBe("鸡胸肉沙拉");
  });

  it("请求体按网络字节数计，超出 1MB 直接 413", async () => {
    // 1,000,002 字节的合法 JSON 字符串
    const raw = Buffer.from(`"${"a".repeat(1_000_000)}"`, "utf8");
    await expect(readJsonBody(requestFromChunks([raw]))).rejects.toMatchObject({
      status: 413,
      code: "REQUEST_BODY_TOO_LARGE",
    });
  });

  it("多字节内容按 UTF-16 计数在旧实现下会绕过上限，必须按字节数拦截", async () => {
    // 40 万个三字节汉字 = 120 万字节（UTF-16 计数只有 40 万，小于 100 万）
    const raw = Buffer.from(`"${"减".repeat(400_000)}"`, "utf8");
    expect(raw.length).toBeGreaterThan(1_000_000);
    await expect(readJsonBody(requestFromChunks([raw]))).rejects.toMatchObject({ status: 413 });
  });

  it("空请求体解析为空对象", async () => {
    await expect(readJsonBody(requestFromChunks([]))).resolves.toEqual({});
  });
});
