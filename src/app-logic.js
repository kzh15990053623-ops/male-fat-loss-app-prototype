import { state, meals, activityTypes } from "./app-state.js";
import { icon, avg, isPlainRecord, timestampMs, todayKey } from "./app-utils.js";
import { normalizeMetricLogs } from "./app-data.js";
import { numericSettingFields } from "./settings-fields.js";
import { completeMacros, completeIntake, hasRecordedMeal, summarizeMeal } from "./meal-entries.js";

// 纯派生：同步状态 → 展示文案。渲染层只消费 state（的派生），不依赖同步层。
function backendStatusText() {
  const labels = {
    idle: "等待登录",
    connecting: "连接中…",
    saving: "保存中…",
    online: "已同步",
    device: "本机模式",
    local: "已存本机，等待同步",
    offline: state.syncErrorKind === "storage" ? "保存失败" : "当前离线",
  };
  return labels[state.backendStatus] || labels.connecting;
}

function totalIntake() {
  return recordIntake({ meals });
}

function customBurned() {
  return state.customActivities.reduce((sum, item) => sum + Math.max(0, Number(item.kcal || 0)), 0);
}

function totalBurned() {
  return customBurned();
}

function remainingCalories() {
  return Number(state.calorieBudget || 0) - totalIntake();
}

function macrosTotal() {
  return meals.reduce(
    (sum, meal) => ({
      protein: sum.protein + meal.macros.protein,
      carbs: sum.carbs + meal.macros.carbs,
      fat: sum.fat + meal.macros.fat,
    }),
    { protein: 0, carbs: 0, fat: 0 },
  );
}

function fatLossProgress() {
  if (!state.startWeight || !state.targetWeight || state.targetWeight >= state.startWeight) return 0;
  const lost = state.startWeight - state.weight;
  const target = state.startWeight - state.targetWeight;
  return Math.max(0, Math.min(100, Math.round((lost / target) * 100)));
}

function waistProgress() {
  if (!state.startWaist || !state.targetWaist || state.targetWaist >= state.startWaist) return 0;
  const lost = state.startWaist - state.waist;
  const target = state.startWaist - state.targetWaist;
  return Math.max(0, Math.min(100, Math.round((lost / target) * 100)));
}

function weightSeries() {
  return normalizeMetricLogs(state.weightLogs).map((item) => ({
    date: item.date,
    label: item.label,
    value: Number(item.value),
  }));
}

function waistSeries() {
  return normalizeMetricLogs(state.waistLogs).map((item) => ({
    date: item.date,
    label: item.label,
    value: Number(item.value),
  }));
}

function dailyRecordEntries(limit = 7) {
  return Object.entries(isPlainRecord(state.dailyRecords) ? state.dailyRecords : {})
    .filter(([, record]) => isPlainRecord(record))
    .sort(([dateA], [dateB]) => timestampMs(dateA) - timestampMs(dateB))
    .slice(-limit)
    .map(([date, record]) => ({ date, record }));
}

function recordIntake(record) {
  if (!Array.isArray(record?.meals)) return 0;
  return record.meals.reduce(
    (sum, meal) => sum + Math.max(0, Number((Array.isArray(meal?.entries) ? summarizeMeal(meal).calories : meal?.calories) || 0)),
    0,
  );
}

function recordBurned(record) {
  if (!Array.isArray(record?.customActivities)) return 0;
  return record.customActivities.reduce((sum, item) => sum + Math.max(0, Number(item?.kcal || 0)), 0);
}

function hasDailyRecordData(record) {
  const hasTaskOverride = Object.values(isPlainRecord(record?.taskOverrides) ? record.taskOverrides : {}).some(Boolean);
  return (
    recordIntake(record) > 0 ||
    recordBurned(record) > 0 ||
    Number(record?.waterMl || 0) > 0 ||
    Number(record?.steps || 0) > 0 ||
    Number(record?.sleep || 0) > 0 ||
    Number.isFinite(record?.weight) ||
    Number.isFinite(record?.waist) ||
    Boolean(record?.workoutDone) ||
    hasTaskOverride
  );
}

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function normalizeDateKey(value) {
  const match = String(value || "").match(DATE_KEY_PATTERN);
  if (!match) return "";
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return "";
  }
  return match[0];
}

function previousDateKey(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function computeStreak(dailyRecords, today = todayKey()) {
  const records = isPlainRecord(dailyRecords) ? dailyRecords : {};
  let date = normalizeDateKey(today);
  if (!date) return 0;

  if (!hasDailyRecordData(records[date])) date = previousDateKey(date);

  let streak = 0;
  while (date && hasDailyRecordData(records[date])) {
    streak += 1;
    date = previousDateKey(date);
  }
  return streak;
}

function calorieBalanceSeries(limit = 7) {
  return dailyRecordEntries(limit)
    .filter(({ record }) => completeIntake(record))
    .map(({ date, record }) => ({
      date,
      value: Number(record.calorieBudget || state.calorieBudget || 0) - recordIntake(record),
    }));
}

function burnedSeries(limit = 7) {
  return dailyRecordEntries(limit)
    .filter(({ record }) => recordBurned(record) > 0 || record.restDay)
    .map(({ date, record }) => ({ date, value: recordBurned(record) }));
}

function recordActionCompletion(record) {
  const targets = record?.habitTargets || { water: state.waterTarget, steps: state.stepsTarget, sleep: state.sleepTarget || 7 };
  const checks = {
    训练: Boolean(record?.restDay || record?.workoutDone) || recordBurned(record) > 0,
    喝水: Number(record?.waterMl || 0) >= targets.water,
    步数: Number(record?.steps || 0) >= targets.steps,
    睡眠: Number(record?.sleep || 0) >= targets.sleep,
    饮食记录: completeIntake(record),
  };
  const completed = Object.entries(checks).filter(([label, done]) => record?.taskOverrides?.[label] ?? done).length;
  return {
    completed,
    hasAction:
      Boolean(record?.restDay || record?.workoutDone) ||
      (record?.meals || []).some(hasRecordedMeal) ||
      recordBurned(record) > 0 ||
      ["waterMl", "steps", "sleep"].some((key) => Number(record?.[key]) > 0) ||
      Object.values(record?.taskOverrides || {}).some(Boolean),
  };
}
function completionSeries(limit = 7) {
  return dailyRecordEntries(limit)
    .filter(({ record }) => recordActionCompletion(record).hasAction)
    .map(({ date, record }) => ({ date, value: Math.round((recordActionCompletion(record).completed / 5) * 100) }));
}

function weeklyCompletionSummary(referenceDate = state.currentDate || todayKey()) {
  const normalizedReference = /^\d{4}-\d{2}-\d{2}$/.test(String(referenceDate || "")) ? String(referenceDate) : todayKey();
  const reference = new Date(`${normalizedReference}T12:00:00`);
  const mondayOffset = (reference.getDay() + 6) % 7;
  const weekStart = new Date(reference);
  weekStart.setDate(reference.getDate() - mondayOffset);
  const weekStartKey = weekStart.toLocaleDateString("sv-SE");
  const actionDays = dailyRecordEntries(90)
    .filter(({ date }) => date >= weekStartKey && date <= normalizedReference)
    .map(({ date, record }) => ({ date, ...recordActionCompletion(record) }))
    .filter((item) => item.hasAction);

  if (!actionDays.length) {
    return { percent: null, days: 0, completed: 0, total: 0, weekStart: weekStartKey, through: normalizedReference };
  }

  const completed = actionDays.reduce((sum, item) => sum + item.completed, 0);
  const total = actionDays.length * 5;
  return {
    percent: Math.round((completed / total) * 100),
    days: actionDays.length,
    completed,
    total,
    weekStart: weekStartKey,
    through: normalizedReference,
  };
}

function reviewSummary() {
  if (!completeIntake({ intakeStatus: state.intakeStatus, meals }) || !completeMacros(meals))
    return { score: 0, title: "记录待补全", good: [], todo: ["请补齐饮食并确认今天已记录完整，再查看营养复盘。"] };
  const macros = macrosTotal();
  const proteinRate = Math.round((macros.protein / state.proteinTarget) * 100);
  const tasksDone = todayTasks().filter((task) => task.done).length;
  const remaining = remainingCalories();
  const good = [];
  const todo = [];

  if (proteinRate >= 85) good.push("蛋白接近达标");
  else todo.push(`蛋白还差 ${Math.max(0, state.proteinTarget - macros.protein)}g`);

  if (remaining >= 0) good.push("饮食仍在预算内");
  else todo.push(`已超预算 ${Math.abs(remaining)} kcal`);

  if (customBurned() > 0) good.push("今日已有运动记录");
  else todo.push("运动或休息状态尚未记录");

  return {
    score: Math.min(100, Math.round((tasksDone / 5) * 55 + Math.min(45, proteinRate * 0.25 + (remaining >= 0 ? 15 : 0)))),
    title: todo.length ? "今天还差一点" : "今天执行很稳",
    good,
    todo,
  };
}

function coachPlan() {
  const complete = completeIntake({ intakeStatus: state.intakeStatus, meals }) && completeMacros(meals);
  return {
    focus: complete ? "回看真实记录" : "先补齐记录",
    actions: complete
      ? ["回顾食物、份量和保存的预算", "根据感受安排习惯，预算调整在设置中由你确认"]
      : ["记录实际吃过的食物，未知营养可稍后补充", "确认今天的饮食记录是否完整"],
    risks: complete ? ["单日数据不用于自动减餐或增加运动"] : ["记录不完整时暂不判断摄入是否合适"],
    proteinGap: complete ? Math.max(0, state.proteinTarget - macrosTotal().protein) : null,
    remaining: remainingCalories(),
    activityMinutes: state.customActivities.reduce((sum, item) => sum + Number(item.minutes || 0), 0),
  };
}

function targetEta() {
  if (!state.weight || !state.targetWeight) return "待完善目标";
  if (state.weight <= state.targetWeight || state.user.goalMode === "maintain") return "已达到目标 · 进入维持阶段";
  if (!state.weeklyLossTarget) return "待完善目标";
  const remainingKg = Math.max(0, state.weight - state.targetWeight);
  if (!remainingKg) return "已达到目标";
  const weeks = Math.ceil(remainingKg / Math.max(0.1, state.weeklyLossTarget || 0.6));
  const date = new Date();
  date.setDate(date.getDate() + weeks * 7);
  return `${weeks} 周 · ${date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" })}`;
}

function bmi() {
  const meters = state.user.height / 100;
  if (!meters || !state.weight) return "--";
  return (state.weight / (meters * meters)).toFixed(1);
}

function healthGuardrails() {
  const bmiValue = Number(bmi());
  if (!Number.isFinite(bmiValue) || !state.user.height || !state.user.bmr || !state.user.dailyCalories) return [];
  const estimate = dailyCalorieEstimate();
  if (!estimate) return [];
  const calorieRatio = Number((state.user.dailyCalories / estimate.bmr).toFixed(2));
  const items = [];

  if (state.waist > 0) {
    const waistToHeight = Number((state.waist / state.user.height).toFixed(2));
    items.push({
      label: "腰高比",
      value: waistToHeight,
      status: waistToHeight >= 0.58 ? "偏高" : waistToHeight >= 0.52 ? "需关注" : "良好",
      tone: waistToHeight >= 0.58 ? "warn" : waistToHeight >= 0.52 ? "mid" : "good",
      note: waistToHeight >= 0.52 ? "优先关注腰围下降，不只盯体重。" : "腰围风险较低，继续保持记录。",
    });
  }

  items.push({
    label: "热量下限",
    value: `${calorieRatio}x`,
    status: calorieRatio < 1.05 ? "偏低" : "可用",
    tone: calorieRatio < 1.05 ? "warn" : "good",
    note: calorieRatio < 1.05 ? "预算接近基础代谢，长期执行可能影响恢复。" : "预算没有明显压得过低。",
  });

  items.push({
    label: "减重速度",
    value: `${state.weeklyLossTarget}kg/周`,
    status: state.weeklyLossTarget > 0.8 ? "偏激进" : "稳妥",
    tone: state.weeklyLossTarget > 0.8 ? "mid" : "good",
    note: state.weeklyLossTarget > 0.8 ? "建议观察睡眠、饥饿感和训练表现。" : "目标速度适合长期坚持。",
  });

  if (bmiValue >= 28) {
    items.push({
      label: "BMI",
      value: bmiValue,
      status: "偏高",
      tone: "mid",
      note: "建议以低冲击有氧和力量训练为主，避免膝踝压力过大。",
    });
  }

  return items;
}

// Protein target scales with body weight (1.8 g/kg, clamped) instead of a
// fixed value, so lighter and heavier users both get a sensible goal.
function recommendedProteinGrams(weight) {
  const value = Number(weight);
  if (!Number.isFinite(value) || value <= 0) return 150;
  return Math.max(80, Math.min(220, Math.round(value * 1.8)));
}

function estimateCalorieBudget({ height, age, weight, weeklyLoss, formula = "male", activityLevel = "", goalMode = "loss" }) {
  const values = { height: Number(height), age: Number(age), weight: Number(weight), weeklyLoss: Number(weeklyLoss) };
  if (
    Object.entries(values).some(
      ([key, value]) => !Number.isFinite(value) || value < numericSettingFields[key].min || value > numericSettingFields[key].max,
    )
  )
    return null;
  if (!["male", "female"].includes(formula)) return null;
  const bmr = Math.round(10 * values.weight + 6.25 * values.height - 5 * values.age + (formula === "female" ? -161 : 5));
  const activityFactor = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725 }[activityLevel] || 1.375;
  const dailyDeficit = goalMode === "maintain" ? 0 : Math.round((values.weeklyLoss * 7700) / 7);
  const tdee = Math.round(bmr * activityFactor);
  return { bmr, activityFactor, dailyDeficit, tdee, suggested: Math.max(1400, Math.min(2800, tdee - dailyDeficit)) };
}

function dailyCalorieEstimate() {
  return estimateCalorieBudget({
    height: state.user.height,
    age: state.user.age,
    weight: state.weight,
    weeklyLoss: state.weeklyLossTarget,
    activityKcal: totalBurned(),
    formula: state.user.formula || "manual",
    activityLevel: state.user.activityLevel || "light",
    goalMode: state.user.goalMode || "loss",
  });
}

function calorieRecommendation() {
  const estimate = dailyCalorieEstimate();
  if (!estimate || !state.user.dailyCalories) {
    return { tdee: 0, suggested: 0, diff: 0, label: "待完善基础信息", note: "完成目标设置后再生成预算建议。" };
  }
  const { tdee, suggested } = estimate;
  const diff = suggested - state.user.dailyCalories;
  return {
    tdee,
    suggested,
    diff,
    label: Math.abs(diff) < 80 ? "当前热量合适" : diff > 0 ? "当前略偏低" : "当前略偏高",
    note:
      Math.abs(diff) < 80
        ? "按当前体重和活动量，可以继续观察 7 天体重均值。"
        : diff > 0
          ? "估算范围高于当前预算。请核对资料和自身感受，调整由你确认。"
          : "这是估算范围与当前预算的差异。先核对资料和完整记录，再决定是否调整。",
  };
}

function estimateCalories(type, minutes) {
  const met = activityTypes[type]?.met || 5;
  return Math.max(1, Math.round((met * 3.5 * state.weight * Number(minutes || 0)) / 200));
}

function todayTasks() {
  const activityMinutes = state.customActivities.reduce((sum, item) => sum + item.minutes, 0);
  const mealsDone = meals.filter(hasRecordedMeal).length;
  return [
    {
      label: "训练",
      value: state.restDay ? "休息日已记录" : activityMinutes > 0 ? `${activityMinutes} 分钟已记录` : "30 分钟",
      done: state.restDay || state.workoutDone || activityMinutes > 0,
      icon: icon("dumbbell"),
    },
    {
      label: "喝水",
      value: `${(state.waterMl / 1000).toFixed(1)} / ${(state.waterTarget / 1000).toFixed(1)}L`,
      done: state.waterMl >= state.waterTarget,
      icon: icon("water"),
    },
    { label: "步数", value: `${state.steps} / ${state.stepsTarget}`, done: state.steps >= state.stepsTarget, icon: icon("steps") },
    {
      label: "睡眠",
      value: state.sleep ? `${state.sleep} 小时` : "待记录",
      done: state.sleep >= (state.sleepTarget || 7),
      icon: icon("moon"),
    },
    {
      label: "饮食记录",
      value: `${mealsDone} 餐 · ${state.intakeStatus === "complete" ? "已确认完整" : "待确认"}`,
      done: state.intakeStatus === "complete",
      icon: icon("fork"),
    },
  ].map((task) => ({ ...task, done: state.taskOverrides[task.label] ?? task.done }));
}

function aiDietAdvice() {
  if (!completeIntake({ intakeStatus: state.intakeStatus, meals }))
    return ["饮食记录尚未确认完整，营养建议暂不生成。", "未知营养可以稍后补充，先保留真实食物记录。"];
  return ["今天的饮食已经确认完整，可以回看食物与份量。", "单日摄入与预算的差不代表实际热量缺口，也不需要自动减餐或加练。"];
}

function mealPlateOptions() {
  const lowCarbCalories = 414;
  const snackCalories = 238;
  const trainingCalories = 514;

  return [
    {
      id: "lean-dinner",
      title: "控碳晚餐",
      subtitle: "适合晚餐未记录或剩余热量偏紧",
      food: "瘦牛肉150g、绿叶菜300g、半份糙米饭",
      calories: lowCarbCalories,
      protein: 38,
      carbs: 34,
      fat: 14,
      amount: 450,
      slot: "dinner",
    },
    {
      id: "protein-snack",
      title: "高蛋白加餐",
      subtitle: "适合蛋白还差较多但不想吃太撑",
      food: "无糖酸奶200g、乳清蛋白半份、蓝莓",
      calories: snackCalories,
      protein: 26,
      carbs: 20,
      fat: 6,
      amount: 260,
      slot: "snack",
    },
    {
      id: "post-workout",
      title: "训练后补给",
      subtitle: "适合今天有训练或准备补有氧",
      food: "鸡胸肉150g、土豆200g、番茄汤",
      calories: trainingCalories,
      protein: 48,
      carbs: 58,
      fat: 10,
      amount: 520,
      slot: "dinner",
    },
  ];
}

function dietScenarios() {
  return [
    {
      id: "takeout",
      title: "外卖",
      subtitle: "保留蛋白，少油少酱",
      rules: ["优先选烤/蒸/水煮", "主食半份", "另加一份蔬菜"],
      draft: {
        slot: "lunch",
        food: "牛肉饭半份米饭、青菜、无糖茶",
        calories: 560,
        protein: 42,
        carbs: 55,
        fat: 16,
        amount: 520,
        cooking: "清淡",
        oilGrams: 8,
        sauce: "少",
      },
    },
    {
      id: "dinner-out",
      title: "聚餐",
      subtitle: "控制酒精和隐藏油脂",
      rules: ["先吃蛋白和蔬菜", "少喝酒精饮料", "油炸菜只尝不吃饱"],
      draft: {
        slot: "dinner",
        food: "清蒸鱼、凉拌菜、少量米饭",
        calories: 620,
        protein: 48,
        carbs: 42,
        fat: 22,
        amount: 560,
        cooking: "清淡",
        oilGrams: 10,
        sauce: "少",
      },
    },
    {
      id: "late-work",
      title: "加班晚餐",
      subtitle: "避免夜间报复性进食",
      rules: ["热量控制在500以内", "不要甜饮", "保留睡前2小时空窗"],
      draft: {
        slot: "dinner",
        food: "鸡胸沙拉、鸡蛋、无糖酸奶",
        calories: 480,
        protein: 46,
        carbs: 28,
        fat: 18,
        amount: 430,
        cooking: "清淡",
        oilGrams: 6,
        sauce: "少",
      },
    },
  ];
}

function weeklyTrainingPlan() {
  const highTarget = false;
  const plan = [
    { day: "一", type: "力量塑形", minutes: 38, focus: "上肢推拉", kcal: estimateCalories("力量塑形", 38) },
    {
      day: "二",
      type: "燃脂快练",
      minutes: highTarget ? 28 : 22,
      focus: "短时高效",
      kcal: estimateCalories("燃脂快练", highTarget ? 28 : 22),
    },
    { day: "三", type: "有氧恢复", minutes: 30, focus: "低冲击", kcal: estimateCalories("有氧恢复", 30) },
    { day: "四", type: "腹部核心", minutes: 18, focus: "核心稳定", kcal: estimateCalories("腹部核心", 18) },
    { day: "五", type: "力量塑形", minutes: 42, focus: "下肢臀腿", kcal: estimateCalories("力量塑形", 42) },
    { day: "六", type: "跑步", minutes: highTarget ? 36 : 28, focus: "户外有氧", kcal: estimateCalories("跑步", highTarget ? 36 : 28) },
    { day: "日", type: "有氧恢复", minutes: 25, focus: "拉伸恢复", kcal: estimateCalories("有氧恢复", 25) },
  ];
  const mondayIndex = (new Date().getDay() + 6) % 7;
  return plan.map((item, index) => ({ ...item, today: index === mondayIndex }));
}

function todayPlanWorkout() {
  return weeklyTrainingPlan().find((item) => item.today) || weeklyTrainingPlan()[0];
}

function trendInsight(weights, balanceValues, burnedValues) {
  const hasWeightTrend = weights.length >= 2;
  const weightDelta = hasWeightTrend ? Number((weights.at(-1) - weights[0]).toFixed(1)) : 0;
  const avgBalance = balanceValues.length ? Math.round(avg(balanceValues)) : 0;
  const avgBurned = burnedValues.length ? Math.round(avg(burnedValues)) : 0;
  const completionValues = completionSeries().map((item) => item.value);
  const completion = completionValues.length ? Math.round(avg(completionValues)) : 0;
  const items = [];

  if (!hasWeightTrend) items.push("至少记录 2 次体重后，才能判断真实变化趋势。");
  else if (weightDelta <= -0.6) items.push("记录区间的体重正在下降，保持当前饮食与训练节奏。");
  else if (weightDelta < 0) items.push("体重缓慢下降，先持续记录，不急着进一步压低摄入。");
  else items.push("体重暂未下降，优先补齐连续饮食记录再调整预算。");

  if (!balanceValues.length) items.push("还没有足够的饮食数据，预算分析暂不生成。");
  else if (avgBalance < 0) items.push(`平均超出预算 ${Math.abs(avgBalance)} kcal，先检查晚餐与加餐。`);
  else items.push(`平均保留 ${avgBalance} kcal，避免为了数字长期摄入过低。`);

  if (burnedValues.length && avgBurned < 180) items.push("已有运动记录但总量偏少，可增加低冲击活动。");
  if (completionValues.length && completion < 75) items.push("完成率仍有空间，先稳定饮食、饮水与步数记录。");

  return {
    title: !hasWeightTrend ? "数据积累中" : weightDelta <= -0.6 ? "趋势稳定" : weightDelta < 0 ? "缓慢推进" : "等待校准",
    hasEnoughData: hasWeightTrend || balanceValues.length >= 2,
    weightDelta,
    avgBalance,
    avgBurned,
    completion,
    items: items.slice(0, 4),
  };
}

function weeklyActionPlan(weights, balanceValues) {
  return [
    {
      id: "build-baseline",
      title: balanceValues.length ? "回看真实记录" : "先补齐饮食记录",
      meta: "按实际日期复盘",
      detail: "确认完整记录后查看趋势；预算调整由你主动确认。",
      target: "diet",
    },
    {
      id: "keep-course",
      title: state.weight <= state.targetWeight && state.targetWeight > 0 ? "进入维持阶段" : "保持记录习惯",
      meta: weights.length < 2 ? "继续建立基线" : "观察记录区间",
      detail: "单次体重变化不直接触发减餐或增加训练。",
      target: "profile",
    },
  ];
}

export {
  backendStatusText,
  totalIntake,
  customBurned,
  totalBurned,
  remainingCalories,
  macrosTotal,
  fatLossProgress,
  waistProgress,
  weightSeries,
  waistSeries,
  dailyRecordEntries,
  recordIntake,
  recordBurned,
  hasDailyRecordData,
  computeStreak,
  calorieBalanceSeries,
  burnedSeries,
  completionSeries,
  weeklyCompletionSummary,
  reviewSummary,
  coachPlan,
  targetEta,
  bmi,
  healthGuardrails,
  estimateCalorieBudget,
  dailyCalorieEstimate,
  calorieRecommendation,
  recommendedProteinGrams,
  estimateCalories,
  todayTasks,
  aiDietAdvice,
  mealPlateOptions,
  dietScenarios,
  weeklyTrainingPlan,
  todayPlanWorkout,
  trendInsight,
  weeklyActionPlan,
};
