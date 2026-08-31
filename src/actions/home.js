import { state } from "../app-state.js";
import { motionPreference } from "../app-utils.js";
import { todayTasks } from "../app-logic.js";
import { upsertMetricLog, saveStoredState } from "../app-sync.js";
import {
  render,
  showToast,
  activateTab,
  scrollSurfaceTo,
  scrollToMealForm,
  focusTaskSnapshot,
  handleFocusTaskTransitions,
} from "./services.js";

export function adjustHabitMetric(key, direction) {
  const previousFocusTasks = focusTaskSnapshot();
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
  handleFocusTaskTransitions(previousFocusTasks, `[data-habit-step="${key}"][data-step-direction="1"]`);
  render();
}

export function toggleTaskByLabel(label) {
  const previousFocusTasks = focusTaskSnapshot();
  const task = todayTasks().find((item) => item.label === label);
  state.taskOverrides[label] = !task?.done;
  saveStoredState();
  handleFocusTaskTransitions(previousFocusTasks, `[data-toggle-task="${label}"]`);
  render();
}

export function followCoachAction(nextTab) {
  activateTab(nextTab);
  render();
  setTimeout(() => {
    if (nextTab === "diet") scrollToMealForm();
    else scrollSurfaceTo(".activity-form-card");
  }, 0);
}

export function saveBodyMetricsFromForm() {
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
  upsertMetricLog("weightLogs", state.weight);
  upsertMetricLog("waistLogs", state.waist);
  saveStoredState();
  showToast("今日体重和腰围已更新");
  render();
}

export function focusBodyFormInput() {
  scrollSurfaceTo("#body-record-form");
  const delay = motionPreference() === "auto" ? 0 : 240;
  setTimeout(() => document.querySelector("[data-weight-input]")?.focus({ preventScroll: true }), delay);
}
