import { saveHistoryEdit } from "../history-store.js";
import { state, meals, runtime, API_NUTRITION_URL, initialStateSnapshot } from "../app-state.js";
import { nativeRuntime, apiFetch, aiAvailable } from "../native-runtime.js";
import { mealPlateOptions, dietScenarios } from "../app-logic.js";
import { authHeaders, refreshSession, saveStoredState } from "../app-sync.js";
import { compressMealPhoto } from "../meal-photo.js";
import { mealEntries, summarizeMeal } from "../meal-entries.js";
import { createBlankDailyRecord, normalizeMealList } from "../app-data.js";
import { todayKey, validRecordDate } from "../app-utils.js";
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
    runtime.authUserId,
    draft.slot,
    draft.date,
    draft.editingId,
    runtime.mealPhoto?.id || "",
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
export function clearMealDraftAI({ keepPhoto = false } = {}) {
  if (!keepPhoto) {
    discardMealPhoto();
    runtime.aiNutritionController?.abort();
    runtime.aiNutritionController = null;
    runtime.aiNutritionSequence += 1;
  }
  state.mealDraft.aiResult = null;
  state.mealDraft.aiStatus = "idle";
  state.mealDraft.aiError = "";
  state.mealDraft.aiErrorCode = "";
  state.mealDraft.aiRequestId = "";
  state.mealDraft.aiRetryable = false;
}

function discardMealPhoto() {
  runtime.mealPhotoSequence += 1;
  runtime.mealPhoto = null;
  runtime.mealPhotoLoading = false;
  runtime.mealPhotoError = "";
  runtime.mealPhotoReviewKey = "";
}

export async function selectMealPhoto(input) {
  const file = input.files?.[0];
  input.value = "";
  if (!file || (state.preferences.aiAssist === false && !nativeRuntime())) return;
  updateMealDraftFromForm();
  cancelMealNutrition();
  clearMealDraftAI();
  const sequence = runtime.mealPhotoSequence;
  const session = runtime.authSessionGeneration;
  const slot = state.mealDraft.slot;
  runtime.mealPhotoLoading = true;
  render();
  const current = () =>
    sequence === runtime.mealPhotoSequence && session === runtime.authSessionGeneration && slot === state.mealDraft.slot;
  try {
    const photo = await compressMealPhoto(file);
    if (!current()) return;
    runtime.mealPhoto = { ...photo, id: String(sequence) };
    // Defaults from the text composer must not imply known cooking/oil in a photo.
    if (state.mealDraft.cooking === "清淡") state.mealDraft.cooking = "不确定";
    if (state.mealDraft.sauce === "少") state.mealDraft.sauce = "不确定";
  } catch (error) {
    if (current()) runtime.mealPhotoError = error.message;
  } finally {
    if (current()) {
      runtime.mealPhotoLoading = false;
      render();
    }
  }
}

export function removeMealPhoto() {
  updateMealDraftFromForm();
  cancelMealNutrition();
  clearMealDraftAI();
  render();
}

export function reviewMealPhoto(checked) {
  updateMealDraftFromForm();
  runtime.mealPhotoReviewKey = checked ? mealNutritionDraftFingerprint() : "";
}

export function isMealPhotoReviewed() {
  return runtime.mealPhotoReviewKey === mealNutritionDraftFingerprint();
}

export async function refreshNutritionBudget() {
  if (runtime.nutritionBudgetLoading) return;
  const session = runtime.authSessionGeneration;
  runtime.nutritionBudgetLoading = true;
  runtime.nutritionBudgetMessage = "";
  render();
  try {
    let response = await apiFetch("/api/ai/budget", { headers: authHeaders() });
    if (response.status === 401 && (await refreshSession())) response = await apiFetch("/api/ai/budget", { headers: authHeaders() });
    const payload = await response.json();
    if (session !== runtime.authSessionGeneration) return;
    if (!response.ok) throw new Error(payload.error || "暂时无法读取预算");
    runtime.nutritionBudget = payload;
  } catch (error) {
    if (session === runtime.authSessionGeneration) runtime.nutritionBudgetMessage = error.message;
  } finally {
    if (session === runtime.authSessionGeneration) {
      runtime.nutritionBudgetLoading = false;
      render();
    }
  }
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
  if (runtime.mealPhotoLoading || state.mealDraft.aiStatus === "submitting") {
    showToast("请等待识别完成，或先取消识别。");
    return false;
  }
  if (
    runtime.mealPhoto &&
    aiAvailable() &&
    state.preferences.aiAssist !== false &&
    (state.mealDraft.aiResult?.inputMode !== "photo" || !isMealPhotoReviewed())
  ) {
    showToast("请先识别照片并勾选核对食物与份量，或移除照片后手动记录。");
    return false;
  }
  const previousFocusTasks = focusTaskSnapshot();
  const date = state.mealDraft.date || todayKey();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > todayKey() || !validRecordDate(date)) {
    showToast("请选择今天或过去的有效日期");
    return false;
  }
  const record =
    date === todayKey()
      ? null
      : state.dailyRecords[date] || runtime.historyRows?.find((row) => row.date === date)?.record || createBlankDailyRecord(date);
  const targetMeals = record ? normalizeMealList(record.meals) : meals;
  const target = targetMeals.find((meal) => meal.id === state.mealDraft.slot) || targetMeals[0];
  const priorEntries = mealEntries(target, date);
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
  const entry = {
    id: state.mealDraft.editingId || globalThis.crypto?.randomUUID?.() || `entry-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    date,
    slot: target.id,
    food,
    calories,
    macros,
    amount: Number(state.mealDraft.amount) || null,
    unit: state.mealDraft.unit,
    cooking: state.mealDraft.cooking,
    oilGrams: Number(state.mealDraft.oilGrams) || 0,
    sauce: state.mealDraft.sauce,
    nutritionKnown: Boolean(state.mealDraft.nutritionKnown || aiResult || calories > 0),
    macrosKnown: Boolean(aiResult || Object.values(macros).some((value) => value > 0)),
    nutritionSource: target.nutritionSource,
    aiMeta: target.aiMeta,
    updatedAt: new Date().toISOString(),
  };
  const index = priorEntries.findIndex((item) => item.id === entry.id);
  if (index >= 0) priorEntries[index] = entry;
  else priorEntries.push(entry);
  Object.assign(target, summarizeMeal({ ...target, entries: priorEntries }, date));
  if (record) {
    state.dailyRecords[date] = { ...record, meals: targetMeals, intakeStatus: "partial", updatedAt: entry.updatedAt };
    void saveHistoryEdit(date, state.dailyRecords[date]).catch((error) => {
      state.syncErrorKind = "storage";
      state.syncError = error.message;
      render();
      showToast(error.message);
    });
  } else state.intakeStatus = "partial";
  state.mealDraft.editingId = "";
  state.mealDraft.food = "";
  state.mealDraft.calories = 0;
  state.mealDraft.protein = 0;
  state.mealDraft.carbs = 0;
  state.mealDraft.fat = 0;
  state.mealDraft.nutritionKnown = false;
  state.mealDraft.portionBase = null;
  clearMealDraftAI();
  saveStoredState();
  handleFocusTaskTransitions(previousFocusTasks, "[data-add-meal]");
}

export function saveCurrentMealAsTemplate() {
  updateMealDraftFromForm();
  if (
    runtime.mealPhoto &&
    aiAvailable() &&
    state.preferences.aiAssist !== false &&
    (state.mealDraft.aiResult?.inputMode !== "photo" || !isMealPhotoReviewed())
  ) {
    showToast("请先核对照片识别结果再存为常用餐。");
    return;
  }
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
    amount: state.mealDraft.amount,
    unit: state.mealDraft.unit,
    cooking: state.mealDraft.cooking,
    oilGrams: state.mealDraft.oilGrams,
    sauce: state.mealDraft.sauce,
    nutritionKnown: state.mealDraft.nutritionKnown || Number(state.mealDraft.calories) > 0,
  });
  state.mealTemplates = state.mealTemplates.slice(0, 20);
  saveStoredState();
  showToast("已保存为常用餐");
}

export function useMealTemplate(id) {
  const template = state.mealTemplates.find((item) => String(item.id) === String(id));
  if (!template) return;
  Object.assign(state.mealDraft, {
    editingId: "",
    date: todayKey(),
    amount: template.amount || "",
    unit: template.unit || "g",
    cooking: template.cooking || "不确定",
    oilGrams: template.oilGrams || 0,
    sauce: template.sauce || "不确定",
    nutritionKnown: template.nutritionKnown !== false,
    portionBase: template.amount > 0 ? structuredClone(template) : null,
  });
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
  state.mealDraft.editingId = "";
  state.mealDraft.date = todayKey();
  state.mealDraft.portionBase = null;
  state.mealDraft.slot = emptySlot?.id || source.id;
  state.mealDraft.food = Array.isArray(source.foods) ? source.foods.join("、") : "";
  state.mealDraft.calories = Number(source.calories || 0);
  state.mealDraft.protein = Number(source.macros?.protein || 0);
  state.mealDraft.carbs = Number(source.macros?.carbs || 0);
  state.mealDraft.fat = Number(source.macros?.fat || 0);
  clearMealDraftAI();
  saveStoredState();
  state.mealDraft.editingId = "";
  showToast(emptySlot ? `已复制到${emptySlot.name}草稿` : "已复制到草稿，保存时会追加记录");
  setTimeout(() => scrollToMealForm(), 0);
  return true;
}

export function applyMealPlateOption(id) {
  state.mealDraft.editingId = "";
  state.mealDraft.date = todayKey();
  state.mealDraft.portionBase = null;
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
  state.mealDraft.editingId = "";
  state.mealDraft.date = todayKey();
  state.mealDraft.portionBase = null;
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

export function switchMealDraftDate(date) {
  const previous = state.mealDraft.date || todayKey();
  if (date === previous) return;
  clearMealDraftAI();
  state.mealDraftByDate ||= {};
  state.mealDraftByDate[previous] = structuredClone(state.mealDraft);
  state.mealDraft = { ...structuredClone(state.mealDraftByDate[date] || initialStateSnapshot.mealDraft), date };
}

export function updateMealDraftFromForm() {
  const chosenDate = document.querySelector("[data-meal-date]")?.value;
  if (chosenDate && chosenDate !== (state.mealDraft.date || todayKey())) {
    switchMealDraftDate(chosenDate);
    render();
    return;
  }
  const previous = mealNutritionDraftFingerprint();
  const previousSlot = state.mealDraft.slot;
  Object.assign(
    state.mealDraft,
    readFormValues([
      { key: "slot", selector: "[data-meal-slot]", fallback: state.mealDraft.slot },
      { key: "date", selector: "[data-meal-date]", fallback: state.mealDraft.date || todayKey() },
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
  if (previous !== mealNutritionDraftFingerprint()) {
    runtime.mealPhotoReviewKey = "";
    const review = document.querySelector("[data-photo-reviewed]");
    if (review) review.checked = false;
  }
  if (previousSlot !== state.mealDraft.slot && (runtime.mealPhoto || runtime.mealPhotoLoading)) {
    clearMealDraftAI();
    render();
  }
}

export async function recognizeMealNutrition() {
  if (!aiAvailable()) {
    showToast("请先在“我的”中登录云账号，再使用 AI 识别");
    return false;
  }
  if (state.mealDraft.aiStatus === "submitting" || runtime.aiNutritionController || runtime.mealPhotoLoading) return false;
  updateMealDraftFromForm();
  if (state.preferences.aiAssist === false) {
    showToast("AI 辅助已关闭");
    return false;
  }
  if (!state.mealDraft.food.trim() && !runtime.mealPhoto) {
    showToast("请先填写食物内容或选择照片，再进行 AI 识别");
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
  clearMealDraftAI({ keepPhoto: true });
  runtime.mealPhotoReviewKey = "";
  state.mealDraft.aiStatus = "submitting";
  render();
  try {
    const requestBody = {
      foodText: state.mealDraft.food,
      locale: "zh-CN",
      ...(runtime.mealPhoto ? { imageDataUrl: runtime.mealPhoto.dataUrl } : {}),
      context: {
        amount: state.mealDraft.amount,
        unit: state.mealDraft.unit,
        cooking: state.mealDraft.cooking,
        oilGrams: state.mealDraft.oilGrams,
        sauce: state.mealDraft.sauce,
      },
    };
    const makeRequest = () =>
      apiFetch(API_NUTRITION_URL, {
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

    if (requestBody.imageDataUrl && (result.inputMode !== "photo" || !result.foodText))
      throw new Error("模型未返回照片中的食物，请重新识别。");
    state.mealDraft.calories = Math.max(0, Number(result.calories));
    state.mealDraft.protein = Math.max(0, Number(result.protein));
    state.mealDraft.carbs = Math.max(0, Number(result.carbs));
    state.mealDraft.fat = Math.max(0, Number(result.fat));
    if (requestBody.imageDataUrl) {
      state.mealDraft.food = result.foodText;
      state.mealDraft.advancedOpen = true;
    }
    state.mealDraft.aiResult = { ...result, foodText: state.mealDraft.food };
    if (result.budget) runtime.nutritionBudget = result.budget;
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
  if (slot !== state.mealDraft.slot) clearMealDraftAI();
  state.mealDraft.slot = slot;
  state.mealDraft.date = todayKey();
  state.mealDraft.editingId = "";
  saveStoredState();
  render();
  setTimeout(() => scrollToMealForm(), 0);
}

export function scaleMealPortion() {
  updateMealDraftFromForm();
  const base = state.mealDraft.portionBase;
  if (!base || !(base.amount > 0) || !(state.mealDraft.amount > 0) || base.unit !== state.mealDraft.unit)
    return showToast("请使用原来的份量单位，并填写大于零的份量");
  const ratio = state.mealDraft.amount / base.amount;
  if (ratio > 10) return showToast("份量跨度太大，请手动核对营养");
  for (const key of ["calories", "protein", "carbs", "fat"])
    state.mealDraft[key] = Math.round(Number(base[key] ?? base.macros?.[key] ?? 0) * ratio * 10) / 10;
  state.mealDraft.nutritionKnown = base.nutritionKnown !== false;
  clearMealDraftAI();
  saveStoredState();
  render();
}
