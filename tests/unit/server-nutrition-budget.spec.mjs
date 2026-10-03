import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const config = vi.hoisted(() => ({}));
vi.mock("../../server/config.mjs", () => config);
let directory;
let service;
beforeEach(async () => {
  vi.resetModules();
  directory = await mkdtemp(join(tmpdir(), "fitness-budget-test-"));
  Object.assign(config, {
    hostedRuntime: false,
    nutritionAiBudgetGatewayToken: "",
    nutritionAiAllowedUserId: "",
    nutritionAiAllowedUserIds: [],
    nutritionAiUserMonthlyLimit: 20,
    nutritionAiUserDailyLimit: 5,
    nutritionAiBudgetPath: join(directory, "ledger.json"),
    nutritionAiMonthlyBudgetMicros: 300000,
    supabaseUrl: "https://db.test",
    supabaseServiceRoleKey: "test-key",
  });
  service = await import("../../server/nutrition-budget.mjs");
});
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  await rm(directory, { recursive: true, force: true });
});
describe("durable budget and personal account gate", () => {
  it("reserves atomically before sending, survives a module restart, and never refunds on report", async () => {
    const attempts = await Promise.allSettled(Array.from({ length: 8 }, (_, index) => service.reserveNutritionBudget(`id-${index}`)));
    expect(attempts.filter((entry) => entry.status === "fulfilled")).toHaveLength(3);
    expect(
      attempts.filter((entry) => entry.status === "rejected").every((entry) => entry.reason.code === "AI_MONTHLY_BUDGET_EXCEEDED"),
    ).toBe(true);
    expect(await service.reportNutritionUsage("id-0", { prompt_tokens: 2000, completion_tokens: 1000 })).toMatchObject({
      reservedCny: 0.3,
      estimatedCny: 0.012,
      remainingRequests: 0,
      unreportedRequests: 2,
    });
    vi.resetModules();
    service = await import("../../server/nutrition-budget.mjs");
    await expect(service.reserveNutritionBudget("after-restart")).rejects.toMatchObject({ code: "AI_MONTHLY_BUDGET_EXCEEDED" });
  });
  it("rolls over by Shanghai month and attributes late usage to its original month", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-30T15:59:59Z"));
    expect((await service.reserveNutritionBudget("september")).month).toBe("2026-09");
    vi.setSystemTime(new Date("2026-09-30T16:00:01Z"));
    expect(await service.reportNutritionUsage("september", { prompt_tokens: 2000, completion_tokens: 1000 })).toMatchObject({
      month: "2026-10",
      requests: 0,
      estimatedCny: 0,
    });
    expect(await service.reserveNutritionBudget("october")).toMatchObject({ month: "2026-10", requests: 1 });
  });
  it("fails closed for corrupt ledgers, held locks, duplicate IDs and missing usage records", async () => {
    await writeFile(config.nutritionAiBudgetPath, "broken");
    await expect(service.reserveNutritionBudget("a")).rejects.toMatchObject({ code: "AI_BUDGET_UNAVAILABLE" });
    await writeFile(
      config.nutritionAiBudgetPath,
      JSON.stringify({ version: 1, entries: { bad: { month: "wrong", estimatedMicros: -1 } } }),
    );
    await expect(service.nutritionBudgetStatus()).rejects.toMatchObject({ code: "AI_BUDGET_UNAVAILABLE" });
    await writeFile(config.nutritionAiBudgetPath, JSON.stringify({ version: 1, entries: {} }));
    await service.reserveNutritionBudget("a");
    await expect(service.reserveNutritionBudget("a")).rejects.toMatchObject({ code: "AI_BUDGET_UNAVAILABLE" });
    await expect(service.reportNutritionUsage("missing", { prompt_tokens: 1, completion_tokens: 2 })).rejects.toMatchObject({
      code: "AI_BUDGET_UNAVAILABLE",
    });
    await writeFile(`${config.nutritionAiBudgetPath}.lock`, "");
    await expect(service.nutritionBudgetStatus()).rejects.toMatchObject({ code: "AI_BUDGET_UNAVAILABLE" });
    expect(JSON.parse(await readFile(config.nutritionAiBudgetPath, "utf8")).entries.a).toBeTruthy();
  });
  it("does not invent missing usage, and freezes after unexpectedly expensive usage", async () => {
    await service.reserveNutritionBudget("a");
    for (const value of [undefined, {}, { prompt_tokens: -1, completion_tokens: 2 }, { prompt_tokens: "12", completion_tokens: 2 }]) {
      expect(await service.reportNutritionUsage("a", value)).toBeNull();
    }
    await service.reportNutritionUsage("a", { prompt_tokens: 100000, completion_tokens: 100000 });
    await expect(service.reserveNutritionBudget("b")).rejects.toMatchObject({ code: "AI_MONTHLY_BUDGET_EXCEEDED" });
  });
  it("enforces owner on hosted deployments, without trusting a browser-supplied ID", () => {
    service.assertNutritionOwner("local-dev");
    config.hostedRuntime = true;
    expect(() => service.assertNutritionOwner("anyone")).toThrow(expect.objectContaining({ code: "AI_ACCOUNT_NOT_ALLOWED" }));
    config.nutritionAiAllowedUserId = "owner";
    expect(() => service.assertNutritionOwner("someone-else")).toThrow();
    service.assertNutritionOwner("owner");
  });
  it("uses only the durable RPC when hosted, and blocks on unavailable or malformed storage", async () => {
    config.hostedRuntime = true;
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            allowed: true,
            month: "2026-09",
            reservedCny: 0.1,
            limitCny: 100,
            estimatedCny: 0,
            requests: 1,
            remainingRequests: 999,
            unreportedRequests: 1,
          }),
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    await service.reserveNutritionBudget("00000000-0000-0000-0000-000000000001");
    expect(fetchMock.mock.calls[0][0]).toBe("https://db.test/rest/v1/rpc/nutrition_budget");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ p_action: "reserve", p_limit: 300000 });
    for (const result of [
      new Response("{}"),
      new Response("no", { status: 500 }),
      new Response(JSON.stringify({ allowed: true, limitCny: 101, reservedCny: 0 })),
    ]) {
      fetchMock.mockResolvedValueOnce(result);
      await expect(service.nutritionBudgetStatus()).rejects.toMatchObject({ code: "AI_BUDGET_UNAVAILABLE" });
    }
    config.supabaseServiceRoleKey = "";
    await expect(service.reserveNutritionBudget("a")).rejects.toMatchObject({ code: "AI_BUDGET_UNAVAILABLE" });
  });
});
