import { describe, expect, it } from "vitest";
import { clearExpiredAccessSessions } from "../../server/session.mjs";

describe("access session 惰性清扫", () => {
  it("保留未过期条目并删除 expiresAt 小于等于 now 的条目", () => {
    const sessions = new Map([
      ["future", { userId: "u1", expiresAt: 1001 }],
      ["equal", { userId: "u2", expiresAt: 1000 }],
      ["past", { userId: "u3", expiresAt: 999 }],
      ["invalid", null],
    ]);

    expect(clearExpiredAccessSessions(sessions, 1000)).toBe(3);
    expect([...sessions.keys()]).toEqual(["future"]);
  });
});
