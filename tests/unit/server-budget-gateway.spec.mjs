import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createBudgetGateway } from "../../server/nutrition-budget-gateway.mjs";

const token = "a1".repeat(32);
const tokenHash = createHash("sha256").update(token).digest("hex");
const apiKey = "sb_secret_platform_test_only";
const operation = { p_action: "status", p_request_id: null, p_limit: 100_000_000, p_usage: null };
const budget = { allowed: true, month: "2026-10", requests: 0, reservedCny: 0, limitCny: 100 };
const request = (body = operation, secret = token, method = "POST") =>
  new Request("https://functions.test/nutrition-budget-gateway", {
    method,
    headers: { "X-Budget-Token": secret },
    ...(method === "POST" ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
  });
function setup(key = apiKey) {
  const fetchImpl = vi.fn(async (url) => Response.json(url.includes("credentials?") ? [{ token_hash: tokenHash }] : budget));
  return { fetchImpl, handler: createBudgetGateway({ url: "https://db.test", apiKey: key, fetchImpl }) };
}

describe("authenticated budget gateway", () => {
  it("uses the injected secret internally and exposes only the RPC budget", async () => {
    const { fetchImpl, handler } = setup();
    const result = await handler(request());
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual(budget);
    expect(result.headers.get("Cache-Control")).toBe("no-store");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [url, init] = fetchImpl.mock.calls[1];
    expect(url).toBe("https://db.test/rest/v1/rpc/nutrition_budget");
    expect(JSON.parse(init.body)).toEqual(operation);
    const headers = new Headers(init.headers);
    expect(headers.get("apikey")).toBe(apiKey);
    expect(headers.has("Authorization")).toBe(false);
    expect(headers.has("X-Budget-Token")).toBe(false);
  });
  it("supports platform-injected legacy service-role JWTs", async () => {
    const { fetchImpl, handler } = setup("legacy-service-role-jwt");
    expect((await handler(request())).status).toBe(200);
    expect(new Headers(fetchImpl.mock.calls[1][1].headers).get("Authorization")).toBe("Bearer legacy-service-role-jwt");
  });
  it("rejects missing, malformed and wrong credentials before executing a budget action", async () => {
    const { fetchImpl, handler } = setup();
    for (const secret of ["", "sb_publishable_public_key", "a1".repeat(31)]) {
      expect((await handler(request(operation, secret))).status).toBe(401);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
    expect((await handler(request(operation, "b2".repeat(32)))).status).toBe(401);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect((await handler(request(null, token, "GET"))).status).toBe(405);
  });
  it("accepts bounded reservations and usage reports", async () => {
    const { fetchImpl, handler } = setup();
    const id = "00000000-0000-0000-0000-000000000001";
    for (const body of [
      { ...operation, p_action: "reserve", p_request_id: id },
      { ...operation, p_action: "report", p_request_id: id, p_usage: { inputTokens: 4, outputTokens: 6, estimatedMicros: 56 } },
    ]) {
      expect((await handler(request(body))).status).toBe(200);
      expect(JSON.parse(fetchImpl.mock.lastCall[1].body)).toEqual(body);
    }
  });
  it.each([
    null,
    [],
    "{broken",
    { ...operation, p_action: "reset" },
    { ...operation, p_limit: 100_000_001 },
    { ...operation, p_limit: -1 },
    { ...operation, p_request_id: "wrong" },
    { ...operation, p_action: "reserve", p_request_id: null },
    { ...operation, p_usage: {} },
    { ...operation, table: "auth.users" },
    { ...operation, p_action: "report", p_request_id: "00000000-0000-0000-0000-000000000001", p_usage: {} },
    {
      ...operation,
      p_action: "report",
      p_request_id: "00000000-0000-0000-0000-000000000001",
      p_usage: { inputTokens: 1, outputTokens: 2, estimatedMicros: 1 },
    },
  ])("denies invalid operation %# without calling the RPC", async (body) => {
    const { fetchImpl, handler } = setup();
    expect((await handler(request(body))).status).toBe(400);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("rejects oversized streamed bodies", async () => {
    const { fetchImpl, handler } = setup();
    expect((await handler(request(" ".repeat(4097)))).status).toBe(400);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("fails closed without a configured or readable credential hash", async () => {
    const { fetchImpl, handler } = setup();
    for (const response of [
      new Response(apiKey, { status: 500 }),
      Response.json([]),
      Response.json([{ token_hash: "wrong" }]),
      Response.json([{ token_hash: tokenHash }, { token_hash: tokenHash }]),
    ]) {
      fetchImpl.mockResolvedValueOnce(response);
      const result = await handler(request());
      expect([401, 503]).toContain(result.status);
      expect(await result.text()).not.toContain(apiKey);
    }
    expect((await createBudgetGateway({ url: "", apiKey, fetchImpl })(request())).status).toBe(503);
  });
  it("hides upstream errors and preserves the budget on failed calls", async () => {
    const { fetchImpl, handler } = setup();
    fetchImpl
      .mockResolvedValueOnce(Response.json([{ token_hash: tokenHash }]))
      .mockResolvedValueOnce(new Response(apiKey, { status: 500 }));
    const result = await handler(request());
    expect(result.status).toBe(503);
    expect(await result.json()).toEqual({ code: "AI_BUDGET_UNAVAILABLE" });
    fetchImpl.mockRejectedValueOnce(new Error(apiKey));
    expect((await handler(request())).status).toBe(503);
  });
});
