const state = {
  activeTab: "home",
  weight: 86.4,
  weightDraft: 86.4,
  waist: 96,
  waistDraft: 96,
  targetWeight: 76,
  targetWaist: 86,
  weeklyLossTarget: 0.6,
  startWeight: 92,
  startWaist: 103,
  calorieBudget: 1880,
  baseBurned: 420,
  streak: 18,
  bestStreak: 42,
  waterMl: 1700,
  waterTarget: 2400,
  steps: 6820,
  stepsTarget: 9000,
  sleep: 6.7,
  proteinTarget: 150,
  workoutDone: false,
  backendStatus: "connecting",
  authRequired: true,
  authError: "",
  taskOverrides: {},
  settingsOpen: false,
  dietScenario: "takeout",
  preferences: {
    unit: "metric",
    reminderTime: "21:30",
    pushEnabled: true,
    aiAssist: true,
  },
  mealTemplates: [
    { id: 1, name: "鸡胸糙米饭", food: "鸡胸肉150g, 糙米饭150g, 西兰花100g", calories: 510, protein: 52, carbs: 48, fat: 10 },
    { id: 2, name: "高蛋白早餐", food: "燕麦50g, 鸡蛋2个, 无糖酸奶200g", calories: 460, protein: 34, carbs: 48, fat: 15 },
  ],
  weightLogs: [
    { date: "周一", value: 89.1 },
    { date: "周二", value: 88.8 },
    { date: "周三", value: 88.3 },
    { date: "周四", value: 87.6 },
    { date: "周五", value: 87.2 },
    { date: "周六", value: 86.8 },
    { date: "今天", value: 86.4 },
  ],
  waistLogs: [
    { date: "周一", value: 99.5 },
    { date: "周二", value: 99.1 },
    { date: "周三", value: 98.4 },
    { date: "周四", value: 97.8 },
    { date: "周五", value: 97.1 },
    { date: "周六", value: 96.5 },
    { date: "今天", value: 96 },
  ],
  activityDraft: {
    name: "",
    type: "燃脂快练",
    minutes: 30,
  },
  mealDraft: {
    slot: "dinner",
    food: "",
    amount: 300,
    unit: "g",
    cooking: "清淡",
    oilGrams: 5,
    sauce: "少",
    calories: 520,
    protein: 38,
    carbs: 46,
    fat: 16,
    aiResult: null,
    aiLoading: false,
  },
  customActivities: [
    { id: 1, name: "快走通勤", type: "有氧恢复", minutes: 28, kcal: 142, createdAt: "19:20" },
  ],
  user: {
    height: 178,
    age: 34,
    bmr: 1765,
    dailyCalories: 1880,
  },
};

const meals = [
  {
    id: "breakfast",
    name: "早餐",
    calories: 420,
    status: "已记录",
    foods: ["燕麦 45g", "鸡蛋 2个", "无糖酸奶"],
    macros: { protein: 30, carbs: 43, fat: 14 },
  },
  {
    id: "lunch",
    name: "午餐",
    calories: 610,
    status: "已记录",
    foods: ["糙米饭", "鸡胸肉", "西兰花", "番茄汤"],
    macros: { protein: 52, carbs: 66, fat: 16 },
  },
  {
    id: "dinner",
    name: "晚餐",
    calories: 0,
    status: "待记录",
    foods: [],
    macros: { protein: 0, carbs: 0, fat: 0 },
  },
  {
    id: "snack",
    name: "加餐",
    calories: 230,
    status: "已记录",
    foods: ["乳清蛋白", "蓝莓"],
    macros: { protein: 28, carbs: 18, fat: 4 },
  },
];

const activityTypes = {
  燃脂快练: { met: 7.6, hint: "高心率间歇" },
  力量塑形: { met: 6.0, hint: "抗阻训练" },
  腹部核心: { met: 4.5, hint: "核心稳定" },
  跑步: { met: 8.8, hint: "户外或跑步机" },
  有氧恢复: { met: 4.2, hint: "低强度恢复" },
};

const workouts = [
  { type: "燃脂快练", name: "20 分钟全身循环", minutes: 20, kcal: 230, level: "中等", active: true },
  { type: "力量塑形", name: "上肢推拉基础", minutes: 38, kcal: 260, level: "中等", active: false },
  { type: "腹部核心", name: "核心稳定 + 平板支撑", minutes: 16, kcal: 120, level: "入门", active: false },
  { type: "跑步", name: "户外 5km 配速跑", minutes: 34, kcal: 360, level: "偏高", active: false },
  { type: "有氧恢复", name: "低强度椭圆机", minutes: 25, kcal: 160, level: "轻松", active: false },
];

const chartData = {
  weight: [89.1, 88.8, 88.3, 87.6, 87.2, 86.8, 86.4],
  deficit: [420, 360, 510, 290, 610, 440, 520],
  burned: [260, 420, 180, 510, 350, 0, 420],
  completion: [80, 60, 100, 80, 60, 40, 70],
};

const navItems = [
  { key: "home", label: "首页", svg: icon("home") },
  { key: "diet", label: "饮食", svg: icon("fork") },
  { key: "training", label: "训练", svg: icon("dumbbell") },
  { key: "data", label: "数据", svg: icon("chart") },
  { key: "profile", label: "我的", svg: icon("user") },
];

const STORAGE_KEY = "fat-loss-prototype-state-v2";
const TOKEN_KEY = "fat-loss-access-token";
const API_STATE_URL = "/api/state";
const API_NUTRITION_URL = "/api/ai/nutrition";
const API_SESSION_URL = "/api/session";
let saveTimer;
let toastTimer;
let accessToken = localStorage.getItem(TOKEN_KEY) || "";

function applyPersistedData(stored) {
  if (!stored || typeof stored !== "object") return;
  if (stored.state) {
    Object.assign(state, stored.state, {
      activityDraft: { ...state.activityDraft, ...(stored.state.activityDraft || {}) },
      mealDraft: { ...state.mealDraft, ...(stored.state.mealDraft || {}) },
      preferences: { ...state.preferences, ...(stored.state.preferences || {}) },
      user: { ...state.user, ...(stored.state.user || {}) },
      mealTemplates: Array.isArray(stored.state.mealTemplates) ? stored.state.mealTemplates : state.mealTemplates,
      weightLogs: Array.isArray(stored.state.weightLogs) ? stored.state.weightLogs : state.weightLogs,
      waistLogs: Array.isArray(stored.state.waistLogs) ? stored.state.waistLogs : state.waistLogs,
      taskOverrides: { ...state.taskOverrides, ...(stored.state.taskOverrides || {}) },
    });
    state.toast = "";
  }
  if (Array.isArray(stored.meals)) {
    meals.splice(0, meals.length, ...stored.meals);
  }
}

function loadStoredState() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    applyPersistedData(stored);
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

async function loadServerState() {
  try {
    if (!accessToken) {
      state.authRequired = true;
      return false;
    }
    const response = await fetch(API_STATE_URL, { cache: "no-store", headers: authHeaders() });
    if (response.status === 401) {
      state.authRequired = true;
      localStorage.removeItem(TOKEN_KEY);
      accessToken = "";
      return false;
    }
    if (!response.ok) {
      setBackendStatus("offline");
      return false;
    }
    const data = await response.json();
    state.authRequired = false;
    setBackendStatus("online");
    if (!data.state && !data.meals) return true;
    applyPersistedData(data);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ state, meals }));
    return true;
  } catch {
    setBackendStatus("offline");
    return false;
  }
}

function authHeaders(extra = {}) {
  return accessToken ? { ...extra, "X-App-Token": accessToken } : extra;
}

function setBackendStatus(status) {
  state.backendStatus = status;
  const label = document.querySelector("[data-backend-status]");
  if (label) {
    label.textContent = backendStatusText();
    label.dataset.status = status;
  }
}

function backendStatusText() {
  return state.backendStatus === "online" ? "后端已同步" : state.backendStatus === "offline" ? "本地模式" : "连接中";
}

function saveStoredState() {
  const { toast, authError, ...persistedState } = state;
  const payload = { state: persistedState, meals };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fetch(API_STATE_URL, {
      method: "PUT",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    })
      .then((response) => setBackendStatus(response.ok ? "online" : "offline"))
      .catch(() => {
        setBackendStatus("offline");
      });
  }, 250);
}

function totalIntake() {
  return meals.reduce((sum, meal) => sum + meal.calories, 0);
}

function customBurned() {
  return state.customActivities.reduce((sum, item) => sum + item.kcal, 0);
}

function totalBurned() {
  return state.baseBurned + customBurned();
}

function remainingCalories() {
  return state.calorieBudget - totalIntake() + totalBurned();
}

function macrosTotal() {
  return meals.reduce(
    (sum, meal) => ({
      protein: sum.protein + meal.macros.protein,
      carbs: sum.carbs + meal.macros.carbs,
      fat: sum.fat + meal.macros.fat,
    }),
    { protein: 0, carbs: 0, fat: 0 }
  );
}

function fatLossProgress() {
  const lost = state.startWeight - state.weight;
  const target = state.startWeight - state.targetWeight;
  return Math.round((lost / target) * 100);
}

function waistProgress() {
  const lost = state.startWaist - state.waist;
  const target = state.startWaist - state.targetWaist;
  if (!target) return 0;
  return Math.max(0, Math.min(100, Math.round((lost / target) * 100)));
}

function weightSeries() {
  const logs = Array.isArray(state.weightLogs) && state.weightLogs.length ? state.weightLogs : chartData.weight.map((value, index) => ({ date: `D${index + 1}`, value }));
  return logs.map((item) => Number(item.value));
}

function waistSeries() {
  const logs = Array.isArray(state.waistLogs) && state.waistLogs.length ? state.waistLogs : [];
  return logs.map((item) => Number(item.value));
}

function reviewSummary() {
  const macros = macrosTotal();
  const proteinRate = Math.round((macros.protein / state.proteinTarget) * 100);
  const tasksDone = todayTasks().filter((task) => task.done).length;
  const deficit = remainingCalories();
  const good = [];
  const todo = [];

  if (proteinRate >= 85) good.push("蛋白接近达标");
  else todo.push(`蛋白还差 ${Math.max(0, state.proteinTarget - macros.protein)}g`);

  if (deficit >= 400) good.push("热量赤字充足");
  else todo.push("晚间控制加餐");

  if (customBurned() > 0) good.push("今日已有运动记录");
  else todo.push("补一段 20 分钟快走");

  return {
    score: Math.min(100, Math.round((tasksDone / 5) * 55 + Math.min(45, proteinRate * 0.25 + (deficit > 0 ? 15 : 0)))),
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
  const remainingKg = Math.max(0, state.weight - state.targetWeight);
  if (!remainingKg) return "已达到目标";
  const weeks = Math.ceil(remainingKg / Math.max(0.1, state.weeklyLossTarget || 0.6));
  const date = new Date();
  date.setDate(date.getDate() + weeks * 7);
  return `${weeks} 周 · ${date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" })}`;
}

function bmi() {
  const meters = state.user.height / 100;
  return (state.weight / (meters * meters)).toFixed(1);
}

function healthGuardrails() {
  const bmiValue = Number(bmi());
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

function calorieRecommendation() {
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
    note: Math.abs(diff) < 80
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

function currentTimeLabel() {
  return new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function todayTasks() {
  const activityMinutes = state.customActivities.reduce((sum, item) => sum + item.minutes, 0);
  const mealsDone = meals.filter((meal) => meal.calories > 0).length;
  return [
    { label: "训练", value: activityMinutes > 0 ? `${activityMinutes} 分钟已记录` : "30 分钟", done: state.workoutDone || activityMinutes > 0, icon: icon("dumbbell") },
    { label: "喝水", value: `${(state.waterMl / 1000).toFixed(1)} / ${(state.waterTarget / 1000).toFixed(1)}L`, done: state.waterMl >= state.waterTarget, icon: icon("water") },
    { label: "步数", value: `${state.steps} / ${state.stepsTarget}`, done: state.steps >= state.stepsTarget, icon: icon("steps") },
    { label: "睡眠", value: `${state.sleep} 小时`, done: true, icon: icon("moon") },
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

function renderDietScenarioGuide() {
  const scenarios = dietScenarios();
  return `
    <section class="scenario-card">
      <div class="section-title">
        <h2>生活场景策略</h2>
        <span>${scenarios.find((item) => item.id === state.dietScenario)?.title || "外卖"}</span>
      </div>
      <div class="scenario-tabs">
        ${scenarios.map((item) => `
          <button class="${state.dietScenario === item.id ? "active" : ""}" data-diet-scenario="${item.id}">${item.title}</button>
        `).join("")}
      </div>
      ${scenarios.filter((item) => item.id === state.dietScenario).map((item) => `
        <article class="scenario-detail">
          <div>
            <strong>${item.subtitle}</strong>
            <p>${item.rules.join(" · ")}</p>
          </div>
          <button class="outline-button" data-apply-scenario="${item.id}">${icon("plus")}套用记录</button>
        </article>
      `).join("")}
    </section>
  `;
}

function renderMealPlateGuide() {
  const options = mealPlateOptions();
  return `
    <section class="plate-guide-card">
      <div class="section-title">
        <h2>今日餐盘方案</h2>
        <span>按剩余热量生成</span>
      </div>
      <div class="plate-option-list">
        ${options.map((option) => `
          <article class="plate-option">
            <div>
              <strong>${option.title}</strong>
              <p>${option.subtitle}</p>
              <span>${option.calories} kcal · P${option.protein} C${option.carbs} F${option.fat}</span>
            </div>
            <button class="mini-icon-button" data-plate-option="${option.id}" aria-label="套用${option.title}">${icon("plus")}</button>
          </article>
        `).join("")}
      </div>
    </section>
  `;
}

function weeklyTrainingPlan() {
  const highTarget = (state.weeklyLossTarget || 0.6) >= 0.7;
  const plan = [
    { day: "一", type: "力量塑形", minutes: 38, focus: "上肢推拉", kcal: estimateCalories("力量塑形", 38) },
    { day: "二", type: "燃脂快练", minutes: highTarget ? 28 : 22, focus: "短时高效", kcal: estimateCalories("燃脂快练", highTarget ? 28 : 22) },
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

function appShell() {
  return `
    <main class="phone-shell" aria-live="polite">
      <section class="status-bar">
        <span>22:18</span>
        <span class="sync-pill" data-backend-status data-status="${state.backendStatus}">${backendStatusText()}</span>
        <span class="status-icons">${icon("signal")}${icon("wifi")}${icon("battery")}</span>
      </section>
      ${state.authRequired ? renderLockScreen() : `
        <section class="app-surface">
          ${state.toast ? `<div class="toast-banner">${state.toast}</div>` : ""}
          ${renderCurrentPage()}
        </section>
        <nav class="bottom-nav" aria-label="底部导航">
          ${navItems.map(renderNavItem).join("")}
        </nav>
        ${state.settingsOpen ? renderSettingsPanel() : ""}
      `}
    </main>
  `;
}

function renderLockScreen() {
  return `
    <section class="lock-screen">
      <div class="lock-card">
        <span class="ai-mark">${icon("lock")}</span>
        <h1>访问受保护</h1>
        <p>输入临时访问密码后才能查看和修改数据。</p>
        <label class="field-label">
          <span>访问密码</span>
          <input data-access-password type="password" placeholder="请输入密码" />
        </label>
        ${state.authError ? `<p class="form-error">${state.authError}</p>` : ""}
        <button class="complete-button" data-login>${icon("check")}进入应用</button>
      </div>
    </section>
  `;
}

function renderNavItem(item) {
  const active = state.activeTab === item.key;
  return `
    <button class="nav-item ${active ? "active" : ""}" data-tab="${item.key}" aria-current="${active ? "page" : "false"}">
      ${item.svg}
      <span>${item.label}</span>
    </button>
  `;
}

function renderCurrentPage() {
  const pages = {
    home: renderHome,
    diet: renderDiet,
    training: renderTraining,
    data: renderData,
    profile: renderProfile,
  };
  return pages[state.activeTab]();
}

function pageHeader(title, subtitle, action = "") {
  return `
    <header class="page-header">
      <div>
        <p class="eyebrow">${subtitle}</p>
        <h1>${title}</h1>
      </div>
      ${action}
    </header>
  `;
}

function renderHome() {
  const progress = fatLossProgress();
  const waistRate = waistProgress();
  return `
    ${pageHeader("今日执行", "男性减脂日程", `<button class="icon-button" data-app-action="reminder" aria-label="打开提醒">${icon("bell")}</button>`)}
    <section class="hero-panel">
      <div class="hero-top">
        <div>
          <span class="metric-label">今日体重</span>
          <strong>${state.weight}<small>kg</small></strong>
          <p>目标 ${state.targetWeight}kg · 已完成 ${progress}%</p>
        </div>
        <div class="progress-ring" style="--progress:${progress}">
          <span>${progress}%</span>
        </div>
      </div>
      <div class="weight-rail" aria-label="减脂进度">
        <span style="width:${progress}%"></span>
      </div>
      <div class="hero-chips">
        <span>${icon("flame")}运动 +${customBurned()} kcal</span>
        <span>${icon("spark")}剩余 ${remainingCalories()} kcal</span>
        <span>${icon("level")}腰围 ${waistRate}%</span>
      </div>
    </section>

    <section class="quick-weight-card">
      <div>
        <span class="metric-label">今日称重</span>
        <strong>${state.weight}<small>kg</small></strong>
      </div>
      <label class="field-label">
        <span>录入体重</span>
        <input data-weight-input type="number" min="40" max="200" step="0.1" value="${state.weightDraft || state.weight}" />
      </label>
      <label class="field-label">
        <span>腰围(cm)</span>
        <input data-waist-input type="number" min="50" max="180" step="0.1" value="${state.waistDraft || state.waist}" />
      </label>
      <button class="primary-small" data-save-body>${icon("check")}保存</button>
    </section>

    ${renderSmartCoach()}

    <section class="calorie-grid">
      ${statCard("预算", state.calorieBudget, "kcal", "budget")}
      ${statCard("已摄入", totalIntake(), "kcal", "intake")}
      ${statCard("已消耗", totalBurned(), "kcal", "burned")}
      ${statCard("剩余", remainingCalories(), "kcal", "remain")}
    </section>

    <section class="section-block">
      <div class="section-title">
        <h2>今日任务</h2>
        <span class="streak-pill">${state.streak} 天连续</span>
      </div>
      <div class="task-list">
        ${todayTasks().map(renderTask).join("")}
      </div>
    </section>

    ${renderHabitControls()}
    ${renderDailyReview()}
  `;
}

function renderSmartCoach() {
  const plan = coachPlan();
  return `
    <section class="coach-card">
      <div class="coach-head">
        <span class="ai-mark">${icon("spark")}</span>
        <div>
          <p class="eyebrow">今日策略</p>
          <h2>${plan.focus}</h2>
        </div>
        <strong>${plan.remaining}<small>kcal</small></strong>
      </div>
      <div class="coach-plan-list">
        ${plan.actions.map((item) => `<p>${item}</p>`).join("")}
      </div>
      <div class="coach-risk">
        ${plan.risks.map((item) => `<span>${item}</span>`).join("")}
      </div>
      <div class="coach-actions">
        <button class="outline-button" data-coach-action="diet">${icon("fork")}去补饮食</button>
        <button class="complete-button" data-coach-action="training">${icon("dumbbell")}安排训练</button>
      </div>
    </section>
  `;
}

function renderHabitControls() {
  const waterPercent = Math.min(100, Math.round((state.waterMl / state.waterTarget) * 100));
  const stepsPercent = Math.min(100, Math.round((state.steps / state.stepsTarget) * 100));
  const sleepPercent = Math.min(100, Math.round((state.sleep / 7.5) * 100));
  return `
    <section class="habit-control-card">
      <div class="section-title">
        <h2>快捷补记</h2>
        <span>${waterPercent}% 饮水</span>
      </div>
      ${habitControl("water", "饮水", `${state.waterMl} / ${state.waterTarget}ml`, waterPercent, "water", "+200ml")}
      ${habitControl("steps", "步数", `${state.steps} / ${state.stepsTarget}步`, stepsPercent, "steps", "+1000")}
      ${habitControl("sleep", "睡眠", `${state.sleep} / 7.5h`, sleepPercent, "moon", "+0.5h")}
    </section>
  `;
}

function habitControl(key, label, value, percent, iconName, addLabel) {
  return `
    <article class="habit-control">
      <span class="habit-symbol">${icon(iconName)}</span>
      <div>
        <div class="habit-meta">
          <strong>${label}</strong>
          <small>${value}</small>
        </div>
        <div class="mini-progress"><span style="width:${percent}%"></span></div>
      </div>
      <div class="habit-actions">
        <button class="mini-icon-button" data-habit-step="${key}" data-step-direction="-1" aria-label="减少${label}">${icon("minus")}</button>
        <button class="habit-add-button" data-habit-step="${key}" data-step-direction="1">${addLabel}</button>
      </div>
    </article>
  `;
}

function renderDailyReview() {
  const review = reviewSummary();
  return `
    <section class="daily-review-card">
      <div class="review-score">
        <span>${review.score}</span>
      </div>
      <div>
        <p class="eyebrow">每日复盘</p>
        <h2>${review.title}</h2>
        <p>${review.good.concat(review.todo).slice(0, 3).join(" · ")}</p>
      </div>
    </section>
  `;
}

function renderDiet() {
  const macros = macrosTotal();
  const totalMacro = macros.protein + macros.carbs + macros.fat || 1;
  const advice = aiDietAdvice();
  return `
    ${pageHeader("饮食记录", `今天已记录 ${meals.filter((meal) => meal.calories > 0).length} 餐`, `<button class="primary-small" data-scroll-meal-form>${icon("plus")}添加</button>`)}
    <section class="ai-card">
      <div class="ai-card-head">
        <span class="ai-mark">${icon("spark")}</span>
        <div>
          <p class="eyebrow">AI 饮食建议</p>
          <h2>按今天饮食动态推荐</h2>
        </div>
      </div>
      <div class="ai-advice-list">
        ${advice.map((item) => `<p>${item}</p>`).join("")}
      </div>
    </section>

    <section class="meal-capture-panel">
      <button class="capture-action" data-app-action="photo">
        ${icon("camera")}
        <span>拍照识别</span>
      </button>
      <button class="capture-action primary" data-scroll-meal-form>
        ${icon("fork")}
        <span>输入食物</span>
      </button>
    </section>

    ${renderDietScenarioGuide()}
    ${renderMealPlateGuide()}

    <section class="meal-form-card" id="meal-form">
      <div class="section-title">
        <h2>添加饮食</h2>
        <span>${state.mealDraft.calories} kcal</span>
      </div>
      <div class="form-grid">
        <label class="field-label">
          <span>餐次</span>
          <select data-meal-slot>
            ${meals.map((meal) => `<option value="${meal.id}" ${state.mealDraft.slot === meal.id ? "selected" : ""}>${meal.name}</option>`).join("")}
          </select>
        </label>
        <label class="field-label">
          <span>热量</span>
          <input data-meal-calories type="number" min="0" max="1800" step="10" value="${state.mealDraft.calories}" />
        </label>
      </div>
      <label class="field-label">
        <span>食物内容</span>
        <input data-meal-food type="text" maxlength="28" placeholder="例如：牛肉饭、蔬菜、无糖酸奶" value="${escapeHtml(state.mealDraft.food)}" />
      </label>
      <div class="ai-context-grid">
        <label class="field-label">
          <span>总量</span>
          <input data-meal-amount type="number" min="0" max="2000" step="10" value="${state.mealDraft.amount}" />
        </label>
        <label class="field-label">
          <span>单位</span>
          <select data-meal-unit>
            ${["g", "份", "碗", "个", "杯"].map((unit) => `<option value="${unit}" ${state.mealDraft.unit === unit ? "selected" : ""}>${unit}</option>`).join("")}
          </select>
        </label>
        <label class="field-label">
          <span>做法</span>
          <select data-meal-cooking>
            ${["清淡", "水煮", "蒸", "烤", "炒", "煎", "油炸"].map((item) => `<option value="${item}" ${state.mealDraft.cooking === item ? "selected" : ""}>${item}</option>`).join("")}
          </select>
        </label>
      </div>
      <div class="ai-context-grid two">
        <label class="field-label">
          <span>用油(g)</span>
          <input data-meal-oil type="number" min="0" max="80" step="1" value="${state.mealDraft.oilGrams}" />
        </label>
        <label class="field-label">
          <span>酱料</span>
          <select data-meal-sauce>
            ${["无", "少", "中", "多"].map((item) => `<option value="${item}" ${state.mealDraft.sauce === item ? "selected" : ""}>${item}</option>`).join("")}
          </select>
        </label>
      </div>
      <button class="ai-recognize-button" data-ai-nutrition ${state.mealDraft.aiLoading ? "disabled" : ""}>
        ${icon("spark")}${state.mealDraft.aiLoading ? "识别中..." : "AI识别营养"}
      </button>
      ${state.mealDraft.aiResult ? renderNutritionResult(state.mealDraft.aiResult) : ""}
      <div class="macro-input-grid">
        <label class="field-label">
          <span>蛋白</span>
          <input data-meal-protein type="number" min="0" max="160" value="${state.mealDraft.protein}" />
        </label>
        <label class="field-label">
          <span>碳水</span>
          <input data-meal-carbs type="number" min="0" max="220" value="${state.mealDraft.carbs}" />
        </label>
        <label class="field-label">
          <span>脂肪</span>
          <input data-meal-fat type="number" min="0" max="120" value="${state.mealDraft.fat}" />
        </label>
      </div>
      <div class="meal-action-grid">
        <button class="outline-button" data-save-template>${icon("medal")}存为常用餐</button>
        <button class="complete-button" data-add-meal>${icon("plus")}保存到餐次</button>
      </div>
    </section>

    <section class="protein-card">
      <div>
        <span class="metric-label">蛋白质目标</span>
        <strong>${macros.protein}<small> / ${state.proteinTarget}g</small></strong>
      </div>
      <div class="inline-progress"><span style="width:${Math.min(100, Math.round((macros.protein / state.proteinTarget) * 100))}%"></span></div>
    </section>

    <section class="macro-panel">
      ${macroItem("碳水", macros.carbs, totalMacro, "carb")}
      ${macroItem("脂肪", macros.fat, totalMacro, "fat")}
      ${macroItem("蛋白", macros.protein, totalMacro, "protein")}
    </section>

    <section class="section-block compact-block">
      <div class="section-title">
        <h2>常用餐</h2>
        <span>${state.mealTemplates.length} 个</span>
      </div>
      <div class="template-list">
        ${state.mealTemplates.map(renderMealTemplate).join("")}
      </div>
    </section>

    <section class="section-block">
      <div class="section-title">
        <h2>每日餐次</h2>
        <span>${totalIntake()} kcal</span>
      </div>
      <div class="meal-list">
        ${meals.map(renderMeal).join("")}
      </div>
    </section>
  `;
}

function renderTraining() {
  const draftKcal = estimateCalories(state.activityDraft.type, state.activityDraft.minutes);
  const todayPlan = todayPlanWorkout();
  return `
    ${pageHeader("训练", "记录运动并汇总消耗", `<button class="ghost-small" data-app-action="history">历史</button>`)}
    <section class="activity-form-card">
      <div class="section-title">
        <h2>添加运动</h2>
        <span data-activity-estimate>预估 ${draftKcal} kcal</span>
      </div>
      <label class="field-label">
        <span>运动名称</span>
        <input data-activity-name type="text" maxlength="12" placeholder="例如：快走、游泳、篮球" value="${escapeHtml(state.activityDraft.name)}" />
      </label>
      <div class="form-grid">
        <label class="field-label">
          <span>类型</span>
          <select data-activity-type>
            ${Object.entries(activityTypes).map(([type, info]) => `<option value="${type}" ${state.activityDraft.type === type ? "selected" : ""}>${type} · ${info.hint}</option>`).join("")}
          </select>
        </label>
        <label class="field-label">
          <span>时间</span>
          <input data-activity-minutes type="number" min="5" max="180" step="5" value="${state.activityDraft.minutes}" />
        </label>
      </div>
      <button class="complete-button" data-add-activity>${icon("plus")}加入今日消耗</button>
    </section>

    ${renderWeekTrainingPlan()}

    <section class="workout-hero compact">
      <span class="tag">推荐</span>
      <h2>20 分钟全身燃脂循环</h2>
      <p>低器械、可在家完成，适合今天的热量赤字目标。</p>
      <div class="workout-meta">
        <span>${icon("timer")}20 分钟</span>
        <span>${icon("flame")}230 kcal</span>
        <span>${icon("level")}中等</span>
      </div>
      <button class="complete-button" data-complete-workout>${icon("check")}${state.workoutDone ? "已完成打卡" : "完成打卡"}</button>
    </section>

    <section class="section-block">
      <div class="section-title">
        <h2>今日运动记录</h2>
        <span>${customBurned()} kcal</span>
      </div>
      <div class="activity-list">
        ${state.customActivities.length ? state.customActivities.map(renderActivity).join("") : renderEmptyState()}
      </div>
    </section>

    <section class="section-block">
      <div class="section-title">
        <h2>训练类型</h2>
        <span>5 项</span>
      </div>
      <div class="workout-list">
        ${workouts.map(renderWorkout).join("")}
      </div>
    </section>
  `;
}

function renderWeekTrainingPlan() {
  const plan = weeklyTrainingPlan();
  const totalMinutes = plan.reduce((sum, item) => sum + item.minutes, 0);
  return `
    <section class="week-plan-card">
      <div class="section-title">
        <h2>本周训练安排</h2>
        <span>${totalMinutes} 分钟</span>
      </div>
      <div class="week-plan-list">
        ${plan.map((item) => `
          <article class="week-plan-item ${item.today ? "today" : ""}">
            <span>周${item.day}</span>
            <div>
              <strong>${item.type}</strong>
              <p>${item.focus} · ${item.minutes} 分钟 · ${item.kcal} kcal</p>
            </div>
            ${item.today ? `<button class="mini-icon-button" data-apply-today-plan aria-label="套用今日训练">${icon("plus")}</button>` : ""}
          </article>
        `).join("")}
      </div>
    </section>
  `;
}

function trendInsight(weights, deficitSeries, burnedSeries) {
  const weightDelta = Number((weights.at(-1) - weights[0]).toFixed(1));
  const avgDeficit = Math.round(avg(deficitSeries));
  const avgBurned = Math.round(avg(burnedSeries));
  const completion = Math.round(avg(chartData.completion));
  const items = [];

  if (weightDelta <= -0.6) items.push("体重下降速度较好，继续保持当前热量赤字。");
  else if (weightDelta < 0) items.push("体重在下降，但速度偏慢，优先检查晚餐和周末加餐。");
  else items.push("体重未明显下降，建议连续 3 天完整记录饮食。");

  if (avgDeficit < 350) items.push("平均赤字偏低，把每日剩余热量稳定在 400 kcal 左右。");
  else items.push("平均赤字可用，注意不要用低摄入换短期数字。");

  if (avgBurned < 250) items.push("运动消耗偏少，本周增加 2 次 30 分钟有氧。");
  if (completion < 75) items.push("任务完成率还有空间，先保证喝水、步数和饮食记录。");

  return {
    title: weightDelta <= -0.6 ? "趋势健康" : weightDelta < 0 ? "稳中偏慢" : "需要校准",
    weightDelta,
    avgDeficit,
    avgBurned,
    completion,
    items: items.slice(0, 4),
  };
}

function renderTrendCoach(weights, deficitSeries, burnedSeries) {
  const insight = trendInsight(weights, deficitSeries, burnedSeries);
  return `
    <section class="trend-coach-card">
      <div class="section-title">
        <h2>趋势解读</h2>
        <span>${insight.title}</span>
      </div>
      <div class="trend-metric-row">
        ${miniMetric("7天体重", insight.weightDelta, "kg")}
        ${miniMetric("平均赤字", insight.avgDeficit, "kcal")}
        ${miniMetric("完成率", insight.completion, "%")}
      </div>
      <div class="insight-list">
        ${insight.items.map((item) => `<p>${item}</p>`).join("")}
      </div>
    </section>
  `;
}

function weeklyActionPlan(weights, deficitSeries, burnedSeries) {
  const insight = trendInsight(weights, deficitSeries, burnedSeries);
  const waists = waistSeries();
  const waistDelta = waists.length > 1 ? Number((waists.at(-1) - waists[0]).toFixed(1)) : 0;
  const actions = [];

  if (insight.avgBurned < 280) {
    actions.push({
      id: "more-cardio",
      title: "增加有氧",
      meta: "下周 +2 次 30 分钟",
      detail: "把快走、椭圆机或慢跑安排到工作日晚上，优先补足运动消耗。",
      target: "training",
    });
  }

  if (insight.avgDeficit < 380 || insight.weightDelta > -0.3) {
    actions.push({
      id: "tighten-dinner",
      title: "收紧晚餐",
      meta: "晚餐 520 kcal 内",
      detail: "主食半份，蛋白足量，减少油脂和酱料，先连续执行 3 天。",
      target: "diet",
    });
  }

  if (insight.completion < 80) {
    actions.push({
      id: "habit-floor",
      title: "降低执行门槛",
      meta: "每天只守 3 件事",
      detail: "饮食记录、饮水、步数先稳定，训练可以用低冲击有氧替代。",
      target: "home",
    });
  }

  if (waistDelta > -0.8) {
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

function renderWeeklyActionPlan(weights, deficitSeries, burnedSeries) {
  const actions = weeklyActionPlan(weights, deficitSeries, burnedSeries);
  return `
    <section class="weekly-action-card">
      <div class="section-title">
        <h2>下周调整计划</h2>
        <span>${actions.length} 项</span>
      </div>
      <div class="weekly-action-list">
        ${actions.map((action) => `
          <article class="weekly-action-item">
            <div>
              <strong>${action.title}</strong>
              <span>${action.meta}</span>
              <p>${action.detail}</p>
            </div>
            <button class="mini-icon-button" data-week-action="${action.target}" aria-label="执行${action.title}">${icon("arrow")}</button>
          </article>
        `).join("")}
      </div>
    </section>
  `;
}

function renderData() {
  const burnedSeries = [...chartData.burned.slice(0, -1), totalBurned()];
  const deficitSeries = [...chartData.deficit.slice(0, -1), Math.max(0, remainingCalories() + 140)];
  const weights = weightSeries();
  const waists = waistSeries();
  return `
    ${pageHeader("数据", "7 天趋势复盘", `<button class="ghost-small" data-app-action="week">本周</button>`)}
    <section class="data-summary">
      ${miniMetric("今日消耗", totalBurned(), "kcal")}
      ${miniMetric("自定义运动", customBurned(), "kcal")}
      ${miniMetric("热量赤字", deficitSeries.at(-1), "kcal")}
    </section>

    ${renderTrendCoach(weights, deficitSeries, burnedSeries)}
    ${renderWeeklyActionPlan(weights, deficitSeries, burnedSeries)}

    <section class="chart-card wide">
      <div class="section-title">
        <h2>体重趋势</h2>
        <span>${(weights.at(-1) - weights[0]).toFixed(1)}kg</span>
      </div>
      ${lineChart(weights)}
    </section>

    ${waists.length ? `
      <section class="chart-card wide">
        <div class="section-title">
          <h2>腰围趋势</h2>
          <span>${(waists.at(-1) - waists[0]).toFixed(1)}cm</span>
        </div>
        ${lineChart(waists)}
      </section>
    ` : ""}

    <div class="two-chart-grid">
      ${barCard("热量赤字", deficitSeries, "kcal")}
      ${barCard("运动消耗", burnedSeries, "kcal")}
    </div>

    <section class="section-block">
      <div class="section-title">
        <h2>本周任务完成率</h2>
        <span>${Math.round(avg(chartData.completion))}%</span>
      </div>
      <div class="completion-row">
        ${chartData.completion.map((value, index) => `<span style="height:${value}%"><i>${["一", "二", "三", "四", "五", "六", "日"][index]}</i></span>`).join("")}
      </div>
    </section>

    <section class="record-grid">
      ${record("连续打卡", `${state.streak} 天`)}
      ${record("最好记录", `${state.bestStreak} 天`)}
    </section>
  `;
}

function renderCalorieRecommendation() {
  const recommendation = calorieRecommendation();
  const diffText = recommendation.diff > 0 ? `+${recommendation.diff}` : `${recommendation.diff}`;
  return `
    <section class="recommend-card">
      <div>
        <p class="eyebrow">热量预算建议</p>
        <h2>${recommendation.label}</h2>
        <p>${recommendation.note}</p>
      </div>
      <div class="recommend-numbers">
        <article>
          <span>估算维持</span>
          <strong>${recommendation.tdee}<small>kcal</small></strong>
        </article>
        <article>
          <span>建议预算</span>
          <strong>${recommendation.suggested}<small>kcal</small></strong>
        </article>
      </div>
      <button class="outline-button" data-apply-calorie>${icon("check")}应用 ${diffText} kcal 调整</button>
    </section>
  `;
}

function renderHealthGuardrails() {
  const items = healthGuardrails();
  const hasWarning = items.some((item) => item.tone === "warn");
  return `
    <section class="guardrail-card">
      <div class="section-title">
        <h2>健康边界</h2>
        <span>${hasWarning ? "需要留意" : "当前稳定"}</span>
      </div>
      <div class="guardrail-list">
        ${items.map((item) => `
          <article class="guardrail-item ${item.tone}">
            <div>
              <strong>${item.label}</strong>
              <p>${item.note}</p>
            </div>
            <span>${item.value}<small>${item.status}</small></span>
          </article>
        `).join("")}
      </div>
      <button class="outline-button" data-app-action="goal">${icon("settings")}调整目标参数</button>
    </section>
  `;
}

function renderProfile() {
  return `
    ${pageHeader("我的", "基础信息与目标", `<button class="icon-button" data-app-action="settings" aria-label="设置">${icon("settings")}</button>`)}
    <section class="profile-card">
      <div class="avatar">稳</div>
      <div>
        <h2>普通男性减脂计划</h2>
        <p>${state.user.age} 岁 · ${state.user.height}cm · 当前 ${state.weight}kg</p>
      </div>
    </section>

    <section class="body-grid">
      ${statCard("BMI", bmi(), "", "budget")}
      ${statCard("基础代谢", state.user.bmr, "kcal", "intake")}
      ${statCard("推荐热量", state.user.dailyCalories, "kcal", "remain")}
      ${statCard("腰围目标", state.targetWaist, "cm", "burned")}
    </section>

    ${renderHealthGuardrails()}

    ${renderCalorieRecommendation()}

    <section class="goal-card">
      <div class="section-title">
        <h2>目标设置</h2>
        <span>每周 -${state.weeklyLossTarget}kg</span>
      </div>
      <div class="goal-row">
        <span>减脂进度</span>
        <div class="inline-progress"><span style="width:${fatLossProgress()}%"></span></div>
      </div>
      <div class="goal-row">
        <span>腰围进度</span>
        <div class="inline-progress"><span style="width:${waistProgress()}%"></span></div>
      </div>
      <div class="goal-row">
        <span>预计达成</span>
        <strong>${targetEta()}</strong>
      </div>
      <button class="outline-button" data-app-action="goal">调整目标</button>
    </section>

    <section class="section-block">
      <div class="section-title">
        <h2>成就徽章</h2>
        <span>4 / 8</span>
      </div>
      <div class="badge-grid">
        ${["连续 7 天", "蛋白达标", "晨间称重", "稳定赤字", "力量入门", "早睡挑战"].map((badge, index) => `
          <div class="badge ${index > 3 ? "locked" : ""}">
            ${icon(index > 3 ? "lock" : "medal")}
            <span>${badge}</span>
          </div>
        `).join("")}
      </div>
    </section>
  `;
}

function renderSettingsPanel() {
  return `
    <section class="settings-scrim" data-close-settings></section>
    <section class="settings-sheet" role="dialog" aria-label="设置">
      <div class="sheet-handle"></div>
      <div class="section-title">
        <h2>设置</h2>
        <button class="mini-icon-button" data-close-settings aria-label="关闭设置">${icon("plus")}</button>
      </div>
      <div class="settings-group">
        <h3>基础信息</h3>
        <div class="settings-grid">
          <label class="field-label">
            <span>身高(cm)</span>
            <input data-setting-height type="number" min="120" max="230" value="${state.user.height}" />
          </label>
          <label class="field-label">
            <span>当前体重(kg)</span>
            <input data-setting-weight type="number" min="40" max="200" step="0.1" value="${state.weight}" />
          </label>
          <label class="field-label">
            <span>当前腰围(cm)</span>
            <input data-setting-waist type="number" min="50" max="180" step="0.1" value="${state.waist}" />
          </label>
          <label class="field-label">
            <span>年龄</span>
            <input data-setting-age type="number" min="16" max="80" value="${state.user.age}" />
          </label>
          <label class="field-label">
            <span>目标体重(kg)</span>
            <input data-setting-target type="number" min="40" max="180" step="0.1" value="${state.targetWeight}" />
          </label>
          <label class="field-label">
            <span>目标腰围(cm)</span>
            <input data-setting-target-waist type="number" min="50" max="160" step="0.1" value="${state.targetWaist}" />
          </label>
          <label class="field-label">
            <span>每周目标(kg)</span>
            <input data-setting-weekly type="number" min="0.1" max="1.2" step="0.1" value="${state.weeklyLossTarget}" />
          </label>
        </div>
      </div>
      <div class="settings-group">
        <h3>目标与偏好</h3>
        <div class="settings-grid">
          <label class="field-label">
            <span>推荐热量</span>
            <input data-setting-calories type="number" min="1200" max="3600" step="10" value="${state.user.dailyCalories}" />
          </label>
          <label class="field-label">
            <span>提醒时间</span>
            <input data-setting-reminder type="time" value="${state.preferences.reminderTime}" />
          </label>
          <label class="field-label">
            <span>单位</span>
            <select data-setting-unit>
              <option value="metric" ${state.preferences.unit === "metric" ? "selected" : ""}>公制 kg/cm</option>
              <option value="imperial" ${state.preferences.unit === "imperial" ? "selected" : ""}>英制 lb/in</option>
            </select>
          </label>
          <label class="field-label">
            <span>AI 辅助</span>
            <select data-setting-ai>
              <option value="on" ${state.preferences.aiAssist ? "selected" : ""}>开启</option>
              <option value="off" ${!state.preferences.aiAssist ? "selected" : ""}>关闭</option>
            </select>
          </label>
        </div>
        <label class="toggle-row">
          <span>每日提醒推送</span>
          <input data-setting-push type="checkbox" ${state.preferences.pushEnabled ? "checked" : ""} />
        </label>
      </div>
      <button class="complete-button" data-save-settings>${icon("check")}保存设置</button>
    </section>
  `;
}

function statCard(label, value, unit, tone) {
  return `
    <article class="stat-card ${tone}">
      <span>${label}</span>
      <strong>${value}<small>${unit}</small></strong>
    </article>
  `;
}

function miniMetric(label, value, unit) {
  return `
    <article>
      <span>${label}</span>
      <strong>${value}<small>${unit}</small></strong>
    </article>
  `;
}

function renderTask(task) {
  return `
    <article class="task-item ${task.done ? "done" : ""}">
      <span class="task-icon">${task.icon}</span>
      <div>
        <strong>${task.label}</strong>
        <p>${task.value}</p>
      </div>
      <button class="check-button" data-toggle-task="${task.label}" aria-label="${task.label}${task.done ? "已完成" : "未完成"}">${task.done ? icon("check") : ""}</button>
    </article>
  `;
}

function macroItem(label, value, total, tone) {
  const percent = Math.round((value / total) * 100);
  return `
    <article class="macro-item ${tone}">
      <span>${label}</span>
      <strong>${percent}%</strong>
      <div class="inline-progress"><span style="width:${percent}%"></span></div>
    </article>
  `;
}

function renderMeal(meal) {
  const empty = meal.calories === 0;
  return `
    <article class="meal-card ${empty ? "empty" : ""}">
      <div class="meal-head">
        <div>
          <h3>${meal.name}</h3>
          <span>${meal.status}</span>
        </div>
        <strong>${empty ? "--" : meal.calories}<small>kcal</small></strong>
      </div>
      ${empty ? `<button class="outline-button" data-record-meal="${meal.id}">${icon("plus")}记录${meal.name}</button>` : `
        <p>${meal.foods.join(" · ")}</p>
        <div class="macro-tags">
          <span>P ${meal.macros.protein}g</span>
          <span>C ${meal.macros.carbs}g</span>
          <span>F ${meal.macros.fat}g</span>
        </div>
      `}
    </article>
  `;
}

function renderMealTemplate(template) {
  return `
    <article class="template-chip">
      <div>
        <strong>${template.name}</strong>
        <span>${template.calories} kcal · P${template.protein} C${template.carbs} F${template.fat}</span>
      </div>
      <button class="mini-icon-button" data-use-template="${template.id}" aria-label="使用${template.name}">${icon("plus")}</button>
    </article>
  `;
}

function renderNutritionResult(result) {
  return `
    <div class="nutrition-result">
      <div>
        <span>AI 预估</span>
        <strong>${result.calories}<small>kcal</small></strong>
      </div>
      <p>P ${result.protein}g · C ${result.carbs}g · F ${result.fat}g</p>
      ${Array.isArray(result.details) && result.details.length ? `
        <div class="nutrition-detail-list">
          ${result.details.map((item) => `
            <span>${item.name} ${item.grams}g · ${item.calories}kcal · P${item.protein}/C${item.carbs}/F${item.fat}</span>
          `).join("")}
        </div>
      ` : ""}
      <small>${result.context ? `按 ${result.context.amount || "--"}${result.context.unit} · ${result.context.cooking} · 用油 ${result.context.oilGrams}g · 酱料${result.context.sauce} 修正` : "已根据食物内容自动估算，可手动微调。"}</small>
      <small>${result.note || "已根据食物内容自动估算，可手动微调。"}</small>
    </div>
  `;
}

function renderActivity(item) {
  return `
    <article class="activity-item">
      <span class="activity-icon">${icon("flame")}</span>
      <div>
        <h3>${item.name}</h3>
        <p>${item.type} · ${item.minutes} 分钟 · ${item.createdAt}</p>
      </div>
      <strong>${item.kcal}<small>kcal</small></strong>
      <button class="mini-icon-button" data-delete-activity="${item.id}" aria-label="删除${item.name}">${icon("trash")}</button>
    </article>
  `;
}

function renderEmptyState() {
  return `
    <div class="empty-state">
      ${icon("dumbbell")}
      <p>还没有记录运动。添加一次运动后，首页与数据页会自动汇总消耗。</p>
    </div>
  `;
}

function renderWorkout(workout) {
  const selected = state.activityDraft.type === workout.type;
  return `
    <article class="workout-item ${selected ? "selected" : ""}">
      <div>
        <span>${workout.type}</span>
        <h3>${workout.name}</h3>
        <p>${workout.minutes} 分钟 · ${workout.level} · 预计 ${workout.kcal} kcal</p>
      </div>
      <button class="${selected ? "check-button checked" : "icon-button"}" data-select-workout="${workout.type}" aria-label="选择${workout.type}">
        ${selected ? icon("check") : icon("arrow")}
      </button>
    </article>
  `;
}

function barCard(title, values, unit) {
  return `
    <section class="chart-card">
      <div class="section-title">
        <h2>${title}</h2>
        <span>${Math.round(avg(values))} ${unit}</span>
      </div>
      <div class="mini-bars">
        ${values.map((value) => `<span style="height:${Math.max(10, (value / Math.max(...values)) * 100)}%"></span>`).join("")}
      </div>
    </section>
  `;
}

function lineChart(values) {
  const width = 300;
  const height = 132;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * width;
    const y = height - ((value - min) / (max - min || 1)) * (height - 28) - 14;
    return `${x},${y}`;
  }).join(" ");
  return `
    <svg class="line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="体重趋势折线图">
      <defs>
        <linearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="#28a86b" stop-opacity="0.22" />
          <stop offset="100%" stop-color="#28a86b" stop-opacity="0" />
        </linearGradient>
      </defs>
      <polyline points="0,${height} ${points} ${width},${height}" fill="url(#chartFill)" stroke="none"></polyline>
      <polyline points="${points}" fill="none" stroke="#28a86b" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"></polyline>
      ${values.map((value, index) => {
        const [x, y] = points.split(" ")[index].split(",");
        return `<circle cx="${x}" cy="${y}" r="4.5" fill="#ffffff" stroke="#28a86b" stroke-width="3"><title>${value}kg</title></circle>`;
      }).join("")}
    </svg>
  `;
}

function record(label, value) {
  return `<article class="record-card"><span>${label}</span><strong>${value}</strong></article>`;
}

function avg(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[char]));
}

function icon(name) {
  const paths = {
    home: `<path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z"/>`,
    fork: `<path d="M6 3v8M10 3v8M6 7h4M8 11v10M17 3v18M17 3c3 2 4 6 0 9"/>`,
    dumbbell: `<path d="M4 9v6M8 7v10M16 7v10M20 9v6M8 12h8"/>`,
    chart: `<path d="M4 19V5M4 19h17M8 15l3-4 3 2 5-7"/>`,
    user: `<path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21a8 8 0 0 1 16 0"/>`,
    bell: `<path d="M18 9a6 6 0 1 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>`,
    camera: `<path d="M4 7h3l2-3h6l2 3h3v13H4z"/><circle cx="12" cy="13" r="4"/>`,
    signal: `<path d="M4 18h2M9 18h2v-5H9zM14 18h2V9h-2zM19 18h2V5h-2z"/>`,
    wifi: `<path d="M5 10a11 11 0 0 1 14 0M8 14a6 6 0 0 1 8 0M12 18h.01"/>`,
    battery: `<path d="M4 8h15v8H4zM21 11v2M7 11h8v2H7z"/>`,
    water: `<path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11Z"/>`,
    steps: `<path d="M7 21c-2 0-3-1-3-3 0-3 3-5 5-3 2 3 1 6-2 6ZM17 12c-2 0-3-1-3-3 0-3 3-5 5-3 2 3 1 6-2 6Z"/>`,
    moon: `<path d="M20 15.5A8 8 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5Z"/>`,
    plus: `<path d="M12 5v14M5 12h14"/>`,
    minus: `<path d="M5 12h14"/>`,
    spark: `<path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8z"/>`,
    timer: `<path d="M10 2h4M12 8v5l3 2M12 22a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z"/>`,
    flame: `<path d="M12 22c4 0 7-3 7-7 0-5-5-7-5-12-5 3-9 8-9 12 0 4 3 7 7 7Z"/>`,
    level: `<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>`,
    check: `<path d="m5 12 4 4L19 6"/>`,
    arrow: `<path d="M9 18l6-6-6-6"/>`,
    settings: `<path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.5-2.4 1a7 7 0 0 0-1.7-1L14.5 3h-5l-.3 3a7 7 0 0 0-1.7 1l-2.4-1-2 3.5L5.1 11a7 7 0 0 0 0 2l-2 1.5 2 3.5 2.4-1a7 7 0 0 0 1.7 1l.3 3h5l.3-3a7 7 0 0 0 1.7-1l2.4 1 2-3.5-2-1.5c.1-.3.1-.7.1-1Z"/>`,
    medal: `<path d="M8 3h8l-2 5h-4zM12 21a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z"/><path d="m10.5 15 1 1 2-2"/>`,
    lock: `<path d="M7 11V8a5 5 0 0 1 10 0v3M6 11h12v10H6z"/>`,
    trash: `<path d="M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3"/>`,
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.home}</svg>`;
}

function addMealDraft() {
  const target = meals.find((meal) => meal.id === state.mealDraft.slot) || meals[0];
  const food = state.mealDraft.food.trim() || `${target.name}记录`;
  const calories = Math.max(0, Number(state.mealDraft.calories || 0));
  const macros = {
    protein: Math.max(0, Number(state.mealDraft.protein || 0)),
    carbs: Math.max(0, Number(state.mealDraft.carbs || 0)),
    fat: Math.max(0, Number(state.mealDraft.fat || 0)),
  };

  target.calories = calories;
  target.status = "已记录";
  target.foods = food.split(/[，,]/).map((item) => item.trim()).filter(Boolean);
  target.macros = macros;
  state.mealDraft.food = "";
  state.mealDraft.aiResult = null;
  saveStoredState();
}

function saveCurrentMealAsTemplate() {
  updateMealDraftFromForm();
  const food = state.mealDraft.food.trim();
  if (!food) {
    showToast("请先填写食物内容");
    return;
  }
  const name = food.split(/[，,、+和]/)[0].slice(0, 8) || "常用餐";
  state.mealTemplates.unshift({
    id: Date.now(),
    name,
    food,
    calories: Math.max(0, Number(state.mealDraft.calories || 0)),
    protein: Math.max(0, Number(state.mealDraft.protein || 0)),
    carbs: Math.max(0, Number(state.mealDraft.carbs || 0)),
    fat: Math.max(0, Number(state.mealDraft.fat || 0)),
  });
  state.mealTemplates = state.mealTemplates.slice(0, 8);
  saveStoredState();
  showToast("已保存为常用餐");
}

function useMealTemplate(id) {
  const template = state.mealTemplates.find((item) => String(item.id) === String(id));
  if (!template) return;
  state.mealDraft.food = template.food;
  state.mealDraft.calories = template.calories;
  state.mealDraft.protein = template.protein;
  state.mealDraft.carbs = template.carbs;
  state.mealDraft.fat = template.fat;
  state.mealDraft.aiResult = null;
  saveStoredState();
  render();
  setTimeout(() => scrollSurfaceTo("#meal-form"), 0);
}

function applyMealPlateOption(id) {
  const option = mealPlateOptions().find((item) => item.id === id);
  if (!option) return;
  state.mealDraft.slot = option.slot;
  state.mealDraft.food = option.food;
  state.mealDraft.amount = option.amount;
  state.mealDraft.unit = "g";
  state.mealDraft.cooking = "清淡";
  state.mealDraft.oilGrams = 5;
  state.mealDraft.sauce = "少";
  state.mealDraft.calories = option.calories;
  state.mealDraft.protein = option.protein;
  state.mealDraft.carbs = option.carbs;
  state.mealDraft.fat = option.fat;
  state.mealDraft.aiResult = {
    calories: option.calories,
    protein: option.protein,
    carbs: option.carbs,
    fat: option.fat,
    confidence: 0.78,
    details: [],
    context: { amount: option.amount, unit: "g", cooking: "清淡", oilGrams: 5, sauce: "少" },
    note: "已按今日剩余热量和蛋白缺口生成，可继续手动微调。",
  };
  saveStoredState();
  showToast("已套用餐盘方案");
  render();
  setTimeout(() => scrollSurfaceTo("#meal-form"), 0);
}

function selectDietScenario(id) {
  if (!dietScenarios().some((item) => item.id === id)) return;
  state.dietScenario = id;
  saveStoredState();
  render();
}

function applyDietScenario(id) {
  const scenario = dietScenarios().find((item) => item.id === id);
  if (!scenario) return;
  const draft = scenario.draft;
  state.mealDraft.slot = draft.slot;
  state.mealDraft.food = draft.food;
  state.mealDraft.amount = draft.amount;
  state.mealDraft.unit = "g";
  state.mealDraft.cooking = draft.cooking;
  state.mealDraft.oilGrams = draft.oilGrams;
  state.mealDraft.sauce = draft.sauce;
  state.mealDraft.calories = draft.calories;
  state.mealDraft.protein = draft.protein;
  state.mealDraft.carbs = draft.carbs;
  state.mealDraft.fat = draft.fat;
  state.mealDraft.aiResult = {
    calories: draft.calories,
    protein: draft.protein,
    carbs: draft.carbs,
    fat: draft.fat,
    confidence: 0.74,
    details: [],
    context: { amount: draft.amount, unit: "g", cooking: draft.cooking, oilGrams: draft.oilGrams, sauce: draft.sauce },
    note: `已按${scenario.title}场景生成，建议根据实际份量微调。`,
  };
  saveStoredState();
  showToast(`已套用${scenario.title}策略`);
  render();
  setTimeout(() => scrollSurfaceTo("#meal-form"), 0);
}

function updateMealDraftFromForm() {
  const draft = state.mealDraft;
  draft.slot = document.querySelector("[data-meal-slot]")?.value || draft.slot;
  draft.food = document.querySelector("[data-meal-food]")?.value || "";
  draft.amount = Number(document.querySelector("[data-meal-amount]")?.value || 0);
  draft.unit = document.querySelector("[data-meal-unit]")?.value || "g";
  draft.cooking = document.querySelector("[data-meal-cooking]")?.value || "清淡";
  draft.oilGrams = Number(document.querySelector("[data-meal-oil]")?.value || 0);
  draft.sauce = document.querySelector("[data-meal-sauce]")?.value || "少";
  draft.calories = Number(document.querySelector("[data-meal-calories]")?.value || 0);
  draft.protein = Number(document.querySelector("[data-meal-protein]")?.value || 0);
  draft.carbs = Number(document.querySelector("[data-meal-carbs]")?.value || 0);
  draft.fat = Number(document.querySelector("[data-meal-fat]")?.value || 0);
}

async function recognizeMealNutrition() {
  updateMealDraftFromForm();
  if (!state.mealDraft.food.trim()) {
    showToast("请先填写食物内容，再进行 AI 识别");
    return;
  }

  state.mealDraft.aiLoading = true;
  render();
  try {
    const response = await fetch(API_NUTRITION_URL, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        foodText: state.mealDraft.food,
        context: {
          amount: state.mealDraft.amount,
          unit: state.mealDraft.unit,
          cooking: state.mealDraft.cooking,
          oilGrams: state.mealDraft.oilGrams,
          sauce: state.mealDraft.sauce,
        },
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "AI 识别失败");

    state.mealDraft.calories = result.calories;
    state.mealDraft.protein = result.protein;
    state.mealDraft.carbs = result.carbs;
    state.mealDraft.fat = result.fat;
    state.mealDraft.aiResult = result;
    showToast("AI 已识别并填入营养数据");
    saveStoredState();
  } catch (error) {
    showToast(error.message || "AI 识别暂时不可用");
  } finally {
    state.mealDraft.aiLoading = false;
    render();
    setTimeout(() => scrollSurfaceTo("#meal-form"), 0);
  }
}

function showToast(message) {
  state.toast = message;
  render();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    state.toast = "";
    render();
  }, 1600);
}

function scrollSurfaceTo(selector) {
  document.querySelector(selector)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function adjustHabitMetric(key, direction) {
  if (key === "water") {
    state.waterMl = Math.min(5000, Math.max(0, state.waterMl + direction * 200));
  }
  if (key === "steps") {
    state.steps = Math.min(30000, Math.max(0, state.steps + direction * 1000));
  }
  if (key === "sleep") {
    state.sleep = Number(Math.min(12, Math.max(0, state.sleep + direction * 0.5)).toFixed(1));
  }
  saveStoredState();
  render();
}

function saveSettingsFromForm() {
  state.user.height = Number(document.querySelector("[data-setting-height]")?.value || state.user.height);
  state.weight = Number(document.querySelector("[data-setting-weight]")?.value || state.weight);
  state.waist = Number(document.querySelector("[data-setting-waist]")?.value || state.waist);
  state.user.age = Number(document.querySelector("[data-setting-age]")?.value || state.user.age);
  state.targetWeight = Number(document.querySelector("[data-setting-target]")?.value || state.targetWeight);
  state.targetWaist = Number(document.querySelector("[data-setting-target-waist]")?.value || state.targetWaist);
  state.weeklyLossTarget = Math.min(1.2, Math.max(0.1, Number(document.querySelector("[data-setting-weekly]")?.value || state.weeklyLossTarget)));
  state.user.dailyCalories = Number(document.querySelector("[data-setting-calories]")?.value || state.user.dailyCalories);
  state.calorieBudget = state.user.dailyCalories;
  state.preferences.unit = document.querySelector("[data-setting-unit]")?.value || state.preferences.unit;
  state.preferences.reminderTime = document.querySelector("[data-setting-reminder]")?.value || state.preferences.reminderTime;
  state.preferences.aiAssist = document.querySelector("[data-setting-ai]")?.value !== "off";
  state.preferences.pushEnabled = Boolean(document.querySelector("[data-setting-push]")?.checked);
  state.settingsOpen = false;
  saveStoredState();
  showToast("设置已保存");
}

function applyRecommendedCalories() {
  const recommendation = calorieRecommendation();
  state.user.dailyCalories = recommendation.suggested;
  state.calorieBudget = recommendation.suggested;
  saveStoredState();
  showToast("已应用推荐热量预算");
  render();
}

function applyTodayTrainingPlan() {
  const plan = todayPlanWorkout();
  state.activityDraft.type = plan.type;
  state.activityDraft.minutes = plan.minutes;
  state.activityDraft.name = plan.focus;
  saveStoredState();
  showToast("已套用今日训练安排");
  render();
  setTimeout(() => scrollSurfaceTo(".activity-form-card"), 0);
}

async function loginWithPassword() {
  const password = document.querySelector("[data-access-password]")?.value || "";
  state.authError = "";
  try {
    const response = await fetch(API_SESSION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "登录失败");
    accessToken = data.token;
    localStorage.setItem(TOKEN_KEY, accessToken);
    state.authRequired = false;
    setBackendStatus("online");
    render();
    const loadedFromServer = await loadServerState();
    if (loadedFromServer) render();
  } catch (error) {
    state.authError = error.message || "登录失败";
    render();
  }
}

function saveWeightFromForm() {
  const nextWeight = Number(document.querySelector("[data-weight-input]")?.value || state.weight);
  if (!nextWeight || nextWeight < 40 || nextWeight > 200) {
    showToast("请输入合理体重");
    return;
  }
  state.weight = Number(nextWeight.toFixed(1));
  state.weightDraft = state.weight;
  if (!Array.isArray(state.weightLogs) || !state.weightLogs.length) {
    state.weightLogs = [{ date: "今天", value: state.weight }];
  } else {
    state.weightLogs[state.weightLogs.length - 1] = { date: "今天", value: state.weight };
  }
  saveStoredState();
  showToast("今日体重已更新");
}

function saveBodyMetricsFromForm() {
  const nextWeight = Number(document.querySelector("[data-weight-input]")?.value || state.weight);
  const nextWaist = Number(document.querySelector("[data-waist-input]")?.value || state.waist);
  if (!nextWeight || nextWeight < 40 || nextWeight > 200) {
    showToast("请输入合理体重");
    return;
  }
  if (!nextWaist || nextWaist < 50 || nextWaist > 180) {
    showToast("请输入合理腰围");
    return;
  }
  state.weight = Number(nextWeight.toFixed(1));
  state.weightDraft = state.weight;
  state.waist = Number(nextWaist.toFixed(1));
  state.waistDraft = state.waist;
  if (!Array.isArray(state.weightLogs) || !state.weightLogs.length) {
    state.weightLogs = [{ date: "今天", value: state.weight }];
  } else {
    state.weightLogs[state.weightLogs.length - 1] = { date: "今天", value: state.weight };
  }
  if (!Array.isArray(state.waistLogs) || !state.waistLogs.length) {
    state.waistLogs = [{ date: "今天", value: state.waist }];
  } else {
    state.waistLogs[state.waistLogs.length - 1] = { date: "今天", value: state.waist };
  }
  saveStoredState();
  showToast("今日体重和腰围已更新");
  render();
}

function bindEvents() {
  document.querySelector("[data-login]")?.addEventListener("click", () => {
    loginWithPassword();
  });

  document.querySelector("[data-access-password]")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") loginWithPassword();
  });

  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeTab = button.dataset.tab;
      render();
    });
  });

  document.querySelector("[data-complete-workout]")?.addEventListener("click", () => {
    state.workoutDone = true;
    saveStoredState();
    render();
  });

  document.querySelector("[data-weight-input]")?.addEventListener("input", (event) => {
    state.weightDraft = Number(event.target.value || state.weight);
  });

  document.querySelector("[data-waist-input]")?.addEventListener("input", (event) => {
    state.waistDraft = Number(event.target.value || state.waist);
  });

  document.querySelector("[data-save-body]")?.addEventListener("click", () => {
    saveBodyMetricsFromForm();
  });

  const nameInput = document.querySelector("[data-activity-name]");
  const typeInput = document.querySelector("[data-activity-type]");
  const minutesInput = document.querySelector("[data-activity-minutes]");

  nameInput?.addEventListener("input", (event) => {
    state.activityDraft.name = event.target.value;
    saveStoredState();
  });

  typeInput?.addEventListener("change", (event) => {
    state.activityDraft.type = event.target.value;
    saveStoredState();
    render();
  });

  minutesInput?.addEventListener("input", (event) => {
    state.activityDraft.minutes = Math.min(180, Math.max(5, Number(event.target.value || 5)));
    const estimateLabel = document.querySelector("[data-activity-estimate]");
    if (estimateLabel) {
      estimateLabel.textContent = `预估 ${estimateCalories(state.activityDraft.type, state.activityDraft.minutes)} kcal`;
    }
    saveStoredState();
  });

  document.querySelector("[data-add-activity]")?.addEventListener("click", () => {
    const name = state.activityDraft.name.trim() || state.activityDraft.type;
    const minutes = Math.min(180, Math.max(5, Number(state.activityDraft.minutes || 30)));
    state.customActivities.unshift({
      id: Date.now(),
      name,
      type: state.activityDraft.type,
      minutes,
      kcal: estimateCalories(state.activityDraft.type, minutes),
      createdAt: currentTimeLabel(),
    });
    state.activityDraft.name = "";
    state.activityDraft.minutes = 30;
    state.workoutDone = true;
    saveStoredState();
    render();
  });

  document.querySelectorAll("[data-delete-activity]").forEach((button) => {
    button.addEventListener("click", () => {
      state.customActivities = state.customActivities.filter((item) => String(item.id) !== button.dataset.deleteActivity);
      state.workoutDone = state.customActivities.length > 0;
      saveStoredState();
      render();
    });
  });

  document.querySelectorAll("[data-meal-slot], [data-meal-calories], [data-meal-food], [data-meal-amount], [data-meal-unit], [data-meal-cooking], [data-meal-oil], [data-meal-sauce], [data-meal-protein], [data-meal-carbs], [data-meal-fat]").forEach((input) => {
    input.addEventListener("input", () => {
      updateMealDraftFromForm();
      const label = document.querySelector(".meal-form-card .section-title span");
      if (label) label.textContent = `${state.mealDraft.calories} kcal`;
      saveStoredState();
    });
    input.addEventListener("change", () => {
      updateMealDraftFromForm();
      saveStoredState();
    });
  });

  document.querySelector("[data-add-meal]")?.addEventListener("click", () => {
    updateMealDraftFromForm();
    addMealDraft();
    render();
  });

  document.querySelector("[data-save-template]")?.addEventListener("click", () => {
    saveCurrentMealAsTemplate();
  });

  document.querySelectorAll("[data-use-template]").forEach((button) => {
    button.addEventListener("click", () => {
      useMealTemplate(button.dataset.useTemplate);
    });
  });

  document.querySelectorAll("[data-plate-option]").forEach((button) => {
    button.addEventListener("click", () => {
      applyMealPlateOption(button.dataset.plateOption);
    });
  });

  document.querySelectorAll("[data-diet-scenario]").forEach((button) => {
    button.addEventListener("click", () => {
      selectDietScenario(button.dataset.dietScenario);
    });
  });

  document.querySelectorAll("[data-apply-scenario]").forEach((button) => {
    button.addEventListener("click", () => {
      applyDietScenario(button.dataset.applyScenario);
    });
  });

  document.querySelector("[data-ai-nutrition]")?.addEventListener("click", () => {
    recognizeMealNutrition();
  });

  document.querySelector("[data-scroll-meal-form]")?.addEventListener("click", () => {
    scrollSurfaceTo("#meal-form");
  });

  document.querySelectorAll("[data-record-meal]").forEach((button) => {
    button.addEventListener("click", () => {
      state.mealDraft.slot = button.dataset.recordMeal;
      saveStoredState();
      render();
      setTimeout(() => scrollSurfaceTo("#meal-form"), 0);
    });
  });

  document.querySelectorAll("[data-toggle-task]").forEach((button) => {
    button.addEventListener("click", () => {
      const label = button.dataset.toggleTask;
      const task = todayTasks().find((item) => item.label === label);
      state.taskOverrides[label] = !(task?.done);
      saveStoredState();
      render();
    });
  });

  document.querySelectorAll("[data-habit-step]").forEach((button) => {
    button.addEventListener("click", () => {
      adjustHabitMetric(button.dataset.habitStep, Number(button.dataset.stepDirection || 1));
    });
  });

  document.querySelectorAll("[data-coach-action]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeTab = button.dataset.coachAction;
      saveStoredState();
      render();
      setTimeout(() => {
        scrollSurfaceTo(button.dataset.coachAction === "diet" ? "#meal-form" : ".activity-form-card");
      }, 0);
    });
  });

  document.querySelectorAll("[data-select-workout]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activityDraft.type = button.dataset.selectWorkout;
      saveStoredState();
      render();
      setTimeout(() => scrollSurfaceTo(".activity-form-card"), 0);
    });
  });

  document.querySelectorAll("[data-app-action]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.appAction === "settings" || button.dataset.appAction === "goal") {
        state.settingsOpen = true;
        render();
        return;
      }
      const messages = {
        reminder: "提醒已开启：今晚 21:30 检查饮食和步数",
        history: "历史记录模块下一步接入，现在今日记录已可保存",
        week: "已切换为本周视图",
        photo: "拍照识别入口已预留，当前可先用输入食物 + AI识别",
      };
      showToast(messages[button.dataset.appAction] || "操作已记录");
    });
  });

  document.querySelectorAll("[data-week-action]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeTab = button.dataset.weekAction || "home";
      saveStoredState();
      render();
      if (state.activeTab === "diet") setTimeout(() => scrollSurfaceTo("#meal-form"), 0);
      if (state.activeTab === "training") setTimeout(() => scrollSurfaceTo(".activity-form-card"), 0);
    });
  });

  document.querySelectorAll("[data-close-settings]").forEach((button) => {
    button.addEventListener("click", () => {
      state.settingsOpen = false;
      render();
    });
  });

  document.querySelector("[data-save-settings]")?.addEventListener("click", () => {
    saveSettingsFromForm();
  });

  document.querySelector("[data-apply-calorie]")?.addEventListener("click", () => {
    applyRecommendedCalories();
  });

  document.querySelectorAll("[data-apply-today-plan]").forEach((button) => {
    button.addEventListener("click", () => {
      applyTodayTrainingPlan();
    });
  });
}

function render() {
  document.querySelector("#app").innerHTML = appShell();
  bindEvents();
}

async function initApp() {
  loadStoredState();
  state.authRequired = true;
  state.authError = "";
  render();
  const loadedFromServer = await loadServerState();
  if (loadedFromServer) render();
}

initApp();
