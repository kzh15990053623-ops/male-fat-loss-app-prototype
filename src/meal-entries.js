// Shared, pure record model used by both the browser and server.
export function mealEntries(meal, date = "") {
  if (Array.isArray(meal?.entries)) return meal.entries.filter((e) => e && typeof e === "object" && !Array.isArray(e));
  if (!(Number(meal?.calories) > 0 || meal?.foods?.length)) return [];
  return [
    {
      id: `legacy-${meal.id || meal.name || "meal"}`,
      date,
      slot: meal.id,
      food: (meal.foods || []).join("、") || `${meal.name || "餐次"}记录`,
      amount: null,
      unit: "g",
      cooking: "不确定",
      oilGrams: null,
      sauce: "不确定",
      calories: Number(meal.calories || 0),
      macros: { ...meal.macros },
      nutritionKnown: Number(meal.calories) > 0,
      nutritionSource: meal.nutritionSource || "manual",
      aiMeta: meal.aiMeta || null,
      updatedAt: "",
    },
  ];
}

export function summarizeMeal(meal, date = "") {
  const entries = mealEntries(meal, date);
  const active = entries.filter((entry) => !entry.deletedAt);
  const known = active.filter((entry) => entry.nutritionKnown !== false && Number.isFinite(entry.calories));
  return {
    ...meal,
    entries,
    calories: known.reduce((sum, entry) => sum + Math.max(0, entry.calories), 0),
    macros: Object.fromEntries(
      ["protein", "carbs", "fat"].map((key) => [
        key,
        known.filter(macrosAreKnown).reduce((sum, entry) => sum + Math.max(0, Number(entry.macros?.[key] || 0)), 0),
      ]),
    ),
    foods: active.map((entry) => entry.food).filter(Boolean),
    status: active.length ? "已记录" : "待记录",
    nutritionKnown: active.length > 0 && active.length === known.length,
  };
}

export function hasRecordedMeal(meal) {
  return mealEntries(meal).some((entry) => !entry.deletedAt);
}

export function completeIntake(record) {
  return (
    record?.intakeStatus === "complete" &&
    Array.isArray(record.meals) &&
    record.meals.some(hasRecordedMeal) &&
    record.meals.filter(hasRecordedMeal).every((meal) => summarizeMeal(meal).nutritionKnown)
  );
}

export function macrosAreKnown(entry) {
  return (
    entry.macrosKnown === true ||
    (entry.macrosKnown !== false && ["protein", "carbs", "fat"].some((key) => Number(entry.macros?.[key]) > 0))
  );
}
export function completeMacros(mealList) {
  const entries = mealList.flatMap((meal) => mealEntries(meal)).filter((entry) => !entry.deletedAt);
  return entries.length > 0 && entries.every(macrosAreKnown);
}
