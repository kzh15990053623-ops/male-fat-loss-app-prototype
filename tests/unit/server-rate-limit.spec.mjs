import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let limiter;
beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(1000000);
  limiter = await import("../../server/rate-limit.mjs");
});
afterEach(() => vi.useRealTimers());

describe("request rate limits", () => {
  it("isolates identities and expires hits exactly at the window boundary", () => {
    const policy = { limit: 2, windowMs: 5000 };
    expect(limiter.rateLimitRetryAfterSeconds("a", policy)).toBe(0);
    vi.advanceTimersByTime(2000);
    expect(limiter.rateLimitRetryAfterSeconds("a", policy)).toBe(0);
    expect(limiter.rateLimitRetryAfterSeconds("a", policy)).toBe(3);
    expect(limiter.rateLimitRetryAfterSeconds("b", policy)).toBe(0);
    vi.advanceTimersByTime(3000);
    expect(limiter.rateLimitRetryAfterSeconds("a", policy)).toBe(0);
    expect(limiter.rateLimitRetryAfterSeconds("a", policy)).toBe(2);
  });

  it("returns actionable 429 metadata without counting rejected attempts", () => {
    const policy = { limit: 1, windowMs: 1500, code: "AI_RATE_LIMITED", message: "稍后再试" };
    limiter.assertWithinRateLimit("user", policy);
    expect(() => limiter.assertWithinRateLimit("user", policy)).toThrow(
      expect.objectContaining({
        status: 429,
        code: "AI_RATE_LIMITED",
        message: "稍后再试",
        retryable: true,
        retryAfter: 2,
        headers: { "Retry-After": "2" },
      }),
    );
    vi.advanceTimersByTime(1500);
    expect(() => limiter.assertWithinRateLimit("user", policy)).not.toThrow();
    expect(limiter.rateLimitError(1)).toMatchObject({ code: "RATE_LIMITED", retryAfter: 1 });
  });

  it("bounds active bucket memory and preserves recent identities", () => {
    const policy = { limit: 1, windowMs: 60000 };
    for (let index = 0; index < 5001; index += 1) limiter.rateLimitRetryAfterSeconds(`active:${index}`, policy);
    expect(limiter.rateLimitRetryAfterSeconds("active:5000", policy)).toBe(60);
    expect(limiter.rateLimitRetryAfterSeconds("active:0", policy)).toBe(0);
  });

  it("sweeps each expired bucket using its own policy window", () => {
    const short = { limit: 1, windowMs: 1000 };
    const long = { limit: 1, windowMs: 86400000 };
    limiter.rateLimitRetryAfterSeconds("daily", long);
    for (let index = 0; index < 4999; index += 1) limiter.rateLimitRetryAfterSeconds(`short:${index}`, short);
    vi.advanceTimersByTime(2000);
    limiter.rateLimitRetryAfterSeconds("new", short);
    expect(limiter.rateLimitRetryAfterSeconds("daily", long)).toBe(86398);
    expect(limiter.rateLimitRetryAfterSeconds("short:0", short)).toBe(0);
  });

  it("ignores caller-controlled X-Forwarded-For and supports direct socket fallback", () => {
    expect(limiter.clientIp({ headers: { "x-forwarded-for": "spoofed" }, socket: { remoteAddress: "127.0.0.1" } })).toBe("127.0.0.1");
    expect(limiter.clientIp({ headers: { "cf-connecting-ip": " 192.0.2.1 " } })).toBe("192.0.2.1");
    expect(limiter.clientIp({ headers: {} })).toBe("unknown");
  });
});
