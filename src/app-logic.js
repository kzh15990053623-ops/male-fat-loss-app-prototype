import { state, meals, activityTypes } from "./app-state.js";
import { icon, avg, isPlainRecord, timestampMs, todayKey } from "./app-utils.js";
import { normalizeMetricLogs } from "./app-data.js";

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
  return meals.reduce((sum, meal) => sum + meal.calories, 0);
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
  return record.meals.reduce((sum, meal) => sum + Math.max(0, Number(meal?.calories || 0)), 0);
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
    .filter(({ record }) => hasDailyRecordData(record))
    .map(({ date, record }) => ({
      date,
      value: Number(record.calorieBudget || state.calorieBudget || 0) - recordIntake(record),
    }));
}

function burnedSeries(limit = 7) {
  return dailyRecordEntries(limit)
    .filter(({ record }) => hasDailyRecordData(record))
    .map(({ date, record }) => ({ date, value: recordBurned(record) }));
}

function completionSeries(limit = 7) {
  return dailyRecordEntries(limit)
    .filter(({ record }) => hasDailyRecordData(record))
    .map(({ date, record }) => {
      const mealsDone = Array.isArray(record.meals) ? record.meals.filter((meal) => Number(meal?.calories || 0) > 0).length : 0;
      const completed = [
        Boolean(record.workoutDone) || recordBurned(record) > 0,
        Number(record.waterMl || 0) >= state.waterTarget,
        Number(record.steps || 0) >= state.stepsTarget,
        Number(record.sleep || 0) >= 7,
        mealsDone >= 3,
      ].filter(Boolean).length;
      return { date, value: Math.round((completed / 5) * 100) };
    });
}

function recordActionCompletion(record) {
  const mealsDone = Array.isArray(record?.meals) ? record.meals.filter((meal) => Number(meal?.calories || 0) > 0).length : 0;
  const burned = recordBurned(record);
  const completed = [
    Boolean(record?.workoutDone) || burned > 0,
    Number(record?.waterMl || 0) >= state.waterTarget,
    Number(record?.steps || 0) >= state.stepsTarget,
    Number(record?.sleep || 0) >= 7,
    mealsDone >= 3,
  ].filter(Boolean).length;
  const hasAction =
    mealsDone > 0 ||
    burned > 0 ||
    Number(record?.waterMl || 0) > 0 ||
    Number(record?.steps || 0) > 0 ||
    Number(record?.sleep || 0) > 0 ||
    Boolean(record?.workoutDone) ||
    Object.values(isPlainRecord(record?.taskOverrides) ? record.taskOverrides : {}).some(Boolean);
  return { completed, hasAction };
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
  else todo.push("补一段 20 分钟快走");

  return {
    score: Math.min(100, Math.round((tasksDone / 5) * 55 + Math.min(45, proteinRate * 0.25 + (remaining >= 0 ? 15 : 0)))),
    title: todo.length ? "今天还差一点" : "今天执行很稳",
    good,
    todo,
  };
}

function coachPlan() {
  const macros = macrosTotal();
  const remaining = remainingCalories();
  const proteinGap = Math.max(0, state.proteinTarget - macros.protein);
  const waterGap = Math.max(0, state.waterTarget - state.waterMl);
  const stepsGap = Math.max(0, state.stepsTarget - state.steps);
  const activityMinutes = state.customActivities.reduce((sum, item) => sum + item.minutes, 0);
  const dinnerMissing = meals.some((meal) => meal.id === "dinner" && meal.calories === 0);
  const dinnerTarget = remaining < 550 ? Math.max(280, remaining - 80) : Math.max(420, Math.min(650, remaining - 180));
  const actions = [];
  const risks = [];

  if (proteinGap > 20) actions.push(`优先补 ${proteinGap}g 蛋白，选瘦肉、鱼虾、蛋或豆制品`);
  if (dinnerMissing) actions.push(`晚餐控制在约 ${dinnerTarget} kcal，主食半份，蔬菜加量`);
  if (activityMinutes < 30) actions.push("补 20-30 分钟低冲击有氧，优先快走或椭圆机");
  if (waterGap > 0) actions.push(`再喝 ${Math.ceil(waterGap / 100) * 100}ml 水，避免晚间集中补水`);
  if (stepsGap > 0) actions.push(`还差 ${stepsGap} 步，饭后走 15 分钟更稳`);
  if (!actions.length) actions.push("今天执行质量不错，保持记录完整，晚间避免额外加餐");

  if (remaining < 250) risks.push("剩余热量偏紧，避免坚果、酒精和甜饮");
  if (state.sleep < 6.5) risks.push("睡眠偏少，今晚训练强度建议下调");
  if (macros.fat > 55) risks.push("脂肪摄入偏高，下一餐减少油脂和酱料");
  if (!risks.length) risks.push("风险较低，按计划完成剩余记录即可");

  let focus = "保持节奏";
  if (proteinGap > 25) focus = "补足蛋白";
  else if (activityMinutes < 30) focus = "补运动量";
  else if (remaining < 350) focus = "收口控热量";

  return {
    focus,
    actions: actions.slice(0, 3),
    risks: risks.slice(0, 2),
    proteinGap,
    remaining,
    activityMinutes,
  };
}

function targetEta() {
  if (!state.weight || !state.targetWeight || state.targetWeight >= state.weight || !state.weeklyLossTarget) return "待完善目标";
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
  if (!Number.isFinite(bmiValue) || !state.waist || !state.user.height || !state.user.bmr) return [];
  const waistToHeight = Number((state.waist / state.user.height).toFixed(2));
  const calorieRatio = Number((state.user.dailyCalories / state.user.bmr).toFixed(2));
  const items = [];

  items.push({
    label: "腰高比",
    value: waistToHeight,
    status: waistToHeight >= 0.58 ? "偏高" : waistToHeight >= 0.52 ? "需关注" : "良好",
    tone: waistToHeight >= 0.58 ? "warn" : waistToHeight >= 0.52 ? "mid" : "good",
    note: waistToHeight >= 0.52 ? "优先关注腰围下降，不只盯体重。" : "腰围风险较低，继续保持记录。",
  });

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

function calorieRecommendation() {
  if (!state.user.bmr || !state.user.dailyCalories) {
    return { tdee: 0, suggested: 0, diff: 0, label: "待完善基础信息", note: "完成目标设置后再生成预算建议。" };
  }
  const activityFactor = totalBurned() > 650 ? 1.52 : totalBurned() > 450 ? 1.45 : 1.38;
  const dailyDeficit = Math.round((Math.max(0.1, state.weeklyLossTarget || 0.6) * 7700) / 7);
  const tdee = Math.round(state.user.bmr * activityFactor);
  const suggested = Math.max(1400, Math.min(2800, tdee - dailyDeficit));
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
          ? "预算过低容易影响坚持，建议略微上调并保证蛋白。"
          : "预算偏松时要看晚餐和加餐，先减少精制碳水和油脂。",
  };
}

function estimateCalories(type, minutes) {
  const met = activityTypes[type]?.met || 5;
  return Math.max(1, Math.round((met * 3.5 * state.weight * Number(minutes || 0)) / 200));
}

function todayTasks() {
  const activityMinutes = state.customActivities.reduce((sum, item) => sum + item.minutes, 0);
  const mealsDone = meals.filter((meal) => meal.calories > 0).length;
  return [
    {
      label: "训练",
      value: activityMinutes > 0 ? `${activityMinutes} 分钟已记录` : "30 分钟",
      done: state.workoutDone || activityMinutes > 0,
      icon: icon("dumbbell"),
    },
    {
      label: "喝水",
      value: `${(state.waterMl / 1000).toFixed(1)} / ${(state.waterTarget / 1000).toFixed(1)}L`,
      done: state.waterMl >= state.waterTarget,
      icon: icon("water"),
    },
    { label: "步数", value: `${state.steps} / ${state.stepsTarget}`, done: state.steps >= state.stepsTarget, icon: icon("steps") },
    { label: "睡眠", value: state.sleep ? `${state.sleep} 小时` : "待记录", done: state.sleep >= 7, icon: icon("moon") },
    { label: "饮食记录", value: `${mealsDone} / 4 餐`, done: mealsDone === 4, icon: icon("fork") },
  ].map((task) => ({ ...task, done: state.taskOverrides[task.label] ?? task.done }));
}

function aiDietAdvice() {
  const macros = macrosTotal();
  const proteinGap = Math.max(0, state.proteinTarget - macros.protein);
  const intake = totalIntake();
  const remaining = remainingCalories();
  const dinnerMissing = meals.some((meal) => meal.id === "dinner" && meal.calories === 0);
  const carbRatio = macros.carbs / Math.max(1, macros.carbs + macros.protein + macros.fat);
  const advice = [];

  if (proteinGap > 25) {
    advice.push(`蛋白质还差 ${proteinGap}g，晚餐优先选鸡胸、鱼虾、瘦牛肉或豆腐，避免只吃主食。`);
  } else {
    advice.push("蛋白质进度不错，晚餐保持一份优质蛋白即可，不需要额外加大份量。");
  }

  if (dinnerMissing) {
    advice.push(`当前还剩 ${remaining} kcal，晚餐建议控制在 520-650 kcal，并把蔬菜体积做足。`);
  } else if (remaining < 350) {
    advice.push("剩余热量偏紧，后续只保留无糖饮品或少量高蛋白加餐。");
  }

  if (carbRatio > 0.48) {
    advice.push("碳水占比偏高，下一餐减少精制米面，换成半份粗粮或根茎类。");
  }

  if (intake < state.calorieBudget * 0.65) {
    advice.push("摄入偏低时别硬扛，优先补蛋白和蔬菜，避免夜间报复性进食。");
  }

  return advice.slice(0, 3);
}

function mealPlateOptions() {
  const macros = macrosTotal();
  const remaining = remainingCalories();
  const proteinGap = Math.max(0, state.proteinTarget - macros.protein);
  const baseCalories = Math.max(320, Math.min(680, remaining - 120));
  const lowCarbCalories = Math.max(360, Math.min(620, baseCalories));
  const snackCalories = Math.max(180, Math.min(340, proteinGap > 25 ? 280 : 220));
  const trainingCalories = Math.max(420, Math.min(700, baseCalories + 80));

  return [
    {
      id: "lean-dinner",
      title: "控碳晚餐",
      subtitle: "适合晚餐未记录或剩余热量偏紧",
      food: "瘦牛肉150g、绿叶菜300g、半份糙米饭",
      calories: lowCarbCalories,
      protein: Math.max(38, Math.min(58, proteinGap + 16)),
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
      protein: Math.max(26, Math.min(42, proteinGap)),
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
  const highTarget = (state.weeklyLossTarget || 0.6) >= 0.7;
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
  else if (weightDelta <= -0.6) items.push("体重均值正在下降，保持当前饮食与训练节奏。");
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

function weeklyActionPlan(weights, balanceValues, burnedValues) {
  const insight = trendInsight(weights, balanceValues, burnedValues);
  const waists = waistSeries().map((item) => item.value);
  const waistDelta = waists.length > 1 ? Number((waists.at(-1) - waists[0]).toFixed(1)) : 0;
  const actions = [];

  if (!insight.hasEnoughData) {
    return [
      {
        id: "build-baseline",
        title: "先建立真实基线",
        meta: "连续记录 3 天",
        detail: "完成体重、饮食和活动记录后，再生成下周调整建议。",
        target: "home",
      },
    ];
  }

  if (burnedValues.length && insight.avgBurned < 180) {
    actions.push({
      id: "more-cardio",
      title: "增加有氧",
      meta: "下周 +2 次 30 分钟",
      detail: "把快走、椭圆机或慢跑安排到工作日晚上，优先补足运动消耗。",
      target: "training",
    });
  }

  if (balanceValues.length && (insight.avgBalance < 0 || insight.weightDelta > -0.3)) {
    actions.push({
      id: "tighten-dinner",
      title: "收紧晚餐",
      meta: "晚餐 520 kcal 内",
      detail: "主食半份，蛋白足量，减少油脂和酱料，先连续执行 3 天。",
      target: "diet",
    });
  }

  if (completionSeries().length && insight.completion < 80) {
    actions.push({
      id: "habit-floor",
      title: "降低执行门槛",
      meta: "每天只守 3 件事",
      detail: "饮食记录、饮水、步数先稳定，训练可以用低冲击有氧替代。",
      target: "home",
    });
  }

  if (waists.length >= 2 && waistDelta > -0.8) {
    actions.push({
      id: "waist-focus",
      title: "腰围优先",
      meta: "每周量 3 次",
      detail: "腰围下降慢时先控晚餐碳水和酒精，体重波动不用过度反应。",
      target: "profile",
    });
  }

  if (!actions.length) {
    actions.push({
      id: "keep-course",
      title: "维持计划",
      meta: "不急着加码",
      detail: "趋势可用，下周保持当前热量预算和训练结构，观察腰围均值。",
      target: "home",
    });
  }

  return actions.slice(0, 3);
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
