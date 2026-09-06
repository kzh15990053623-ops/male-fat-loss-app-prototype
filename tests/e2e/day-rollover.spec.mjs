import { test, expect } from "@playwright/test";
import { openFreshApp, seedApp, stateSnapshot } from "../helpers/app-fixture.mjs";

test("跨午夜后的首次饮水操作不会复制昨日记录", async ({ page }) => {
  await openFreshApp(page);
  await seedApp(page, { variant: "full" });
  const before = await stateSnapshot(page);
  await page.clock.setFixedTime(new Date("2026-08-10T08:00:00+08:00"));
  await page.getByRole("button", { name: "+200ml", exact: true }).click();
  const after = await stateSnapshot(page);
  expect(after.state.dailyRecords["2026-08-09"]).toEqual(before.state.dailyRecords["2026-08-09"]);
  expect(after.state.dailyRecords["2026-08-10"]).toMatchObject({ waterMl: 200, steps: 0, sleep: 0, workoutDone: false });
  expect(after.meals.every((meal) => meal.calories === 0 && meal.foods.length === 0)).toBe(true);
  expect(after.state.customActivities).toEqual([]);
});

test("从后台返回时切换到当天，保留已保存的当天记录", async ({ page }) => {
  await openFreshApp(page);
  await seedApp(page, { variant: "full" });
  await page.evaluate(async () => {
    const { state } = await import("/src/app-state.js");
    const { createBlankDailyRecord } = await import("/src/app-data.js");
    state.dailyRecords["2026-08-10"] = { ...createBlankDailyRecord("2026-08-10"), waterMl: 600, steps: 2000 };
  });
  await page.clock.setFixedTime(new Date("2026-08-10T08:00:00+08:00"));
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  const after = await stateSnapshot(page);
  expect(after.state).toMatchObject({ currentDate: "2026-08-10", waterMl: 600, steps: 2000, workoutDone: false });
});
