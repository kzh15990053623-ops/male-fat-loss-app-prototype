import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, it, expect } from "vitest";
let db;
const a = randomUUID(),
  b = randomUUID();
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    "create role anon; create role authenticated; create role service_role; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql as $$select nullif(current_setting('app.user_id',true),'')::uuid$$;",
  );
  for (const file of [
    "202606300001_init_app_states.sql",
    "202609060001_explicit_app_state_grants.sql",
    "202609210001_nutrition_budget.sql",
    "20261003171922_maturity_user_quota_archive.sql",
  ])
    await db.exec(await readFile(new URL(`../../supabase/migrations/${file}`, import.meta.url), "utf8"));
  await db.query("insert into auth.users values ($1),($2)", [a, b]);
}, 30000);
afterAll(() => db?.close());
const reserve = async (user) =>
  (
    await db.query("select public.nutrition_budget_for_user('reserve',$1::uuid,100000000,null,$2::uuid,20,5) as result", [
      randomUUID(),
      user,
    ])
  ).rows[0].result;
it("serializes per-user and project reservations without resets or cross-account consumption", async () => {
  const rows = await Promise.all(Array.from({ length: 12 }, () => reserve(a)));
  expect(rows.filter((row) => row.allowed)).toHaveLength(5);
  expect(await reserve(b)).toMatchObject({ allowed: true, userRequests: 1, userRemainingRequests: 4 });
  await db.query("update public.nutrition_ai_usage set created_at=now()-interval '1 day' where user_id=$1", [a]);
  expect(await reserve(a)).toMatchObject({ allowed: true, userRequests: 6 });
  await db.exec("set role authenticated");
  await expect(reserve(a)).rejects.toThrow(/permission denied/);
  await db.exec("reset role");
});
it("archives retained days before snapshot rollover; RLS isolates users and clear erases their archive", async () => {
  await db.query("insert into public.app_states(user_id,state,meals) values ($1,$2::jsonb,'[]'),($3,'{}','[]')", [
    a,
    JSON.stringify({
      dailyRecords: { "2020-01-01": { date: "2020-01-01", weight: 80 }, "2026-08-09": { date: "2026-08-09", weight: 70 } },
    }),
    b,
  ]);
  await db.query("update public.app_states set state=$1::jsonb where user_id=$2", [
    JSON.stringify({ dailyRecords: { "2026-08-09": { date: "2026-08-09", weight: 69 } } }),
    a,
  ]);
  expect((await db.query("select count(*)::int as count from public.app_daily_records where user_id=$1", [a])).rows[0].count).toBe(2);
  await db.query("select set_config('app.user_id',$1,false)", [a]);
  const before = (await db.query("select revision from public.app_daily_records where user_id=$1 and date='2026-08-09'", [a])).rows[0]
    .revision;
  const edit = (
    await db.query("select public.write_app_day('2026-08-09',$1::jsonb,$2) as result", [
      JSON.stringify({ date: "2026-08-09", weight: 68 }),
      before,
    ])
  ).rows[0].result;
  expect(edit.record.weight).toBe(68);
  expect(
    (await db.query("select state from public.app_states where user_id=$1", [a])).rows[0].state.dailyRecords["2026-08-09"].weight,
  ).toBe(68);
  expect(
    (
      await db.query("select public.write_app_day('2026-08-09',$1::jsonb,$2) as result", [
        JSON.stringify({ date: "2026-08-09", weight: 67 }),
        before,
      ])
    ).rows[0].result.conflict.record.weight,
  ).toBe(68);
  await db.exec("grant usage on schema auth to authenticated; set role authenticated");
  await db.query("select set_config('app.user_id',$1,false)", [b]);
  expect((await db.query("select * from public.app_daily_records")).rows).toEqual([]);
  await db.exec("reset role");
  await db.query("update public.app_states set state=$1::jsonb where user_id=$2", [
    JSON.stringify({ clearedAt: new Date().toISOString() }),
    a,
  ]);
  expect((await db.query("select * from public.app_daily_records")).rows).toEqual([]);
});
