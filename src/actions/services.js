import { state, runtime } from "../app-state.js";
import { todayKey, motionPreference } from "../app-utils.js";
import { todayTasks } from "../app-logic.js";
import {
  appShell,
  shellSignature,
  patchCurrentPage,
  renderCurrentPage,
  hydrateDynamicStyles,
  captureSettingsPanelState,
  restoreSettingsPanelState,
} from "../app-render.js";

const tabKeys = new Set(["home", "diet", "training", "data", "profile"]);
const focusTaskLabels = ["饮食记录", "训练", "喝水"];
const CELEBRATION_STORAGE_PREFIX = "fat-loss-celebration";

export function tabFromLocation(fallback = null) {
  const tab = location.hash.replace(/^#tab-/, "");
  return tabKeys.has(tab) ? tab : fallback;
}

export function activateTab(tab, { replace = false, transition = true } = {}) {
  if (!tabKeys.has(tab)) return false;
  const changed = state.activeTab !== tab;
  state.activeTab = tab;
  if (changed && transition) runtime.pendingTabEnter = true;
  const nextHash = `#tab-${tab}`;
  if (location.hash === nextHash) return changed;
  history[replace ? "replaceState" : "pushState"](null, "", nextHash);
  return changed;
}

export function handleTabLocationChange() {
  if (location.hash === "#settings" && !state.authRequired && state.setupCompleted) {
    state.settingsOpen = true;
    state.clearConfirmOpen = false;
    state.deleteAccountOpen = false;
    render();
    requestAnimationFrame(focusSettingsPanel);
    return;
  }
  if (state.settingsOpen) {
    state.settingsOpen = false;
    state.setupFieldErrors = {};
    state.settingsDraft = null;
  }
  const tab = tabFromLocation();
  if (tab && !state.authRequired && state.setupCompleted) activateTab(tab);
  render();
}

export function showToast(message) {
  state.toast = message;
  render();
  clearTimeout(runtime.toastTimer);
  runtime.toastTimer = setTimeout(() => {
    state.toast = "";
    render();
  }, 1600);
}

function reminderDelayMs() {
  const configuredTime = String(state.preferences.reminderTime || "");
  const safeTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(configuredTime) ? configuredTime : "21:30";
  const [hour, minute] = safeTime.split(":");
  const target = new Date();
  target.setHours(Number(hour), Number(minute), 0, 0);
  if (target.getTime() <= Date.now()) target.setDate(target.getDate() + 1);
  return target.getTime() - Date.now();
}

export function scheduleLocalReminder() {
  clearTimeout(runtime.reminderTimer);
  if (!state.preferences.pushEnabled) return;
  runtime.reminderTimer = setTimeout(() => {
    const message = "记得补全今天的饮食、训练和体重记录";
    showToast(message);
    void showSystemReminder(message);
    scheduleLocalReminder();
  }, reminderDelayMs());
}

export async function showSystemReminder(message) {
  if (!("Notification" in window) || Notification.permission !== "granted" || !("serviceWorker" in navigator)) return false;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration || typeof registration.showNotification !== "function") return false;
    await registration.showNotification("稳减记录提醒", {
      body: message,
      icon: "/src/app-icon-192.png",
      tag: "daily-record-reminder",
    });
    return true;
  } catch {
    // 系统通知失败不能阻断应用内提醒、下一次排程或设置保存。
    return false;
  }
}

export async function ensureReminderPermission() {
  if (!state.preferences.pushEnabled) return false;
  if (!("Notification" in window)) {
    showToast("此浏览器不支持系统通知，应用打开时仍会提醒");
    return false;
  }
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") {
    showToast("没有系统通知权限，应用打开时仍会提醒");
    return false;
  }
  try {
    const permission = await Notification.requestPermission();
    if (permission === "granted") return true;
  } catch {
    // 权限 API 在部分浏览器/非用户手势场景会拒绝；应用内计时仍然有效。
  }
  showToast("没有系统通知权限，应用打开时仍会提醒");
  return false;
}

export function scrollSurfaceTo(selector) {
  document.querySelector(selector)?.scrollIntoView({ behavior: motionPreference(), block: "start" });
}

export function scrollToMealForm(shouldFocus = true) {
  scrollSurfaceTo("#meal-form");
  if (!shouldFocus) return;
  const delay = motionPreference() === "auto" ? 0 : 360;
  setTimeout(() => {
    document.querySelector("[data-meal-food]")?.focus({ preventScroll: true });
  }, delay);
}

export function selectChartPoint(control, { moveFocus = false } = {}) {
  if (!(control instanceof HTMLElement)) return false;
  const chart = control.closest("[data-line-chart]");
  const output = chart?.querySelector(".chart-tooltip");
  if (!(output instanceof HTMLOutputElement)) return false;
  chart.querySelectorAll("[data-chart-point]").forEach((point) => {
    const selected = point === control;
    point.classList.toggle("is-selected", selected);
    point.setAttribute("aria-pressed", String(selected));
  });
  output.textContent = control.dataset.chartLabel || "";
  output.hidden = false;
  output.dataset.placement = Number(control.dataset.chartY || 0) < 58 ? "below" : "above";
  output.style.setProperty("--tooltip-x", control.style.getPropertyValue("--point-x") || "50%");
  output.style.setProperty("--tooltip-y", control.style.getPropertyValue("--point-y") || "50%");
  if (moveFocus) control.focus({ preventScroll: true });
  return true;
}

export function handleChartPointEvent(event) {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const control = target.closest("[data-chart-point]");
  if (control) selectChartPoint(control);
}

export function chartPointNearPointer(layer, clientX, clientY, maxDistance = 30) {
  const points = Array.from(layer.querySelectorAll("[data-chart-point]"));
  let nearest = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  points.forEach((point) => {
    const rect = point.getBoundingClientRect();
    const distance = Math.hypot(clientX - (rect.left + rect.width / 2), clientY - (rect.top + rect.height / 2));
    if (distance < nearestDistance) {
      nearest = point;
      nearestDistance = distance;
    }
  });
  return nearestDistance <= maxDistance ? nearest : null;
}

export function handleChartPointerMove(event) {
  const target = event.target;
  if (!(target instanceof Element) || (event.pointerType && event.pointerType !== "mouse")) return;
  const layer = target.closest(".chart-point-layer");
  if (!layer) return;
  const point = chartPointNearPointer(layer, event.clientX, event.clientY);
  if (point) selectChartPoint(point);
}

function animateHomeCountUps({ force = false } = {}) {
  const controls = document.querySelectorAll("[data-count-up]");
  if (!controls.length) return;
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
  controls.forEach((control) => {
    const key = control.dataset.countKey || "metric";
    const target = Number(control.dataset.countValue || 0);
    const decimals = Math.max(0, Number(control.dataset.countDecimals || 0));
    const previous = runtime.countUpValues.get(key);
    runtime.countUpValues.set(key, target);
    const shouldAnimate = !reduceMotion && Number.isFinite(target) && (force || (Number.isFinite(previous) && previous !== target));
    if (!shouldAnimate) {
      control.textContent = target.toFixed(decimals);
      return;
    }
    const start = Number.isFinite(previous) && previous !== target ? previous : target >= 10 ? target * 0.82 : 0;
    control.textContent = start.toFixed(decimals);
    const startedAt = performance.now();
    const duration = 400;
    const frame = (now) => {
      if (!control.isConnected) return;
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      control.textContent = (start + (target - start) * eased).toFixed(decimals);
      if (progress < 1) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}

export function activeDialogElement() {
  if (runtime.celebrationOpen) return document.querySelector("[data-celebration-dialog]");
  if (state.deleteAccountOpen) return document.querySelector(".confirm-sheet");
  if (state.clearConfirmOpen) return document.querySelector(".confirm-sheet");
  if (state.settingsOpen) return document.querySelector(".settings-sheet");
  return null;
}

export function focusSettingsPanel() {
  const dialog = activeDialogElement();
  if (!dialog) return;
  const target = getSettingsFocusableElements()[0];
  (target || dialog).focus({ preventScroll: true });
}

export function getSettingsFocusableElements() {
  const dialog = activeDialogElement();
  if (!dialog) return [];
  return Array.from(dialog.querySelectorAll("button, input, select, textarea, [href], [tabindex]:not([tabindex='-1'])")).filter(
    (element) => !element.disabled && element.offsetParent !== null,
  );
}

export function focusTaskSnapshot() {
  const tasks = todayTasks();
  return Object.fromEntries(focusTaskLabels.map((label) => [label, Boolean(tasks.find((task) => task.label === label)?.done)]));
}

export function safeVibrate(duration = 10) {
  try {
    if (typeof navigator.vibrate === "function") navigator.vibrate(duration);
  } catch {
    // Haptics are optional and must never interrupt a committed record.
  }
}

function celebrationStorageKey() {
  const provider = state.authProvider === "local" ? "local" : "supabase";
  const userId = runtime.authUserId || "device";
  return `${CELEBRATION_STORAGE_PREFIX}:${provider}:${encodeURIComponent(userId)}`;
}

function hasCelebratedToday() {
  const key = celebrationStorageKey();
  const date = todayKey();
  if (runtime.celebrationSeenFallback.get(key) === date) return true;
  try {
    return localStorage.getItem(key) === date;
  } catch {
    return false;
  }
}

function markCelebratedToday() {
  const key = celebrationStorageKey();
  const date = todayKey();
  runtime.celebrationSeenFallback.set(key, date);
  try {
    localStorage.setItem(key, date);
  } catch {
    // The in-memory marker still enforces the cap for the current session.
  }
}

export function handleFocusTaskTransitions(previous, returnFocusSelector = "") {
  const current = focusTaskSnapshot();
  const completed = focusTaskLabels.filter((label) => !previous[label] && current[label]);
  if (!completed.length) return false;

  runtime.completionFeedback = { tasks: completed, at: Date.now() };
  runtime.completionAnnouncement = `${completed.join("、")}已完成`;
  clearTimeout(runtime.completionFeedbackTimer);
  runtime.completionFeedbackTimer = setTimeout(() => {
    runtime.completionFeedback = null;
    if (!runtime.celebrationOpen) runtime.completionAnnouncement = "";
  }, 900);

  safeVibrate();
  const wasComplete = focusTaskLabels.every((label) => previous[label]);
  const isComplete = focusTaskLabels.every((label) => current[label]);
  if (!wasComplete && isComplete && !hasCelebratedToday()) {
    markCelebratedToday();
    runtime.celebrationOpen = true;
    runtime.celebrationReturnSelector = returnFocusSelector;
    runtime.completionAnnouncement = "今日三件事已全部完成";
    requestAnimationFrame(focusSettingsPanel);
  }
  return true;
}

export function dismissCelebration(restoreFocus = true) {
  if (!runtime.celebrationOpen) return;
  const returnSelector = runtime.celebrationReturnSelector;
  runtime.celebrationOpen = false;
  runtime.celebrationReturnSelector = "";
  runtime.completionAnnouncement = "";
  render();
  if (!restoreFocus) return;
  requestAnimationFrame(() => {
    const preferred = returnSelector ? document.querySelector(returnSelector) : null;
    const fallback = document.querySelector(`[data-tab="${state.activeTab}"]`);
    const target = preferred instanceof HTMLElement && !preferred.matches(":disabled") ? preferred : fallback;
    target?.focus({ preventScroll: true });
  });
}

export async function runExclusiveAction(key, action) {
  if (runtime.pendingActions.has(key)) return false;
  runtime.pendingActions.add(key);
  render();
  try {
    return await action();
  } finally {
    runtime.pendingActions.delete(key);
    render();
  }
}

// 配置驱动的表单读取：字符串字段空值回落 fallback，数字字段统一 Number(raw || 0)
export function readFormValues(fields) {
  const values = {};
  fields.forEach((field) => {
    const raw = document.querySelector(field.selector)?.value;
    if (field.parse) values[field.key] = field.parse(raw);
    else if (field.numeric) values[field.key] = Number(raw || 0);
    else values[field.key] = raw || field.fallback || "";
  });
  return values;
}

export function clearInlineFieldError(input, errorStore, key, fallbackDescriptionId = "") {
  if (!errorStore?.[key]) return;
  delete errorStore[key];
  const field = input.closest(".field-label");
  field?.classList.remove("has-error");
  field?.querySelector(".field-error")?.remove();
  input.removeAttribute("aria-invalid");
  if (fallbackDescriptionId) input.setAttribute("aria-describedby", fallbackDescriptionId);
  else input.removeAttribute("aria-describedby");
}

export function render() {
  const root = document.querySelector("#app");
  if (!root) return;
  const animateHomeEntry = runtime.pendingTabEnter && state.activeTab === "home";
  // 签名一致时 shell 结构未变（同 tab、无 overlay、无加载/登录/引导切换），
  // 只有当前页数据可能变化——短路为局部替换，避免整棵 shell 重建。
  // 事件监听挂在持久的 #app/document/window 上，由 initApp 统一绑定一次。
  if (shellSignature() === runtime.lastShellSignature && patchCurrentPage(root)) {
    hydrateDynamicStyles(root);
    animateHomeCountUps({ force: animateHomeEntry });
    return;
  }
  const settingsPanelState = captureSettingsPanelState(root);
  root.innerHTML = appShell();
  runtime.pendingTabEnter = false;
  runtime.lastShellSignature = shellSignature();
  // 主应用分支下记录页面基线，让下一次签名一致的渲染可以比对跳过无关重建
  runtime.lastPageHtml = !state.appLoading && !state.authRequired && state.setupCompleted ? renderCurrentPage() : "";
  hydrateDynamicStyles(root);
  restoreSettingsPanelState(root, settingsPanelState);
  animateHomeCountUps({ force: animateHomeEntry });
}
