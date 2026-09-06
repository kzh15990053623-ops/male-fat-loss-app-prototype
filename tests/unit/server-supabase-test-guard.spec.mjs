import { describe, expect, it } from "vitest";
import { assertDedicatedProject, assertExpectedLocalUrl, parseStatusJson } from "../../scripts/supabase-test-stack.mjs";

describe("local integration database safety boundary", () => {
  it("accepts only dedicated loopback ports and expected protocols", async () => {
    await expect(assertDedicatedProject()).resolves.toBeUndefined();
    expect(assertExpectedLocalUrl("http://127.0.0.1:55321", "55321", "API").origin).toBe("http://127.0.0.1:55321");
    expect(assertExpectedLocalUrl("postgresql://postgres:local@localhost:55322/postgres", "55322", "database").port).toBe("55322");
  });
  it.each([
    "https://remote.supabase.co",
    "http://127.0.0.1:54321",
    "http://127.0.0.1.evil.test:55321",
    "http://192.168.1.1:55321",
    "invalid",
  ])("rejects an unrelated database target %s", (url) => {
    expect(() => assertExpectedLocalUrl(url, "55321", "API")).toThrow();
  });
  it("parses status without emitting key material", () => {
    expect(parseStatusJson('notice\n{"API_URL":"http://127.0.0.1:55321"}\n')).toEqual({ API_URL: "http://127.0.0.1:55321" });
    expect(() => parseStatusJson("stack unavailable")).toThrow("status JSON");
  });
});
