import { state, runtime } from "../app-state.js";
import { currentTimeLabel } from "../app-utils.js";
import { estimateCalories, todayPlanWorkout } from "../app-logic.js";
import { saveStoredState, saveStoredStateThrottled } from "../app-sync.js";
import { render, showToast, scrollSurfaceTo, focusTaskSnapshot, handleFocusTaskTransitions } from "./services.js";

export function completeWorkoutFromCard() {
  if (state.workoutDone) return;
  const previousFocusTasks = focusTaskSnapshot();
  state.workoutDone = true;
  saveStoredState();
  handleFocusTaskTransitions(previousFocusTasks, '[data-tab="training"]');
  render();
}

export function selectWorkoutType(type) {
  state.activityDraft.type = type;
  saveStoredState();
  render();
  setTimeout(() => scrollSurfaceTo(".activity-form-card"), 0);
}

export function undoActivityRemoval() {
  if (!state.undoActivity) return;
  const previousFocusTasks = focusTaskSnapshot();
  state.customActivities.unshift(state.undoActivity);
  state.undoActivity = null;
  state.workoutDone = true;
  clearTimeout(runtime.undoTimer);
  saveStoredState();
  handleFocusTaskTransitions(previousFocusTasks, "[data-undo-activity]");
  render();
}

export function handleActivityMinutesInput(input) {
  state.activityDraft.minutes = Math.min(180, Math.max(5, Number(input.value || 5)));
  document.querySelectorAll("[data-activity-estimate]").forEach((label) => {
    const estimate = estimateCalories(state.activityDraft.type, state.activityDraft.minutes);
    label.textContent = label.tagName === "B" ? String(estimate) : `预估 ${estimate} kcal`;
  });
  saveStoredStateThrottled();
}

export function applyTodayTrainingPlan() {
  const plan = todayPlanWorkout();
  state.activityDraft.type = plan.type;
  state.activityDraft.minutes = plan.minutes;
  state.activityDraft.name = plan.focus;
  saveStoredState();
  showToast("已套用今日训练安排");
  render();
  setTimeout(() => scrollSurfaceTo(".activity-form-card"), 0);
}

export function addActivityFromDraft() {
  const name = state.activityDraft.name.trim() || state.activityDraft.type;
  const minutes = Math.min(180, Math.max(5, Number(state.activityDraft.minutes || 30)));
  const fingerprint = JSON.stringify([name, state.activityDraft.type, minutes]);
  const committedAt = Date.now();
  const draftWasReset = !state.activityDraft.name.trim() && Number(state.activityDraft.minutes || 30) === 30;
  if (committedAt - runtime.lastActivityCommitAt < 500 && (runtime.lastActivityCommitFingerprint === fingerprint || draftWasReset))
    return false;
  runtime.lastActivityCommitFingerprint = fingerprint;
  runtime.lastActivityCommitAt = committedAt;
  const previousFocusTasks = focusTaskSnapshot();
  state.customActivities.unshift({
    id: committedAt,
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
  handleFocusTaskTransitions(previousFocusTasks, "[data-add-activity]");
  render();
  return true;
}

export function removeActivity(id) {
  const removed = state.customActivities.find((item) => String(item.id) === String(id));
  state.customActivities = state.customActivities.filter((item) => String(item.id) !== String(id));
  state.workoutDone = state.customActivities.length > 0;
  state.undoActivity = removed || null;
  clearTimeout(runtime.undoTimer);
  if (removed) {
    runtime.undoTimer = setTimeout(() => {
      state.undoActivity = null;
      render();
    }, 5000);
  }
  saveStoredState();
  render();
}
