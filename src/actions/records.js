import { state, meals, runtime } from "../app-state.js";
import { saveHistoryEdit } from "../history-store.js";
import { todayKey, validRecordDate } from "../app-utils.js";
import { mealEntries, summarizeMeal } from "../meal-entries.js";
import { normalizeMealList, upsertMetricLog, createBlankDailyRecord, applyDailyRecord } from "../app-data.js";
import { saveStoredState } from "../app-sync.js";
import { render, showToast, scrollToMealForm, activateTab } from "./services.js";
import { clearMealDraftAI, switchMealDraftDate } from "./meal.js";

function listFor(date) {
  return date === todayKey()
    ? meals
    : state.dailyRecords[date]?.meals || runtime.historyRows?.find((row) => row.date === date)?.record?.meals || [];
}
export function editMealEntry(control) {
  const date = control.dataset.recordDate || todayKey();
  const entry = listFor(date)
    .flatMap((meal) => mealEntries(meal, date))
    .find((item) => item.id === (control.dataset.editMealEntry || control.dataset.copyMealEntry) && !item.deletedAt);
  if (!entry) return;
  switchMealDraftDate(control.dataset.copyMealEntry ? todayKey() : date);
  clearMealDraftAI();
  Object.assign(state.mealDraft, entry, entry.macros, {
    editingId: control.dataset.copyMealEntry ? "" : entry.id,
    date: control.dataset.copyMealEntry ? todayKey() : date,
    advancedOpen: true,
    portionBase: entry.amount > 0 ? structuredClone(entry) : null,
  });
  activateTab("diet");
  render();
  scrollToMealForm();
}
export function deleteMealEntry(control) {
  const date = control.dataset.recordDate || todayKey();
  const targetMeals = normalizeMealList(listFor(date));
  const updatedAt = new Date().toISOString();
  for (const meal of targetMeals) {
    meal.entries = mealEntries(meal, date).map((entry) =>
      entry.id === control.dataset.deleteMealEntry ? { ...entry, deletedAt: updatedAt, updatedAt } : entry,
    );
    Object.assign(meal, summarizeMeal(meal, date));
  }
  if (date === todayKey()) {
    meals.splice(0, meals.length, ...targetMeals);
    state.intakeStatus = "partial";
  } else
    state.dailyRecords[date] = {
      ...(state.dailyRecords[date] || runtime.historyRows?.find((row) => row.date === date)?.record),
      date,
      meals: targetMeals,
      intakeStatus: "partial",
      updatedAt,
    };
  if (date !== todayKey())
    void saveHistoryEdit(date, state.dailyRecords[date]).catch((error) => {
      state.syncErrorKind = "storage";
      state.syncError = error.message;
      render();
      showToast(error.message);
    });
  saveStoredState();
  render();
  showToast("已删除这条记录，其余食物保留");
}
export function confirmIntake(control) {
  const date = control?.dataset.recordDate || todayKey();
  const chosenMeals = listFor(date);
  const known = chosenMeals.filter((meal) => mealEntries(meal).some((e) => !e.deletedAt));
  if (!known.length || known.some((meal) => !summarizeMeal(meal).nutritionKnown)) {
    showToast("请先记录饮食并补全待确认的营养数值");
    return;
  }
  if (date === todayKey()) state.intakeStatus = state.intakeStatus === "complete" ? "partial" : "complete";
  else {
    const record = state.dailyRecords[date] || runtime.historyRows?.find((row) => row.date === date)?.record;
    if (!record) return;
    state.dailyRecords[date] = {
      ...record,
      intakeStatus: record.intakeStatus === "complete" ? "partial" : "complete",
      updatedAt: new Date().toISOString(),
    };
    void saveHistoryEdit(date, state.dailyRecords[date]).catch((error) => {
      state.syncErrorKind = "storage";
      state.syncError = error.message;
      render();
      showToast(error.message);
    });
  }
  saveStoredState();
  render();
}
export function manageMealTemplate(control) {
  const id = control.dataset.deleteTemplate || control.dataset.renameTemplate;
  const template = state.mealTemplates.find((item) => String(item.id) === id);
  if (!template) return;
  if (control.dataset.deleteTemplate) state.mealTemplates = state.mealTemplates.filter((item) => item !== template);
  else {
    const name = globalThis.prompt("常用餐名称", template.name);
    if (!name?.trim()) return;
    template.name = name.trim().slice(0, 40);
  }
  saveStoredState();
  render();
}
export function saveHistoryMetrics(form) {
  const date = form.querySelector('[name="history-date"]').value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > todayKey() || !validRecordDate(date)) return showToast("请选择有效的过去日期");
  const record = {
    ...(state.dailyRecords[date] || runtime.historyRows?.find((row) => row.date === date)?.record || createBlankDailyRecord(date)),
  };
  for (const key of ["weight", "waist"]) {
    const raw = form.querySelector(`[name="history-${key}"]`).value;
    if (!raw) continue;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < (key === "weight" ? 40 : 50) || value > (key === "weight" ? 200 : 180))
      return showToast("请输入有效身体指标");
    record[key] = value;
    upsertMetricLog(`${key}Logs`, value, date);
    if (date === todayKey()) state[key] = value;
  }
  record.updatedAt = new Date().toISOString();
  state.dailyRecords[date] = record;
  if (date !== todayKey())
    void saveHistoryEdit(date, record).catch((error) => {
      state.syncErrorKind = "storage";
      state.syncError = error.message;
      render();
      showToast(error.message);
    });
  saveStoredState();
  render();
  showToast("所选日期的指标已保存");
}
export function deleteHistoryActivity(control) {
  const date = control.dataset.recordDate;
  if (date === todayKey()) return;
  const record = state.dailyRecords[date] || runtime.historyRows?.find((row) => row.date === date)?.record;
  if (!record) return;
  state.dailyRecords[date] = record;
  record.customActivities = (record.customActivities || []).filter(
    (item, index) => String(item.id ?? index) !== control.dataset.deleteHistoryActivity,
  );
  record.updatedAt = new Date().toISOString();
  void saveHistoryEdit(date, record).catch((error) => {
    state.syncErrorKind = "storage";
    state.syncError = error.message;
    render();
    showToast(error.message);
  });
  saveStoredState();
  render();
}

export function resolveSnapshotConflict(control) {
  const index = Number(control.dataset.snapshotConflict);
  const conflict = state.recordConflicts?.[index];
  if (!conflict) return;
  let target = conflict.path[0] === "meals" ? meals : state;
  for (const key of conflict.path.slice(1, -1)) {
    target = Array.isArray(target)
      ? target.find((item) => String(item.id ?? item.date) === key.slice(key.indexOf(":") + 1))
      : target?.[key];
    if (!target) return showToast("记录已发生变化，双方冲突值仍保留");
  }
  if (control.dataset.conflictChoice === "remote") target[conflict.path.at(-1)] = structuredClone(conflict.remote);
  if (conflict.path[1] === "dailyRecords" && conflict.path[2] === todayKey()) applyDailyRecord(state.dailyRecords[todayKey()]);
  if (["weightLogs", "waistLogs"].includes(conflict.path[1])) {
    const field = conflict.path[1] === "weightLogs" ? "weight" : "waist";
    const today = state[conflict.path[1]].find((item) => item.date === todayKey());
    if (today) state[field] = today.value;
  }
  state.recordConflicts.splice(index, 1);
  meals.splice(0, meals.length, ...normalizeMealList(meals));
  saveStoredState();
  render();
}
