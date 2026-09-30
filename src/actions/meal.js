import { state, meals, runtime, API_NUTRITION_URL } from "../app-state.js";
import { mealPlateOptions, dietScenarios } from "../app-logic.js";
import { authHeaders, refreshSession, saveStoredState } from "../app-sync.js";
import {
  render,
  showToast,
  scrollSurfaceTo,
  scrollToMealForm,
  focusTaskSnapshot,
  handleFocusTaskTransitions,
  readFormValues,
} from "./services.js";

function mealNutritionDraftFingerprint() {
  const draft = state.mealDraft;
  return JSON.stringify([
    String(draft.food || "").trim(),
    Number(draft.amount || 0),
    String(draft.unit || ""),
    String(draft.cooking || ""),
    Number(draft.oilGrams || 0),
    String(draft.sauce || ""),
    Number(draft.calories || 0),
    Number(draft.protein || 0),
    Number(draft.carbs || 0),
    Number(draft.fat || 0),
  ]);
}

function isCurrentAiNutritionRequest(sequence, draftKey, controller) {
  return (
    runtime.aiNutritionSequence === sequence &&
    runtime.aiNutritionController === controller &&
    !controller?.signal.aborted &&
    runtime.aiNutritionDraftKey === draftKey
  );
}

function markAiNutritionCancelled(message) {
  state.mealDraft.aiStatus = "cancelled";
  state.mealDraft.aiError = message;
  state.mealDraft.aiErrorCode = "AI_CANCELLED";
  state.mealDraft.aiRequestId = "";
  state.mealDraft.aiRetryable = true;
  state.mealDraft.aiResult = null;
}

// 草稿内容被手动改动（模板/餐次/方案/记录）时统一清空 AI 识别态
function clearMealDraftAI() {
  state.mealDraft.aiResult = null;
  state.mealDraft.aiStatus = "idle";
  state.mealDraft.aiError = "";
  state.mealDraft.aiErrorCode = "";
  state.mealDraft.aiRequestId = "";
  state.mealDraft.aiRetryable = false;
}

export function cancelMealNutrition(message = "已取消识别，当前草稿已保留。") {
  const controller = runtime.aiNutritionController;
  if (!controller && state.mealDraft.aiStatus !== "submitting") return false;
  runtime.aiNutritionSequence += 1;
  runtime.aiNutritionController = null;
  runtime.aiNutritionDraftKey = "";
  try {
    controller?.abort();
  } catch {
    // Sequence invalidation still rejects a late response if abort is unavailable.
  }
  markAiNutritionCancelled(message);
  render();
  requestAnimationFrame(() => document.querySelector("[data-ai-nutrition]")?.focus({ preventScroll: true }));
  return true;
}

export function addMealDraft() {
  const previousFocusTasks = focusTaskSnapshot();
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
  target.foods = food
    .split(/[，,]/)
    .map((item) => item.trim())
    .filter(Boolean);
  target.macros = macros;
  const aiResult = state.mealDraft.aiResult;
  const aiEdited =
    Boolean(aiResult) &&
    (Number(aiResult.calories) !== calories ||
      Number(aiResult.protein) !== macros.protein ||
      Number(aiResult.carbs) !== macros.carbs ||
      Number(aiResult.fat) !== macros.fat ||
      String(aiResult.foodText || "").trim() !== state.mealDraft.food.trim() ||
      Number(aiResult.context?.amount || 0) !== Number(state.mealDraft.amount || 0) ||
      String(aiResult.context?.unit || "") !== String(state.mealDraft.unit || "") ||
      String(aiResult.context?.cooking || "") !== String(state.mealDraft.cooking || "") ||
      Number(aiResult.context?.oilGrams || 0) !== Number(state.mealDraft.oilGrams || 0) ||
      String(aiResult.context?.sauce || "") !== String(state.mealDraft.sauce || ""));
  target.nutritionSource = aiResult?.source === "model" ? "ai" : "manual";
  target.aiMeta =
    target.nutritionSource === "ai"
      ? {
          requestId: aiResult.requestId || "",
          model: aiResult.model || "",
          confidence: Number.isFinite(Number(aiResult.confidence)) ? Number(aiResult.confidence) : null,
          needsReview: Boolean(aiResult.needsReview),
          edited: aiEdited,
        }
      : null;
  state.mealDraft.food = "";
  clearMealDraftAI();
  saveStoredState();
  handleFocusTaskTransitions(previousFocusTasks, "[data-add-meal]");
}

export function saveCurrentMealAsTemplate() {
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

export function useMealTemplate(id) {
  const template = state.mealTemplates.find((item) => String(item.id) === String(id));
  if (!template) return;
  state.mealDraft.food = template.food;
  state.mealDraft.calories = template.calories;
  state.mealDraft.protein = template.protein;
  state.mealDraft.carbs = template.carbs;
  state.mealDraft.fat = template.fat;
  clearMealDraftAI();
  saveStoredState();
  render();
  setTimeout(() => scrollSurfaceTo("#meal-form"), 0);
}

export function repeatMeal(mealId) {
  const source = meals.find((meal) => String(meal.id) === String(mealId) && Number(meal.calories) > 0);
  if (!source) return false;
  const emptySlot = meals.find((meal) => Number(meal.calories) === 0);
  state.mealDraft.slot = emptySlot?.id || source.id;
  state.mealDraft.food = Array.isArray(source.foods) ? source.foods.join("、") : "";
  state.mealDraft.calories = Number(source.calories || 0);
  state.mealDraft.protein = Number(source.macros?.protein || 0);
  state.mealDraft.carbs = Number(source.macros?.carbs || 0);
  state.mealDraft.fat = Number(source.macros?.fat || 0);
  clearMealDraftAI();
  saveStoredState();
  showToast(emptySlot ? `已复制到${emptySlot.name}草稿` : "今天四餐都已记录，请先确认要替换的餐次");
  setTimeout(() => scrollToMealForm(), 0);
  return true;
}

export function applyMealPlateOption(id) {
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
  clearMealDraftAI();
  saveStoredState();
  showToast("已套用餐盘方案");
  render();
  setTimeout(() => scrollSurfaceTo("#meal-form"), 0);
}

export function selectDietScenario(id) {
  if (!dietScenarios().some((item) => item.id === id)) return;
  state.dietScenario = id;
  saveStoredState();
  render();
}

export function applyDietScenario(id) {
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
  clearMealDraftAI();
  saveStoredState();
  showToast(`已套用${scenario.title}策略`);
  render();
  setTimeout(() => scrollSurfaceTo("#meal-form"), 0);
}

export function updateMealDraftFromForm() {
  Object.assign(
    state.mealDraft,
    readFormValues([
      { key: "slot", selector: "[data-meal-slot]", fallback: state.mealDraft.slot },
      { key: "food", selector: "[data-meal-food]", fallback: "" },
      { key: "amount", selector: "[data-meal-amount]", numeric: true },
      { key: "unit", selector: "[data-meal-unit]", fallback: "g" },
      { key: "cooking", selector: "[data-meal-cooking]", fallback: "清淡" },
      { key: "oilGrams", selector: "[data-meal-oil]", numeric: true },
      { key: "sauce", selector: "[data-meal-sauce]", fallback: "少" },
      { key: "calories", selector: "[data-meal-calories]", numeric: true },
      { key: "protein", selector: "[data-meal-protein]", numeric: true },
      { key: "carbs", selector: "[data-meal-carbs]", numeric: true },
      { key: "fat", selector: "[data-meal-fat]", numeric: true },
    ]),
  );
  state.mealDraft.advancedOpen = Boolean(document.querySelector(".advanced-fields")?.open);
}

export async function recognizeMealNutrition() {
  if (state.mealDraft.aiStatus === "submitting" || runtime.aiNutritionController) return false;
  updateMealDraftFromForm();
  if (state.preferences.aiAssist === false) {
    showToast("AI 辅助已关闭");
    return false;
  }
  if (!state.mealDraft.food.trim()) {
    showToast("请先填写食物内容，再进行 AI 识别");
    return false;
  }

  if (navigator.onLine === false) {
    state.mealDraft.aiStatus = "offline";
    state.mealDraft.aiError = "AI 识别需要联网。你可以展开营养细节，先手动完成本餐记录。";
    state.mealDraft.aiErrorCode = "AI_OFFLINE";
    state.mealDraft.aiRequestId = "";
    state.mealDraft.aiRetryable = true;
    state.mealDraft.aiResult = null;
    render();
    return false;
  }

  const sequence = runtime.aiNutritionSequence + 1;
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const draftKey = mealNutritionDraftFingerprint();
  runtime.aiNutritionSequence = sequence;
  runtime.aiNutritionController = controller;
  runtime.aiNutritionDraftKey = draftKey;
  clearMealDraftAI();
  state.mealDraft.aiStatus = "submitting";
  render();
  try {
    const requestBody = {
      foodText: state.mealDraft.food,
      locale: "zh-CN",
      context: {
        amount: state.mealDraft.amount,
        unit: state.mealDraft.unit,
        cooking: state.mealDraft.cooking,
        oilGrams: state.mealDraft.oilGrams,
        sauce: state.mealDraft.sauce,
      },
    };
    const makeRequest = () =>
      fetch(API_NUTRITION_URL, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(requestBody),
        ...(controller ? { signal: controller.signal } : {}),
      });
    let response = await makeRequest();
    if (!isCurrentAiNutritionRequest(sequence, draftKey, controller)) return false;
    if (response.status === 401 && (await refreshSession())) {
      if (!isCurrentAiNutritionRequest(sequence, draftKey, controller)) return false;
      response = await makeRequest();
    }
    const result = await response.json().catch(() => ({}));
    if (!isCurrentAiNutritionRequest(sequence, draftKey, controller)) return false;
    if (mealNutritionDraftFingerprint() !== draftKey) {
      markAiNutritionCancelled("内容已修改，未应用较早的识别结果。当前草稿已保留。");
      return false;
    }
    if (!response.ok) {
      const error = new Error(result.error || "AI 识别失败，请稍后重试");
      error.code = result.code || `HTTP_${response.status}`;
      error.retryable = result.retryable !== false;
      error.requestId = result.requestId || "";
      throw error;
    }
    if (result.source !== "model") throw new Error("服务未返回真实模型结果，已阻止使用本地规则估算");
    if (![result.calories, result.protein, result.carbs, result.fat].every((value) => Number.isFinite(Number(value)))) {
      throw new Error("模型返回的营养数据不完整，请改用手动记录");
    }

    state.mealDraft.calories = Math.max(0, Number(result.calories));
    state.mealDraft.protein = Math.max(0, Number(result.protein));
    state.mealDraft.carbs = Math.max(0, Number(result.carbs));
    state.mealDraft.fat = Math.max(0, Number(result.fat));
    state.mealDraft.aiResult = { ...result, foodText: requestBody.foodText };
    state.mealDraft.aiStatus = result.needsReview ? "needs-review" : "success";
    state.mealDraft.aiError = "";
    state.mealDraft.aiErrorCode = "";
    state.mealDraft.aiRequestId = result.requestId || "";
    state.mealDraft.aiRetryable = false;
    saveStoredState();
    return true;
  } catch (error) {
    if (!isCurrentAiNutritionRequest(sequence, draftKey, controller)) return false;
    if (error?.name === "AbortError") {
      markAiNutritionCancelled("已取消识别，当前草稿已保留。");
      return false;
    }
    if (mealNutritionDraftFingerprint() !== draftKey) {
      markAiNutritionCancelled("内容已修改，未应用较早的识别结果。当前草稿已保留。");
      return false;
    }
    state.mealDraft.aiStatus = navigator.onLine === false ? "offline" : "error";
    state.mealDraft.aiError = error.message || "AI 识别暂时不可用，请手动记录";
    state.mealDraft.aiErrorCode = error.code || "AI_SERVICE_FAILED";
    state.mealDraft.aiRequestId = error.requestId || "";
    state.mealDraft.aiRetryable = error.retryable !== false;
    state.mealDraft.aiResult = null;
    return false;
  } finally {
    if (isCurrentAiNutritionRequest(sequence, draftKey, controller)) {
      runtime.aiNutritionController = null;
      runtime.aiNutritionDraftKey = "";
      render();
      setTimeout(() => scrollSurfaceTo("#meal-form"), 0);
    }
  }
}

export function startMealDraftFromSlot(slot) {
  state.mealDraft.slot = slot;
  saveStoredState();
  render();
  setTimeout(() => scrollToMealForm(), 0);
}
