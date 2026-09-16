import { state, runtime, AUTH_EMAIL_KEY } from "./app-state.js";
import {
  setSyncFeedbackHandler,
  clearLegacyAuthStorage,
  readStorageValue,
  refreshSession,
  resetAppData,
  loadStoredState,
  loadTrustedOfflineState,
  loadServerState,
  saveStoredState,
  saveStoredStateThrottled,
  syncStateNow,
  scheduleSyncRetry,
  flushPendingInputSave,
} from "./app-sync.js";
import { hasBlockingOverlay } from "./app-render.js";
import { rolloverToTodayIfNeeded } from "./app-data.js";
import {
  render,
  showToast,
  activateTab,
  tabFromLocation,
  handleTabLocationChange,
  selectChartPoint,
  handleChartPointEvent,
  chartPointNearPointer,
  handleChartPointerMove,
  activeDialogElement,
  getSettingsFocusableElements,
  dismissCelebration,
  scrollToMealForm,
  scrollSurfaceTo,
  focusSettingsPanel,
  scheduleLocalReminder,
  safeVibrate,
  runExclusiveAction,
} from "./actions/services.js";
import {
  addMealDraft,
  updateMealDraftFromForm,
  recognizeMealNutrition,
  cancelMealNutrition,
  saveCurrentMealAsTemplate,
  useMealTemplate,
  repeatMeal,
  applyMealPlateOption,
  selectDietScenario,
  applyDietScenario,
  startMealDraftFromSlot,
} from "./actions/meal.js";
import {
  checkAuthReadiness,
  submitEmailAuth,
  logout,
  deleteAccount,
  togglePasswordVisibility,
  switchAuthMode,
  useLocalAuthProvider,
  useCloudAuthProvider,
  handleAuthEmailInput,
  handleAuthPasswordInput,
} from "./actions/auth.js";
import {
  openSettings,
  closeSettings,
  openClearConfirm,
  closeClearConfirm,
  openDeleteAccountConfirm,
  closeDeleteAccountConfirm,
  settingsValuesFromForm,
  validateCoreSettings,
  saveSettingsFromForm,
  completeSetupFromForm,
  exportUserData,
  clearUserData,
  applyRecommendedCalories,
  handleSettingControlInput,
} from "./actions/settings.js";
import {
  completeWorkoutFromCard,
  selectWorkoutType,
  addActivityFromDraft,
  removeActivity,
  undoActivityRemoval,
  handleActivityMinutesInput,
  applyTodayTrainingPlan,
} from "./actions/training.js";
import { adjustHabitMetric, toggleTaskByLabel, followCoachAction, saveBodyMetricsFromForm, focusBodyFormInput } from "./actions/home.js";

// ── 事件路由表 ─────────────────────────────────────────────
// 分发只查表：新增交互在对应表里加一行，不再改动分发函数本身。
// click/input/change 表按声明顺序匹配，必须与既有分支的优先级一致。

const mealDraftFieldSelector =
  "[data-meal-slot], [data-meal-calories], [data-meal-food], [data-meal-amount], [data-meal-unit], [data-meal-cooking], [data-meal-oil], [data-meal-sauce], [data-meal-protein], [data-meal-carbs], [data-meal-fat]";
let delegatedEventsBound = false;
let dayBoundaryTimer;
let reconnectPromise;

async function retryConnection({ silent = false } = {}) {
  if (reconnectPromise) return reconnectPromise;
  if (runtime.authSessionStatus !== "offline-unverified" && !runtime.offlineSyncReadRequired) return syncStateNow({ silent });
  runtime.offlineSyncReadRequired = true;
  flushPendingInputSave();
  reconnectPromise = (async () => {
    const session = await refreshSession({ detailed: true });
    if (session.reason === "stale-session") return false;
    if (session.status === "authenticated") {
      const generation = runtime.authSessionGeneration;
      state.authRequired = false;
      // Read and merge the current server revision before sending offline edits.
      const loaded = await loadServerState();
      if (generation !== runtime.authSessionGeneration) return false;
      if (loaded) runtime.offlineSyncReadRequired = false;
      if (loaded && state.syncPending) await syncStateNow({ silent });
      render();
      return loaded;
    }
    if (session.status === "offline-unverified" && loadTrustedOfflineState()) {
      render();
      return false;
    }
    resetAppData({ blank: true });
    state.authRequired = true;
    state.authEmail = readStorageValue(AUTH_EMAIL_KEY);
    render();
    void checkAuthReadiness({ force: true });
    return false;
  })();
  try {
    return await reconnectPromise;
  } finally {
    reconnectPromise = null;
  }
}

function refreshCurrentDay({ renderNow = true } = {}) {
  if (state.authRequired || state.appLoading || !rolloverToTodayIfNeeded()) return false;
  saveStoredState();
  if (renderNow) render();
  return true;
}

function scheduleDayBoundary() {
  clearTimeout(dayBoundaryTimer);
  const nextDay = new Date();
  nextDay.setHours(24, 0, 0, 0);
  dayBoundaryTimer = setTimeout(
    () => {
      refreshCurrentDay();
      scheduleDayBoundary();
    },
    Math.max(1, nextDay.getTime() - Date.now()),
  );
}

function handleAppActionCommand(action) {
  if (action === "settings" || action === "goal") openSettings(action);
  else showToast(action === "week" ? "当前已展示 7 天趋势" : "操作已记录");
}

function activateWeekTab(nextTab) {
  activateTab(nextTab || "home");
  render();
  if (state.activeTab === "diet") setTimeout(() => scrollToMealForm(), 0);
  if (state.activeTab === "training") setTimeout(() => scrollSurfaceTo(".activity-form-card"), 0);
}

const submitRoutes = [
  { selector: "[data-auth-form]", run: () => void submitEmailAuth() },
  { selector: "[data-setup-form]", run: () => completeSetupFromForm() },
  { selector: "[data-settings-form]", run: () => void saveSettingsFromForm() },
  { selector: "[data-body-form]", run: () => saveBodyMetricsFromForm() },
  {
    selector: "[data-meal-form]",
    run: () => {
      updateMealDraftFromForm();
      addMealDraft();
      render();
    },
  },
];

function handleAppSubmit(event) {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  for (const route of submitRoutes) {
    if (form.matches(route.selector)) {
      event.preventDefault();
      const changedDay = refreshCurrentDay({ renderNow: false });
      route.run(form);
      if (changedDay) render();
      return;
    }
  }
}

const inputRoutes = [
  { selector: "[data-auth-email]", run: handleAuthEmailInput },
  { selector: "[data-auth-password]", run: handleAuthPasswordInput },
  {
    selector: "[data-weight-input]",
    run: (input) => {
      state.weightDraft = Number(input.value || state.weight);
    },
  },
  {
    selector: "[data-waist-input]",
    run: (input) => {
      state.waistDraft = Number(input.value || state.waist);
    },
  },
  {
    selector: "[data-activity-name]",
    run: (input) => {
      state.activityDraft.name = input.value;
      saveStoredStateThrottled();
    },
  },
  { selector: "[data-activity-minutes]", run: handleActivityMinutesInput },
  {
    selector: mealDraftFieldSelector,
    run: () => {
      updateMealDraftFromForm();
      saveStoredStateThrottled();
    },
  },
  {
    selector: "[data-setting-control]",
    run: handleSettingControlInput,
  },
];

function handleAppInput(event) {
  const input = event.target;
  if (!(input instanceof Element)) return;
  for (const route of inputRoutes) {
    if (input.matches(route.selector)) {
      const changedDay = refreshCurrentDay({ renderNow: false });
      route.run(input);
      if (changedDay) render();
      return;
    }
  }
}

const changeRoutes = [
  { selector: "[data-setting-control]", run: handleSettingControlInput },
  {
    selector: "[data-activity-type]",
    run: (input) => {
      state.activityDraft.type = input.value;
      saveStoredState();
      render();
    },
  },
  {
    selector: mealDraftFieldSelector,
    run: () => {
      updateMealDraftFromForm();
      saveStoredState();
    },
  },
];

function handleAppChange(event) {
  const input = event.target;
  if (!(input instanceof Element)) return;
  for (const route of changeRoutes) {
    if (input.matches(route.selector)) {
      const changedDay = refreshCurrentDay({ renderNow: false });
      route.run(input);
      if (changedDay) render();
      return;
    }
  }
}

function handleAppToggle(event) {
  const details = event.target;
  if (!(details instanceof HTMLDetailsElement) || !details.matches(".advanced-fields")) return;
  const changedDay = refreshCurrentDay({ renderNow: false });
  state.mealDraft.advancedOpen = details.open;
  saveStoredState();
  if (changedDay) render();
}

const clickRoutes = [
  {
    selector: "[data-tab]",
    prevent: true,
    run: (control) => {
      activateTab(control.dataset.tab);
      render();
    },
  },
  { selector: "[data-chart-point]", run: (control) => selectChartPoint(control) },
  {
    selector: ".chart-point-layer",
    run: (layer, event) => {
      const point = chartPointNearPointer(layer, event.clientX, event.clientY);
      if (point) selectChartPoint(point);
    },
  },
  { selector: "[data-toggle-password]", run: togglePasswordVisibility },
  { selector: "[data-auth-mode]", run: (control) => switchAuthMode(control.dataset.authMode) },
  { selector: "[data-retry-auth-service]", run: () => void checkAuthReadiness({ force: true }) },
  { selector: "[data-use-local-auth]", run: useLocalAuthProvider },
  { selector: "[data-use-cloud-auth]", run: useCloudAuthProvider },
  { selector: "[data-complete-workout]", run: completeWorkoutFromCard },
  { selector: "[data-scroll-body-form]", run: focusBodyFormInput },
  { selector: "[data-logout]", run: () => void logout() },
  { selector: "[data-sync-now]", run: () => void retryConnection() },
  { selector: "[data-export-data]", run: exportUserData },
  { selector: "[data-clear-data]", run: openClearConfirm },
  { selector: "[data-delete-account]", run: openDeleteAccountConfirm },
  { selector: "[data-add-activity]", run: addActivityFromDraft },
  { selector: "[data-delete-activity]", run: (control) => removeActivity(control.dataset.deleteActivity) },
  { selector: "[data-undo-activity]", run: undoActivityRemoval },
  { selector: "[data-save-template]", run: saveCurrentMealAsTemplate },
  { selector: "[data-use-template]", run: (control) => useMealTemplate(control.dataset.useTemplate) },
  { selector: "[data-repeat-meal]", run: (control) => repeatMeal(control.dataset.repeatMeal) },
  { selector: "[data-plate-option]", run: (control) => applyMealPlateOption(control.dataset.plateOption) },
  { selector: "[data-diet-scenario]", run: (control) => selectDietScenario(control.dataset.dietScenario) },
  { selector: "[data-apply-scenario]", run: (control) => applyDietScenario(control.dataset.applyScenario) },
  { selector: "[data-ai-nutrition]", run: () => void recognizeMealNutrition() },
  { selector: "[data-cancel-ai]", run: () => cancelMealNutrition() },
  { selector: "[data-scroll-meal-form]", run: () => scrollToMealForm() },
  { selector: "[data-record-meal]", run: (control) => startMealDraftFromSlot(control.dataset.recordMeal) },
  { selector: "[data-toggle-task]", run: (control) => toggleTaskByLabel(control.dataset.toggleTask) },
  {
    selector: "[data-habit-step]",
    run: (control) => adjustHabitMetric(control.dataset.habitStep, Number(control.dataset.stepDirection || 1)),
  },
  { selector: "[data-coach-action]", run: (control) => followCoachAction(control.dataset.coachAction) },
  { selector: "[data-select-workout]", run: (control) => selectWorkoutType(control.dataset.selectWorkout) },
  { selector: "[data-app-action]", run: (control) => handleAppActionCommand(control.dataset.appAction) },
  { selector: "[data-week-action]", run: (control) => activateWeekTab(control.dataset.weekAction) },
  {
    selector: "[data-close-settings]",
    run: () => {
      if (runtime.pendingActions.has("saveSettings")) return;
      closeSettings();
    },
  },
  {
    selector: "[data-close-clear-confirm]",
    run: () => {
      if (runtime.pendingActions.has("clearData")) return;
      closeClearConfirm();
    },
  },
  { selector: "[data-confirm-clear-data]", run: () => void clearUserData() },
  {
    selector: "[data-close-delete-account]",
    run: () => {
      if (runtime.pendingActions.has("deleteAccount")) return;
      closeDeleteAccountConfirm();
    },
  },
  { selector: "[data-confirm-delete-account]", run: () => void deleteAccount() },
  { selector: "[data-dismiss-celebration]", run: () => dismissCelebration() },
  { selector: "[data-apply-calorie]", run: applyRecommendedCalories },
  { selector: "[data-apply-today-plan]", run: applyTodayTrainingPlan },
];

function handleAppClick(event) {
  const target = event.target;
  if (!(target instanceof Element)) return;
  for (const route of clickRoutes) {
    const control = target.closest(route.selector);
    if (!control) continue;
    if (route.prevent) event.preventDefault();
    const changedDay = refreshCurrentDay({ renderNow: false });
    route.run(control, event);
    if (changedDay) render();
    return;
  }
}

function handleGlobalKeydown(event) {
  const chartPoint = event.target instanceof Element ? event.target.closest("[data-chart-point]") : null;
  if (chartPoint && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
    const points = Array.from(chartPoint.closest("[data-line-chart]")?.querySelectorAll("[data-chart-point]") || []);
    const index = points.indexOf(chartPoint);
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? points.length - 1
          : Math.min(points.length - 1, Math.max(0, index + (event.key === "ArrowRight" ? 1 : -1)));
    if (points[nextIndex]) {
      event.preventDefault();
      selectChartPoint(points[nextIndex], { moveFocus: true });
    }
    return;
  }
  if (!hasBlockingOverlay() && !runtime.celebrationOpen) return;
  if (event.key === "Escape") {
    if (runtime.celebrationOpen) dismissCelebration();
    else if (state.deleteAccountOpen && !runtime.pendingActions.has("deleteAccount")) closeDeleteAccountConfirm();
    else if (state.clearConfirmOpen && !runtime.pendingActions.has("clearData")) closeClearConfirm();
    else if (state.settingsOpen && !runtime.pendingActions.has("saveSettings")) closeSettings();
    return;
  }
  if (event.key !== "Tab") return;

  const focusable = getSettingsFocusableElements();
  if (!focusable.length) {
    event.preventDefault();
    activeDialogElement()?.focus({ preventScroll: true });
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const dialog = activeDialogElement();
  if (!dialog?.contains(document.activeElement)) {
    event.preventDefault();
    first.focus({ preventScroll: true });
    return;
  }
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus({ preventScroll: true });
    return;
  }
  if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus({ preventScroll: true });
  }
}

function bindEvents() {
  if (delegatedEventsBound) return;
  const root = document.querySelector("#app");
  if (!root) return;
  delegatedEventsBound = true;
  root.addEventListener("submit", handleAppSubmit);
  root.addEventListener("input", handleAppInput);
  root.addEventListener("change", handleAppChange);
  root.addEventListener("click", handleAppClick);
  root.addEventListener("focusin", handleChartPointEvent);
  root.addEventListener("pointermove", handleChartPointerMove);
  root.addEventListener("toggle", handleAppToggle, true);
  document.addEventListener("keydown", handleGlobalKeydown);
  window.addEventListener("popstate", handleTabLocationChange);
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || window.location.protocol === "file:") return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      // Service worker support is a progressive enhancement.
    });
  });
}

function bindConnectivityRetry() {
  scheduleDayBoundary();
  window.addEventListener("online", () => {
    if (runtime.authSessionStatus === "offline-unverified" || runtime.offlineSyncReadRequired) {
      void retryConnection();
      return;
    }
    if (state.authRequired && state.authServiceStatus !== "ready") void checkAuthReadiness({ force: true });
    if (state.syncPending || state.backendStatus === "local" || state.backendStatus === "offline") {
      void retryConnection();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushPendingInputSave();
    if (document.visibilityState === "visible") {
      refreshCurrentDay({ renderNow: false });
      scheduleDayBoundary();
      if (!state.authRequired) render();
      if ((runtime.authSessionStatus === "offline-unverified" || runtime.offlineSyncReadRequired) && navigator.onLine !== false) {
        void retryConnection({ silent: true });
      }
    }
    if (document.visibilityState === "visible" && (state.syncPending || state.backendStatus === "local")) {
      scheduleSyncRetry({ silent: true, delay: 0 });
    }
  });
  window.addEventListener("pagehide", flushPendingInputSave);
}

async function initApp() {
  // 事件监听挂在持久的 #app/document/window 上，绑定一次即可；
  // root.innerHTML 重建不会移除挂载点，render() 无需重复绑定。
  bindEvents();
  const requestedSettingsRoute = location.hash === "#settings";
  state.appLoading = true;
  clearLegacyAuthStorage();
  state.authEmail = readStorageValue(AUTH_EMAIL_KEY);
  state.authProvider = runtime.authProvider;
  if (requestedSettingsRoute) state.activeTab = "profile";
  else activateTab(tabFromLocation("home"), { replace: !tabFromLocation(), transition: false });
  state.settingsOpen = false;
  state.clearConfirmOpen = false;
  state.deleteAccountOpen = false;
  state.authRequired = true;
  state.authError = "";
  state.authFieldErrors = {};
  state.authServiceStatus = "checking";
  state.authServiceMessage = "正在检查认证服务…";
  state.authServiceCode = "";
  render();
  const session = await refreshSession({ detailed: true });
  if (session.reason === "stale-session") return;
  state.appLoading = false;
  state.backendStatus = runtime.accessToken ? "connecting" : "idle";
  if (runtime.accessToken) {
    runtime.offlineSyncReadRequired = true;
    resetAppData({ blank: true });
    loadStoredState();
    state.authRequired = false;
    state.authEmail = readStorageValue(AUTH_EMAIL_KEY);
    state.settingsOpen = requestedSettingsRoute && state.setupCompleted;
    state.authServiceStatus = "ready";
    state.authServiceMessage = "认证会话有效。";
    state.authServiceCode = "AUTH_SESSION_READY";
  } else if (session.status === "offline-unverified" && loadTrustedOfflineState()) {
    state.activeTab = requestedSettingsRoute ? "profile" : tabFromLocation("home");
    state.authEmail = readStorageValue(AUTH_EMAIL_KEY);
    state.settingsOpen = requestedSettingsRoute && state.setupCompleted;
  }
  render();
  if (state.authRequired) await checkAuthReadiness();
  if (hasBlockingOverlay()) requestAnimationFrame(focusSettingsPanel);
  const loadedFromServer = runtime.accessToken ? await loadServerState() : false;
  if (loadedFromServer) {
    runtime.offlineSyncReadRequired = false;
    if (state.syncPending) await syncStateNow();
    state.activeTab = requestedSettingsRoute ? "profile" : tabFromLocation("home");
    state.settingsOpen = requestedSettingsRoute && state.setupCompleted;
    state.clearConfirmOpen = false;
    state.deleteAccountOpen = false;
    render();
    if (hasBlockingOverlay()) requestAnimationFrame(focusSettingsPanel);
  }
  scheduleLocalReminder();
}

setSyncFeedbackHandler(showToast);

export {
  showToast,
  registerServiceWorker,
  bindConnectivityRetry,
  initApp,
  render,
  validateCoreSettings,
  settingsValuesFromForm,
  recognizeMealNutrition,
  cancelMealNutrition,
  safeVibrate,
  runExclusiveAction,
  checkAuthReadiness,
};
