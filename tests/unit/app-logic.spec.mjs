import { beforeEach, describe, expect, it } from "vitest";
import { initialStateSnapshot, initialMealsSnapshot, meals, state } from "../../src/app-state.js";
import {
  bmi,
  calorieRecommendation,
  completionSeries,
  computeStreak,
  customBurned,
  estimateCalories,
  fatLossProgress,
  hasDailyRecordData,
  healthGuardrails,
  macrosTotal,
  recordBurned,
  recordIntake,
  recommendedProteinGrams,
  remainingCalories,
  targetEta,
  todayTasks,
  totalBurned,
  totalIntake,
  trendInsight,
  waistProgress,
  weeklyCompletionSummary,
} from "../../src/app-logic.js";

function resetState() {
  Object.keys(state).forEach((key) => delete state[key]);
  Object.assign(state, structuredClone(initialStateSnapshot));
  meals.splice(0, meals.length, ...structuredClone(initialMealsSnapshot));
}

beforeEach(() => {
  resetState();
});

describe("热量口径", () => {
  it("剩余热量只减摄入，不把运动消耗加回预算", () => {
    state.calorieBudget = 1880;
    meals[0].calories = 500;
    state.customActivities = [{ kcal: 600 }];
    expect(totalIntake()).toBe(500);
    expect(totalBurned()).toBe(600);
    expect(remainingCalories()).toBe(1380);
  });

  it("自定义消耗累加并钳制负值", () => {
    state.customActivities = [{ kcal: 600 }, { kcal: -50 }, { kcal: 0 }];
    expect(customBurned()).toBe(600);
  });

  it("宏量营养素跨餐次求和", () => {
    meals[0].macros = { protein: 30, carbs: 10, fat: 5 };
    meals[1].macros = { protein: 12, carbs: 40, fat: 8 };
    expect(macrosTotal()).toEqual({ protein: 42, carbs: 50, fat: 13 });
  });
});

describe("进度计算", () => {
  it("体重进度按起点-目标区间线性计算并夹在 0-100", () => {
    state.startWeight = 100;
    state.targetWeight = 80;
    state.weight = 90;
    expect(fatLossProgress()).toBe(50);
    state.weight = 70;
    expect(fatLossProgress()).toBe(100);
    state.weight = 110;
    expect(fatLossProgress()).toBe(0);
  });

  it("目标不低于起点或缺数据时进度为 0", () => {
    state.startWeight = 100;
    state.targetWeight = 120;
    state.weight = 110;
    expect(fatLossProgress()).toBe(0);
    state.startWeight = 0;
    expect(fatLossProgress()).toBe(0);
  });

  it("腰围进度同口径", () => {
    state.startWaist = 100;
    state.targetWaist = 85;
    state.waist = 92.5;
    expect(waistProgress()).toBe(50);
    state.waist = 70;
    expect(waistProgress()).toBe(100);
  });
});

describe("蛋白质推荐", () => {
  it("按 1.8 g/kg 计算并带上下限", () => {
    expect(recommendedProteinGrams(86.4)).toBe(156);
    expect(recommendedProteinGrams(40)).toBe(80);
    expect(recommendedProteinGrams(150)).toBe(220);
  });

  it("无效体重回退默认值", () => {
    expect(recommendedProteinGrams(0)).toBe(150);
    expect(recommendedProteinGrams(-5)).toBe(150);
    expect(recommendedProteinGrams("abc")).toBe(150);
  });
});

describe("热量预算建议", () => {
  it("基础信息缺失时不给建议", () => {
    const result = calorieRecommendation();
    expect(result.tdee).toBe(0);
    expect(result.suggested).toBe(0);
    expect(result.label).toBe("待完善基础信息");
  });

  it("按活动系数推导 TDEE 并扣减每日缺口", () => {
    state.user = { height: 178, age: 34, bmr: 1818, dailyCalories: 1880 };
    state.weeklyLossTarget = 0.6;
    const result = calorieRecommendation();
    expect(result.tdee).toBe(2509);
    expect(result.suggested).toBe(1849);
    expect(result.diff).toBe(-31);
    expect(result.label).toBe("当前热量合适");
  });

  it("运动消耗提高活动系数，预算偏低时提示上调", () => {
    state.user = { height: 178, age: 34, bmr: 1818, dailyCalories: 1880 };
    state.weeklyLossTarget = 0.6;
    state.customActivities = [{ kcal: 700 }];
    const result = calorieRecommendation();
    expect(result.tdee).toBe(2763);
    expect(result.suggested).toBe(2103);
    expect(result.diff).toBe(223);
    expect(result.label).toBe("当前略偏低");
  });

  it("建议热量受 1400 下限保护", () => {
    state.user = { height: 165, age: 28, bmr: 1200, dailyCalories: 1400 };
    state.weeklyLossTarget = 1.0;
    const result = calorieRecommendation();
    expect(result.suggested).toBe(1400);
    expect(result.diff).toBe(0);
  });
});

describe("运动消耗估算", () => {
  it("按 MET 公式计算已知运动", () => {
    state.weight = 80;
    expect(estimateCalories("跑步", 30)).toBe(370);
  });

  it("未知运动回退默认 MET，零时长至少计 1 kcal", () => {
    state.weight = 80;
    expect(estimateCalories("未知运动", 30)).toBe(210);
    expect(estimateCalories("跑步", 0)).toBe(1);
  });
});

describe("今日任务", () => {
  it("空数据时五项均未完成", () => {
    const tasks = todayTasks();
    expect(tasks.map((task) => task.label)).toEqual(["训练", "喝水", "步数", "睡眠", "饮食记录"]);
    expect(tasks.every((task) => !task.done)).toBe(true);
  });

  it("满足全部条件时五项完成", () => {
    meals.forEach((meal) => {
      meal.calories = 500;
    });
    state.waterMl = 2400;
    state.steps = 9000;
    state.sleep = 7.5;
    state.workoutDone = true;
    expect(todayTasks().every((task) => task.done)).toBe(true);
  });

  it("手动勾选覆盖自动判定", () => {
    state.taskOverrides = { 训练: true };
    const tasks = todayTasks();
    expect(tasks[0].done).toBe(true);
    expect(tasks.slice(1).every((task) => !task.done)).toBe(true);
  });
});

function record(overrides = {}) {
  return {
    date: "2026-08-24",
    meals: [],
    waterMl: 0,
    steps: 0,
    sleep: 0,
    customActivities: [],
    taskOverrides: {},
    workoutDone: false,
    ...overrides,
  };
}

describe("每日记录聚合", () => {
  it("记录摄入/消耗钳制非法值", () => {
    expect(recordIntake(record({ meals: [{ calories: 500 }, { calories: -20 }] }))).toBe(500);
    expect(recordBurned(record({ customActivities: [{ kcal: 180 }, { kcal: -5 }] }))).toBe(180);
    expect(recordIntake(record())).toBe(0);
  });

  it("任一维度有数据即视为有效记录", () => {
    expect(hasDailyRecordData(record())).toBe(false);
    expect(hasDailyRecordData(record({ waterMl: 100 }))).toBe(true);
    expect(hasDailyRecordData(record({ weight: 86.4 }))).toBe(true);
    expect(hasDailyRecordData(record({ customActivities: [{ kcal: 1 }] }))).toBe(true);
  });

  it("连续记录只统计有效记录日并使用今天或昨天作为起点", () => {
    const dailyRecords = {
      "2026-08-22": record({ date: "2026-08-22", steps: 1 }),
      "2026-08-23": record({ date: "2026-08-23", steps: 1 }),
      "2026-08-24": record({ date: "2026-08-24", steps: 1 }),
    };
    expect(computeStreak({}, "2026-08-24")).toBe(0);
    expect(computeStreak(dailyRecords, "2026-08-24")).toBe(3);
    expect(computeStreak({ ...dailyRecords, "2026-08-24": record({ date: "2026-08-24" }) }, "2026-08-24")).toBe(2);
  });

  it("遇到中断或空白记录立即截断", () => {
    const dailyRecords = {
      "2026-08-20": record({ date: "2026-08-20", steps: 1 }),
      "2026-08-21": record({ date: "2026-08-21" }),
      "2026-08-22": record({ date: "2026-08-22", steps: 1 }),
      "2026-08-23": record({ date: "2026-08-23", steps: 1 }),
    };
    expect(computeStreak(dailyRecords, "2026-08-23")).toBe(2);
    expect(computeStreak({ "2026-08-23": record({ date: "2026-08-23" }) }, "2026-08-23")).toBe(0);
  });

  it("跨月和跨年使用 UTC 日期递减", () => {
    expect(
      computeStreak(
        {
          "2026-01-31": record({ date: "2026-01-31", steps: 1 }),
          "2026-02-01": record({ date: "2026-02-01", steps: 1 }),
          "2026-02-02": record({ date: "2026-02-02", steps: 1 }),
        },
        "2026-02-02",
      ),
    ).toBe(3);
    expect(
      computeStreak(
        {
          "2025-12-31": record({ date: "2025-12-31", steps: 1 }),
          "2026-01-01": record({ date: "2026-01-01", steps: 1 }),
        },
        "2026-01-01",
      ),
    ).toBe(2);
  });

  it("不受历史持久化 streak 值影响", () => {
    expect(
      computeStreak(
        {
          streak: 99,
          bestStreak: 120,
          dailyRecords: {
            "2026-08-23": record({ date: "2026-08-23", steps: 1 }),
            "2026-08-24": record({ date: "2026-08-24", steps: 1 }),
          },
        }.dailyRecords,
        "2026-08-24",
      ),
    ).toBe(2);
  });

  it("完成率序列跳过零数据日", () => {
    state.waterTarget = 2400;
    state.stepsTarget = 9000;
    state.dailyRecords = {
      "2026-08-22": record({
        date: "2026-08-22",
        workoutDone: true,
        waterMl: 2400,
        steps: 9000,
        sleep: 7,
        meals: [{ calories: 1 }, { calories: 1 }, { calories: 1 }],
      }),
      "2026-08-24": record({
        date: "2026-08-24",
        workoutDone: true,
        waterMl: 2400,
        steps: 9000,
        sleep: 7,
        meals: [{ calories: 1 }, { calories: 1 }, { calories: 1 }],
      }),
      "2026-08-25": record({ date: "2026-08-25", waterMl: 2400, steps: 9000, meals: [{ calories: 1 }, { calories: 1 }, { calories: 1 }] }),
      "2026-08-26": record({ date: "2026-08-26" }),
    };
    expect(completionSeries()).toEqual([
      { date: "2026-08-22", value: 100 },
      { date: "2026-08-24", value: 100 },
      { date: "2026-08-25", value: 60 },
    ]);
  });

  it("周完成度从周一开始累计，忽略上周与零行动日", () => {
    state.waterTarget = 2400;
    state.stepsTarget = 9000;
    state.dailyRecords = {
      "2026-08-22": record({
        date: "2026-08-22",
        workoutDone: true,
        waterMl: 2400,
        steps: 9000,
        sleep: 7,
        meals: [{ calories: 1 }, { calories: 1 }, { calories: 1 }],
      }),
      "2026-08-24": record({
        date: "2026-08-24",
        workoutDone: true,
        waterMl: 2400,
        steps: 9000,
        sleep: 7,
        meals: [{ calories: 1 }, { calories: 1 }, { calories: 1 }],
      }),
      "2026-08-25": record({ date: "2026-08-25", waterMl: 2400, steps: 9000, meals: [{ calories: 1 }, { calories: 1 }, { calories: 1 }] }),
      "2026-08-26": record({ date: "2026-08-26" }),
    };
    const summary = weeklyCompletionSummary("2026-08-26");
    expect(summary.weekStart).toBe("2026-08-24");
    expect(summary.through).toBe("2026-08-26");
    expect(summary.days).toBe(2);
    expect(summary.completed).toBe(8);
    expect(summary.total).toBe(10);
    expect(summary.percent).toBe(80);
  });

  it("无行动日时完成度为 null", () => {
    state.dailyRecords = { "2026-08-26": record({ date: "2026-08-26" }) };
    const summary = weeklyCompletionSummary("2026-08-26");
    expect(summary.percent).toBe(null);
    expect(summary.days).toBe(0);
  });
});

describe("趋势洞察", () => {
  it("体重下降达标时报告稳定趋势与平均结余", () => {
    const insight = trendInsight([86.4, 85.7], [100, -50], []);
    expect(insight.title).toBe("趋势稳定");
    expect(insight.hasEnoughData).toBe(true);
    expect(insight.weightDelta).toBe(-0.7);
    expect(insight.avgBalance).toBe(25);
    expect(insight.items[0]).toContain("体重均值正在下降");
    expect(insight.items[1]).toBe("平均保留 25 kcal，避免为了数字长期摄入过低。");
  });

  it("数据不足时明确提示且不生成判断", () => {
    const insight = trendInsight([], [], []);
    expect(insight.title).toBe("数据积累中");
    expect(insight.hasEnoughData).toBe(false);
    expect(insight.items[0]).toContain("至少记录 2 次体重");
  });

  it("体重回升或缓慢下降各有对应文案", () => {
    expect(trendInsight([86, 87], [], []).title).toBe("等待校准");
    expect(trendInsight([86.4, 86.2], [], []).title).toBe("缓慢推进");
  });

  it("平均超支时给出负结余提示", () => {
    const insight = trendInsight([86.4, 85.7], [-100], []);
    expect(insight.avgBalance).toBe(-100);
    expect(insight.items[1]).toBe("平均超出预算 100 kcal，先检查晚餐与加餐。");
  });
});

describe("身体指标", () => {
  it("BMI 按身高体重计算", () => {
    state.user = { height: 178, age: 34, bmr: 1818, dailyCalories: 1880 };
    state.weight = 86.4;
    expect(bmi()).toBe("27.3");
  });

  it("身高缺失时 BMI 显示占位符", () => {
    state.weight = 86.4;
    expect(bmi()).toBe("--");
  });

  it("健康护栏输出腰高比、热量下限与减重速度", () => {
    state.user = { height: 178, age: 34, bmr: 1818, dailyCalories: 1880 };
    state.weight = 86.4;
    state.waist = 96;
    state.weeklyLossTarget = 0.5;
    const items = healthGuardrails();
    expect(items.map((item) => item.label)).toEqual(["腰高比", "热量下限", "减重速度"]);
    expect(items[0]).toMatchObject({ value: 0.54, status: "需关注" });
    expect(items[1]).toMatchObject({ value: "1.03x", status: "偏低" });
    expect(items[2]).toMatchObject({ value: "0.5kg/周", status: "稳妥" });
  });

  it("BMI 达到 28 时追加提示项，腰围缺失时不输出", () => {
    state.user = { height: 178, age: 34, bmr: 1818, dailyCalories: 1880 };
    state.weight = 100;
    state.waist = 96;
    state.weeklyLossTarget = 0.5;
    expect(healthGuardrails().map((item) => item.label)).toEqual(["腰高比", "热量下限", "减重速度", "BMI"]);
    state.waist = 0;
    expect(healthGuardrails()).toEqual([]);
  });
});

describe("目标 ETA", () => {
  it("按每周减重目标折算剩余周数", () => {
    state.weight = 86.4;
    state.targetWeight = 76;
    state.weeklyLossTarget = 0.6;
    expect(targetEta()).toMatch(/^18 周 · /);
  });

  it("目标无效时给出占位文案", () => {
    // weight == target 落在 target >= weight 守卫里，"已达到目标" 分支当前不可达
    state.weight = 76;
    state.targetWeight = 76;
    state.weeklyLossTarget = 0.6;
    expect(targetEta()).toBe("待完善目标");
    state.targetWeight = 90;
    expect(targetEta()).toBe("待完善目标");
    state.targetWeight = 70;
    state.weeklyLossTarget = 0;
    expect(targetEta()).toBe("待完善目标");
  });
});
