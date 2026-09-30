import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

let db;
const call = async (action, id = null, limit = 300000, usage = null) => {
  const result = await db.query("select public.nutrition_budget($1, $2::uuid, $3::bigint, $4::jsonb) as budget", [
    action,
    id,
    limit,
    usage === null ? null : JSON.stringify(usage),
  ]);
  return result.rows[0].budget;
};
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    "create role anon; create role authenticated; create role service_role; grant usage on schema public to anon, authenticated, service_role;",
  );
  await db.exec(await readFile(new URL("../../supabase/migrations/202609210001_nutrition_budget.sql", import.meta.url), "utf8"));
}, 30000);
beforeEach(async () => {
  await db.exec("reset role; truncate public.nutrition_ai_usage;");
});
afterAll(async () => {
  await db?.close();
});

describe("PostgreSQL budget migration", () => {
  it("enforces a shared cap, never refunds reported calls, and rejects duplicate reservations", async () => {
    const id = randomUUID();
    await call("reserve", id);
    await expect(call("reserve", id)).rejects.toThrow();
    const attempts = await Promise.all(Array.from({ length: 6 }, () => call("reserve", randomUUID())));
    expect(attempts.filter((entry) => entry.allowed)).toHaveLength(2);
    expect(await call("report", id, 300000, { inputTokens: 2000, outputTokens: 1000, estimatedMicros: 12000 })).toMatchObject({
      reservedCny: 0.3,
      estimatedCny: 0.012,
      remainingRequests: 0,
      unreportedRequests: 2,
    });
    await call("report", id, 300000, { inputTokens: 1, outputTokens: 1, estimatedMicros: 10 });
    expect((await call("status")).estimatedCny).toBe(0.012);
  });
  it("clamps requested budgets to 100 yuan and denies malformed reporting", async () => {
    expect((await call("status", null, 900000000)).limitCny).toBe(100);
    expect(await call("reserve", randomUUID(), 0)).toMatchObject({ allowed: false, requests: 0 });
    await expect(call("invalid")).rejects.toThrow();
    await expect(call("report", randomUUID(), 300000, {})).rejects.toThrow();
    await expect(call("report", randomUUID(), 300000, { inputTokens: 10, outputTokens: 10, estimatedMicros: 1 })).rejects.toThrow();
  });
  it("keeps late reports in their original month, and freezes anomalous spending", async () => {
    const old = randomUUID();
    await db.query("insert into public.nutrition_ai_usage(request_id, month) values ($1, '2020-01')", [old]);
    expect(await call("report", old, 300000, { inputTokens: 1, outputTokens: 1, estimatedMicros: 10 })).toMatchObject({
      requests: 0,
      estimatedCny: 0,
    });
    const id = randomUUID();
    await call("reserve", id);
    await call("report", id, 300000, { inputTokens: 100000, outputTokens: 0, estimatedMicros: 200000 });
    expect(await call("reserve", randomUUID())).toMatchObject({ allowed: false, remainingRequests: 0 });
  });
  it("permits only service-role RPC access; browser roles cannot inspect or change the ledger", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await expect(call("reserve", randomUUID())).rejects.toThrow(/permission denied/);
      await expect(db.query("select * from public.nutrition_ai_usage")).rejects.toThrow(/permission denied/);
      await db.exec("reset role");
    }
    await db.exec("set role service_role");
    expect(await call("reserve", randomUUID())).toMatchObject({ allowed: true, requests: 1 });
  });
});
