import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { state, meals, runtime } from "../../src/app-state.js";
import {
  capturePersistedDataFingerprint,
  createBlankDailyRecord,
  currentDailyRecord,
  prepareLocalMutation,
  resetAppData,
  rolloverToTodayIfNeeded,
} from "../../src/app-data.js";
import { todayKey } from "../../src/app-utils.js";

let yesterday;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 4, 23, 59));
  resetAppData({ blank: true });
  yesterday = todayKey();
  Object.assign(state, { waterMl: 2400, steps: 9000, sleep: 8, workoutDone: true });
  meals[0].calories = 500;
  state.dailyRecords[yesterday] = currentDailyRecord(yesterday, "2026-09-04T10:00:00.000Z");
  capturePersistedDataFingerprint();
});
afterEach(() => vi.useRealTimers());

describe("local calendar day boundary", () => {
  it("archives yesterday without changing its timestamp and records only today's first drink", () => {
    const previous = structuredClone(state.dailyRecords[yesterday]);
    vi.setSystemTime(new Date(2026, 8, 5, 0, 1));
    expect(rolloverToTodayIfNeeded()).toBe(true);
    state.waterMl += 200;
    prepareLocalMutation();
    expect(state.dailyRecords[yesterday]).toEqual(previous);
    expect(state.dailyRecords[todayKey()]).toMatchObject({ waterMl: 200, steps: 0, sleep: 0, workoutDone: false });
    expect(meals.every((meal) => meal.calories === 0)).toBe(true);
  });

  it("restores an existing record for the new date instead of replacing it", () => {
    vi.setSystemTime(new Date(2026, 8, 5, 0, 1));
    state.dailyRecords[todayKey()] = { ...createBlankDailyRecord(), waterMl: 600, steps: 1000 };
    rolloverToTodayIfNeeded();
    expect(state.waterMl).toBe(600);
    expect(state.steps).toBe(1000);
    expect(state.workoutDone).toBe(false);
    expect(rolloverToTodayIfNeeded()).toBe(false);
  });

  it("attributes a delayed save of pre-midnight edits to yesterday", () => {
    state.waterMl = 2600;
    vi.setSystemTime(new Date(2026, 8, 5, 0, 1));
    prepareLocalMutation();
    expect(state.dailyRecords[yesterday].waterMl).toBe(2600);
    expect(state.dailyRecords[todayKey()].waterMl).toBe(0);
    expect(state.steps).toBe(0);
  });

  it("does not invent records for skipped days or erase a remote clear marker", () => {
    resetAppData({ blank: true });
    state.clearedAt = "2026-09-04T15:00:00.000Z";
    capturePersistedDataFingerprint();
    vi.setSystemTime(new Date(2026, 8, 8, 0, 1));
    prepareLocalMutation();
    expect(state.currentDate).toBe(todayKey());
    expect(state.dailyRecords).toEqual({});
    expect(state.clearedAt).toBe("2026-09-04T15:00:00.000Z");
    expect(runtime.lastMutationChanged).toBe(false);
  });
});
