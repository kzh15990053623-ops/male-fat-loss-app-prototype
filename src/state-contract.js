const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);
// Validate before sanitizing: malformed snapshots must never erase an existing account.
export function validateStateWrite(payload) {
  const invalid = () => {
    throw Object.assign(new Error("档案结构无效，已有记录未被修改。请更新应用或从备份恢复。"), {
      status: 400,
      code: "STATE_PAYLOAD_INVALID",
      retryable: false,
    });
  };
  if (!isRecord(payload) || !isRecord(payload.state)) invalid();
  const s = payload.state;
  if (s.schemaVersion !== undefined && (!Number.isInteger(s.schemaVersion) || s.schemaVersion < 1 || s.schemaVersion > 3)) invalid();
  if (s.clearedAt !== undefined) {
    if (typeof s.clearedAt !== "string" || !Number.isFinite(Date.parse(s.clearedAt))) invalid();
    if (Object.keys(s).some((key) => !["schemaVersion", "clearedAt", "syncRevision"].includes(key))) invalid();
    if (payload.meals !== null && !(Array.isArray(payload.meals) && payload.meals.length === 0)) invalid();
    return;
  }
  if (!["weight", "dailyRecords", "setupCompleted"].some((key) => Object.hasOwn(s, key))) invalid();
  if (s.schemaVersion >= 3) {
    for (const key of ["user", "preferences", "dailyRecords", "taskOverrides"]) if (!isRecord(s[key])) invalid();
    for (const key of ["weightLogs", "waistLogs", "customActivities"]) if (!Array.isArray(s[key])) invalid();
    if (typeof s.setupCompleted !== "boolean") invalid();
  }
  if (!Array.isArray(payload.meals) || payload.meals.some((meal) => !isRecord(meal))) invalid();
  for (const key of ["preferences", "user", "dailyRecords", "taskOverrides"]) {
    if (s[key] !== undefined && !isRecord(s[key])) invalid();
  }
  for (const key of ["weightLogs", "waistLogs", "customActivities", "mealTemplates"]) {
    if (s[key] !== undefined && (!Array.isArray(s[key]) || s[key].some((item) => !isRecord(item)))) invalid();
  }
  for (const key of ["weight", "waist", "calorieBudget", "targetWeight", "weeklyLossTarget", "waterMl", "steps", "sleep"]) {
    if (s[key] !== undefined && s[key] !== null && (!isFiniteNumber(s[key]) || s[key] < 0)) invalid();
  }
  const validDate = (date) =>
    /^\d{4}-\d{2}-\d{2}$/.test(date || "") && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
  const numeric = (obj, keys) => {
    for (const key of keys) if (obj[key] !== undefined && obj[key] !== null && (!isFiniteNumber(obj[key]) || obj[key] < 0)) invalid();
  };
  numeric(s.user || {}, ["height", "age", "bmr", "dailyCalories"]);
  if (s.user?.formula !== undefined && !["male", "female", "manual"].includes(s.user.formula)) invalid();
  if (s.user?.activityLevel !== undefined && !["sedentary", "light", "moderate", "active"].includes(s.user.activityLevel)) invalid();
  for (const flag of ["setupCompleted", "restDay", "workoutDone"]) if (s[flag] !== undefined && typeof s[flag] !== "boolean") invalid();
  const validateActivities = (items) => {
    if (!Array.isArray(items)) invalid();
    for (const item of items) {
      if (!isRecord(item)) invalid();
      numeric(item, ["minutes", "kcal"]);
    }
  };
  if (s.customActivities) validateActivities(s.customActivities);
  const validateMeals = (list) => {
    for (const meal of list) {
      if (!isRecord(meal)) invalid();
      if (meal.calories !== undefined && (!isFiniteNumber(meal.calories) || meal.calories < 0)) invalid();
      if (meal.macros !== undefined && !isRecord(meal.macros)) invalid();
      if (meal.foods !== undefined && (!Array.isArray(meal.foods) || meal.foods.some((food) => typeof food !== "string"))) invalid();
      if (meal.macros) numeric(meal.macros, ["protein", "carbs", "fat"]);
      if (meal.entries !== undefined) {
        if (!Array.isArray(meal.entries) || meal.entries.length > 500) invalid();
        const ids = new Set();
        for (const entry of meal.entries) {
          if (
            !isRecord(entry) ||
            typeof entry.id !== "string" ||
            !entry.id ||
            ids.has(entry.id) ||
            typeof entry.food !== "string" ||
            !entry.food ||
            !isRecord(entry.macros) ||
            typeof entry.nutritionKnown !== "boolean"
          )
            invalid();
          ids.add(entry.id);
          if (entry.macrosKnown !== undefined && typeof entry.macrosKnown !== "boolean") invalid();
          numeric(entry, ["calories", "amount", "oilGrams"]);
          numeric(entry.macros, ["protein", "carbs", "fat"]);
          if (entry.date && !validDate(entry.date)) invalid();
          for (const field of ["updatedAt", "deletedAt"]) if (entry[field] && !Number.isFinite(Date.parse(entry[field]))) invalid();
        }
      }
    }
  };
  validateMeals(payload.meals);
  for (const [date, record] of Object.entries(s.dailyRecords || {})) {
    if (!validDate(date) || !isRecord(record) || (record.meals !== undefined && !Array.isArray(record.meals))) invalid();
    if (record.date !== undefined && record.date !== date) invalid();
    if (record.meals) validateMeals(record.meals);
    if (record.customActivities !== undefined) validateActivities(record.customActivities);
    numeric(record, ["waterMl", "steps", "sleep", "weight", "waist", "calorieBudget"]);
    if (record.intakeStatus !== undefined && !["unknown", "partial", "complete"].includes(record.intakeStatus)) invalid();
  }
  for (const key of ["weightLogs", "waistLogs"])
    for (const item of s[key] || []) if (!validDate(item.date) || !isFiniteNumber(item.value) || item.value < 0) invalid();
  for (const template of s.mealTemplates || []) numeric(template, ["calories", "protein", "carbs", "fat", "amount", "oilGrams"]);
}
