import { renderPasswordRecovery } from "./actions/account-recovery.js";
import { renderPrivacyInfo } from "./render/product-info.js";
import { state, navItems, runtime } from "./app-state.js";
import { isNativeApp } from "./native-runtime.js";
import { renderNativeCloudPanel } from "./render/native-cloud.js";
import { icon, escapeHtml } from "./app-utils.js";
import { isOfflineAccessTrusted } from "./app-storage.js";
import { estimateCalorieBudget, totalBurned } from "./app-logic.js";
import { numericSettingFields } from "./settings-fields.js";
import { loadingSpinner } from "./render/shared.js";
import { renderHome } from "./render/pages/home.js";
import { renderDietLab } from "./render/pages/diet.js";
import { renderTrainingLab } from "./render/pages/training.js";
import { renderDataLab } from "./render/pages/data.js";
import { renderProfileLab } from "./render/pages/profile.js";

export { renderHome } from "./render/pages/home.js";
export { renderDietLab } from "./render/pages/diet.js";
export { renderTrainingLab } from "./render/pages/training.js";
export { renderDataLab } from "./render/pages/data.js";
export { renderProfileLab } from "./render/pages/profile.js";

function hasBlockingOverlay() {
  return state.settingsOpen || state.clearConfirmOpen || state.deleteAccountOpen || runtime.celebrationOpen;
}

function toastBannerHtml() {
  return `<div class="toast-banner" role="status" aria-live="polite" aria-atomic="true">${escapeHtml(state.toast)}</div>`;
}

// 捕获所有决定 shell 结构（加载/登录/引导分支、tab、进场动画、overlay）的状态。
// 只有 render() 会写 #app，且签名在每次全量渲染后采集，因此签名一致即可断定
// 当前 DOM 的 shell 形状仍然有效，可以短路为只重建当前页内容。
function shellSignature() {
  return [
    state.appLoading ? 1 : 0,
    runtime.recoveryVerified ? 1 : 0,
    state.authRequired ? 1 : 0,
    state.setupCompleted ? 1 : 0,
    state.activeTab,
    runtime.pendingTabEnter ? 1 : 0,
    state.settingsOpen ? 1 : 0,
    state.clearConfirmOpen ? 1 : 0,
    state.deleteAccountOpen ? 1 : 0,
    runtime.celebrationOpen ? 1 : 0,
  ].join("|");
}

// overlay 打开期间面板内容可能随草稿变化，必须走全量渲染，这里直接放弃补丁。
function patchCurrentPage(root) {
  if (hasBlockingOverlay()) return false;
  const surface = root.querySelector(".app-surface");
  const nav = root.querySelector(".bottom-nav");
  const announcement = surface?.querySelector(":scope > p.sr-only[role='status']");
  if (!surface || !nav || !announcement) return false;
  if (root.querySelector(".settings-sheet, .confirm-sheet, [data-celebration-dialog]")) return false;
  if (surface.hasAttribute("inert") || nav.hasAttribute("inert")) return false;

  const existingToast = surface.querySelector(":scope > .toast-banner");
  if (!state.toast) {
    existingToast?.remove();
  } else if (!existingToast) {
    announcement.insertAdjacentHTML("beforebegin", toastBannerHtml());
  } else if (existingToast.textContent !== state.toast) {
    existingToast.outerHTML = toastBannerHtml();
  }

  const announcementText = runtime.completionAnnouncement || "";
  if (announcement.textContent !== announcementText) announcement.textContent = announcementText;

  const pageHtml = renderCurrentPage();
  if (pageHtml !== runtime.lastPageHtml) {
    // toast 清除、同步状态文案等异步渲染可能发生在用户输入中途，
    // 重建前抓取正在输入的控件，重建后恢复焦点与光标，避免打断输入。
    const focusState = captureFocusState(surface, announcement);
    let node = announcement.nextSibling;
    while (node) {
      const next = node.nextSibling;
      node.remove();
      node = next;
    }
    announcement.insertAdjacentHTML("afterend", pageHtml);
    runtime.lastPageHtml = pageHtml;
    restoreFocusState(surface, focusState);
  }
  // 签名一致意味着 pendingTabEnter 为 false，但上一次全量渲染可能带着进场动画类。
  surface.classList.remove("is-tab-entering");
  return true;
}

function focusTargetSelector(element) {
  const tag = element.tagName.toLowerCase();
  if (element.id) return `${tag}#${CSS.escape(element.id)}`;
  const name = element.getAttribute("name");
  if (name) return `${tag}[name="${CSS.escape(name)}"]`;
  const dataAttribute = Array.from(element.attributes)
    .filter((attribute) => attribute.name.startsWith("data-"))
    .sort((a, b) => a.name.localeCompare(b.name))[0];
  return dataAttribute ? `${tag}[${dataAttribute.name}="${CSS.escape(dataAttribute.value)}"]` : "";
}

function captureFocusState(surface, announcement = null) {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return null;
  if (!surface.contains(active)) return null;
  if (announcement && !(announcement.compareDocumentPosition(active) & Node.DOCUMENT_POSITION_FOLLOWING)) return null;
  const selector = focusTargetSelector(active);
  if (!selector) return null;
  // number、select、button 等不支持选区的控件只恢复焦点。
  const selectionStart = "selectionStart" in active && typeof active.selectionStart === "number" ? active.selectionStart : null;
  return {
    selector,
    index: Array.from(surface.querySelectorAll(selector)).indexOf(active),
    selectionStart,
    selectionEnd: "selectionEnd" in active && typeof active.selectionEnd === "number" ? active.selectionEnd : null,
  };
}

function restoreFocusState(surface, focusState) {
  if (!focusState) return;
  const candidates = Array.from(surface.querySelectorAll(focusState.selector));
  const next = candidates[focusState.index] || candidates[0];
  if (!(next instanceof HTMLElement)) return;
  next.focus({ preventScroll: true });
  if (focusState.selectionStart !== null && "selectionStart" in next && typeof next.selectionStart === "number") {
    next.setSelectionRange(focusState.selectionStart, focusState.selectionEnd);
  }
}

function captureSettingsPanelState(root) {
  const selector = state.settingsOpen ? ".settings-sheet" : "[data-setup-form]";
  const panel = root.querySelector(selector);
  if (!(panel instanceof HTMLElement)) return null;
  return {
    selector,
    scrollTop: panel.scrollTop,
    focusState: captureFocusState(panel),
  };
}

function restoreSettingsPanelState(root, panelState) {
  if (!panelState) return;
  const panel = root.querySelector(panelState.selector);
  if (!(panel instanceof HTMLElement)) return;
  panel.scrollTop = panelState.scrollTop;
  restoreFocusState(panel, panelState.focusState);
  // 某些浏览器聚焦控件后仍会微调滚动位置，最后再恢复一次。
  panel.scrollTop = panelState.scrollTop;
}

// CSP style-src 不含 'unsafe-inline'：动态样式值不能走 HTML style 属性注入，
// 只能渲染后经 CSSOM 写入。渲染时把数值放进 data-*，由本函数转为自定义属性。
export function hydrateDynamicStyles(root = document) {
  root.querySelectorAll("[data-progress]").forEach((element) => {
    element.style.setProperty("--progress", element.dataset.progress || "0");
  });
  root.querySelectorAll("[data-baseline]").forEach((element) => {
    element.style.setProperty("--baseline", element.dataset.baseline || "0");
  });
  root.querySelectorAll("[data-height]").forEach((element) => {
    element.style.setProperty("--height", element.dataset.height || "0");
  });
  root.querySelectorAll("[data-point-x]").forEach((element) => {
    element.style.setProperty("--point-x", `${element.dataset.pointX || 50}%`);
    element.style.setProperty("--point-y", `${element.dataset.pointY || 50}%`);
  });
}

function appShell() {
  const overlayOpen = hasBlockingOverlay();
  return `
    <a class="skip-link" href="#main-content">跳到主要内容</a>
    <main class="phone-shell" id="main-content">
      ${
        state.appLoading
          ? renderSkeletonScreen()
          : runtime.recoveryVerified
            ? renderPasswordRecovery()
            : state.authRequired
              ? renderLockScreen()
              : !state.setupCompleted
                ? renderOnboardingScreen()
                : `
        <section class="app-surface ${escapeHtml(runtime.pendingTabEnter ? "is-tab-entering" : "")}" data-page="${escapeHtml(state.activeTab)}" ${overlayOpen ? 'inert aria-hidden="true"' : ""}>
          ${state.toast ? toastBannerHtml() : ""}
          <p class="sr-only" role="status" aria-live="polite" aria-atomic="true">${escapeHtml(runtime.completionAnnouncement || "")}</p>
          ${renderCurrentPage()}
        </section>
        <nav class="bottom-nav" aria-label="底部导航" ${overlayOpen ? 'inert aria-hidden="true"' : ""}>
          ${navItems.map(renderNavItem).join("")}
        </nav>
        ${state.settingsOpen ? renderSettingsPanel() : ""}
        ${state.clearConfirmOpen ? renderClearConfirmPanel() : ""}
        ${state.deleteAccountOpen ? renderDeleteAccountPanel() : ""}
        ${runtime.celebrationOpen ? renderCelebrationPanel() : ""}
      `
      }
    </main>
  `;
}

function renderSkeletonScreen() {
  return `
    <section class="app-skeleton" role="status" aria-live="polite" aria-label="正在加载应用">
      <span class="sr-only">正在读取登录状态与个人记录…</span>
      <div class="skeleton-brand"><span></span><i></i></div>
      <div class="skeleton-title"><span></span><i></i></div>
      <div class="skeleton-hero"><span></span><i></i><b></b></div>
      <div class="skeleton-row"><span></span><span></span><span></span></div>
      <div class="skeleton-line"><span></span><i></i></div>
    </section>
  `;
}

function numberField({ key, label, value, min, max, step = 1, placeholder = "" }) {
  const error = state.setupFieldErrors?.[key] || "";
  const errorId = `field-error-${key}`;
  const hint = key === "weeklyLoss" ? "可填写 0.1–1.2 kg/周" : "";
  const hintId = `field-hint-${key}`;
  const draftValue =
    state.settingsDraft && Object.prototype.hasOwnProperty.call(state.settingsDraft, key) ? state.settingsDraft[key] : value;
  const hasDraft = state.settingsDraft && Object.prototype.hasOwnProperty.call(state.settingsDraft, key);
  const normalizedValue = hasDraft ? (draftValue ?? "") : Number(draftValue) > 0 ? draftValue : "";
  return `
    <label class="field-label ${escapeHtml(error ? "has-error" : "")}" data-field-name="${escapeHtml(key)}">
      <span>${label}</span>
      <input data-setting-field="${escapeHtml(key)}" data-setting-control name="${escapeHtml(key)}" type="number" inputmode="decimal" autocomplete="off" min="${escapeHtml(min)}" max="${escapeHtml(max)}" step="${escapeHtml(step)}" value="${escapeHtml(normalizedValue)}" placeholder="${escapeHtml(placeholder)}" ${error ? 'aria-invalid="true"' : ""} ${error || hint ? `aria-describedby="${escapeHtml([hint ? hintId : "", error ? errorId : ""].filter(Boolean).join(" "))}"` : ""} />
      ${hint ? `<small class="field-hint" id="${escapeHtml(hintId)}">${escapeHtml(hint)}</small>` : ""}
      ${error ? `<small class="field-error" id="${escapeHtml(errorId)}" role="alert">${escapeHtml(error)}</small>` : ""}
    </label>
  `;
}

function bodyMetricFields() {
  const values = {
    height: state.user.height,
    age: state.user.age,
    weight: state.weight,
    waist: state.waist,
    targetWeight: state.targetWeight,
    targetWaist: state.targetWaist,
    weeklyLoss: state.weeklyLossTarget,
    calories: state.user.dailyCalories,
  };
  return Object.fromEntries(Object.entries(numericSettingFields).map(([key, field]) => [key, { ...field, value: values[key] }]));
}

function metricNumberFields(keys, { withPlaceholder = false } = {}) {
  const fields = bodyMetricFields();
  return keys
    .map((key) => {
      const { placeholder, ...config } = fields[key];
      return numberField({ key, ...config, ...(withPlaceholder && placeholder ? { placeholder } : {}) });
    })
    .join("");
}

function renderEstimateOptions() {
  const draft = { formula: "manual", activityLevel: "light", goalMode: "loss", ...state.user, ...state.settingsDraft };
  return `<div class="settings-grid">${[
    [
      "formula",
      "估算公式",
      [
        ["manual", "手动预算 / 暂不估算"],
        ["male", "男性公式"],
        ["female", "女性公式"],
      ],
    ],
    [
      "activityLevel",
      "日常活动水平",
      [
        ["sedentary", "久坐"],
        ["light", "轻度活动"],
        ["moderate", "中等活动"],
        ["active", "较多活动"],
      ],
    ],
    [
      "goalMode",
      "当前阶段",
      [
        ["loss", "减脂记录"],
        ["maintain", "维持阶段"],
      ],
    ],
  ]
    .map(
      ([key, label, options]) =>
        `<label class="field-label"><span>${escapeHtml(label)}</span><select name="${escapeHtml(key)}" data-setting-control autocomplete="off" ${key === "formula" ? "data-setting-formula" : key === "activityLevel" ? "data-setting-activity" : "data-setting-goal-mode"}>${options.map(([value, text]) => `<option value="${escapeHtml(value)}" ${draft[key] === value ? "selected" : ""}>${escapeHtml(text)}</option>`).join("")}</select></label>`,
    )
    .join(
      "",
    )}</div><p class="settings-note">仅供成年人记录与估算。特殊健康情况请使用专业人员建议的手动预算；选择公式前不会生成自动预算。</p>`;
}

function renderCalorieSetting({ withPlaceholder = false } = {}) {
  const draft = state.settingsDraft;
  const mode = draft?.calorieMode || (state.user.dailyCalories > 0 ? "manual" : "auto");
  const estimate = estimateCalorieBudget({
    height: draft?.height ?? state.user.height,
    age: draft?.age ?? state.user.age,
    weight: draft?.weight ?? state.weight,
    weeklyLoss: draft?.weeklyLoss ?? state.weeklyLossTarget,
    activityKcal: state.setupCompleted ? totalBurned() : 0,
    formula: draft?.formula || state.user.formula || "manual",
    activityLevel: draft?.activityLevel || state.user.activityLevel || "light",
    goalMode: draft?.goalMode || state.user.goalMode,
  });
  const note =
    mode === "manual"
      ? "手动预算；可重新使用估算值"
      : estimate
        ? "估算，可调整"
        : draft?.calories
          ? "基础信息有效后更新估算"
          : "填写身高、年龄、当前体重和每周减重目标后自动估算";
  return `
    <div class="calorie-setting">
      ${metricNumberFields(["calories"], { withPlaceholder })}
      <div class="calorie-setting-help">
        <small data-calorie-estimate-note aria-live="polite">${note}</small>
        <button type="button" data-use-calorie-estimate>使用估算值</button>
      </div>
    </div>
  `;
}

function renderOnboardingScreen() {
  return `
    <section class="lock-screen setup-screen">
      <form class="lock-card setup-card" data-setup-form novalidate>
        ${state.toast ? toastBannerHtml() : ""}
        <div class="brand-lockup compact">
          <span class="brand-monogram">稳</span>
          <span><b>稳减</b><small>私人健康手账</small></span>
        </div>
        <p class="eyebrow">建立你的第一份身体基线</p>
        <h1>从真实数据开始</h1>
        <p>${isNativeApp() ? "资料和记录保存在这部手机，用于预算估算、训练建议与个人趋势。" : "我们不会为新账号填充演示记录。这些信息只用于预算估算、训练建议与个人趋势。"}</p>
        <div class="setup-group">
          <h2>基本资料</h2><p>仅限成年人。手动预算时身高可跳过。</p>
          <div class="settings-grid">${metricNumberFields(["height", "age", "weight"], { withPlaceholder: true })}</div>
        </div>
        <div class="setup-group">
          <h2>减重目标与预算</h2>
          ${renderEstimateOptions()}
          <div class="settings-grid">
            ${metricNumberFields(["targetWeight", "weeklyLoss"], { withPlaceholder: true })}
            ${renderCalorieSetting({ withPlaceholder: true })}
          </div>
        </div>
        <div class="setup-group">
          <h2>腰围 <small>选填</small></h2>
          <p>暂时没量可以跳过，之后随时补充。</p>
          <div class="settings-grid">${metricNumberFields(["waist", "targetWaist"], { withPlaceholder: true })}</div>
        </div>
        <button class="complete-button" type="submit" data-complete-setup>${icon("arrow")}建立我的基线</button>
        <button class="outline-button" type="button" data-import-data>已有备份？从文件恢复</button><input data-import-backup-file type="file" accept="application/json,.json" hidden aria-label="选择稳减备份文件" />
      </form>
      ${renderNativeCloudPanel()}
    </section>
  `;
}

function renderLockScreen() {
  const isSignup = state.authMode === "signup";
  const usingLocal = state.authProvider === "local";
  const emailValue = state.authEmail || "";
  const emailError = state.authFieldErrors?.email || "";
  const passwordError = state.authFieldErrors?.password || "";
  const serviceChecking = state.authServiceStatus === "checking";
  const serviceUnavailable = state.authServiceStatus === "unavailable";
  const signupBlocked = isSignup && state.authServiceStatus === "ready" && !state.authSignupAllowed;
  const authBlocked = state.authLoading || serviceChecking || serviceUnavailable || signupBlocked;
  const submitLabel = state.authLoading
    ? isSignup
      ? "正在创建账号…"
      : "正在登录…"
    : serviceChecking
      ? "检查服务中…"
      : serviceUnavailable
        ? "认证服务不可用"
        : signupBlocked
          ? "当前不可注册"
          : isSignup
            ? "注册并进入"
            : "登录";
  const passwordType = state.authPasswordVisible ? "text" : "password";
  const serviceMessage = escapeHtml(state.authServiceMessage || "正在检查认证服务…");
  const serviceCode = escapeHtml(state.authServiceCode || "AUTH_PROVIDER_UNAVAILABLE");
  const localModeButton = state.localAuthAvailable ? `<button type="button" data-use-local-auth>改用本机账号</button>` : "";
  const serviceNotice =
    usingLocal && !serviceChecking && !serviceUnavailable
      ? `<div class="auth-service-notice is-local" data-auth-service-state="local-ready" role="status"><div><b>本机账号模式</b><p>账号与健康数据只保存在这台电脑，不会上传到 Supabase。</p></div><button type="button" data-use-cloud-auth>返回云端</button></div>`
      : serviceChecking
        ? `<div class="auth-service-notice is-checking" data-auth-service-state="checking" role="status" aria-live="polite"><span class="auth-service-indicator" aria-hidden="true"></span><span>${serviceMessage}</span></div>`
        : serviceUnavailable
          ? `<div class="auth-service-notice is-unavailable" data-auth-service-state="unavailable" role="alert"><div><b>${usingLocal ? "本机账号不可用" : "云端认证未就绪"}</b><p>${serviceMessage}</p><small>${serviceCode}</small></div><div class="auth-service-actions"><button type="button" data-retry-auth-service>重新检查</button>${usingLocal ? `<button type="button" data-use-cloud-auth>返回云端</button>` : localModeButton}</div></div>`
          : !state.authSignupAllowed
            ? `<div class="auth-service-notice is-warning" data-auth-service-state="signup-disabled" role="status"><div><b>新用户注册已关闭</b><p>${serviceMessage}</p></div><div class="auth-service-actions"><button type="button" data-retry-auth-service>重新检查</button>${localModeButton}</div></div>`
            : `<div class="auth-service-notice is-ready" data-auth-service-state="ready" role="status"><span class="auth-service-indicator" aria-hidden="true"></span><span>认证服务已连接</span></div>`;
  return `
    <section class="lock-screen">
      <form class="lock-card" data-auth-form novalidate>
        <div class="brand-lockup">
          <span class="brand-monogram">稳</span>
          <span><b>稳减</b><small>私人健康手账</small></span>
        </div>
        ${renderPrivacyInfo()}
        <div class="auth-intro">
          <p class="eyebrow">${usingLocal ? "本机账号" : isSignup ? "建立你的健康档案" : "继续记录你的进步"}</p>
          <h1>${isSignup ? `创建${usingLocal ? "本机" : ""}账号` : "欢迎回来"}</h1>
          <p>${usingLocal ? "使用邮箱区分这台电脑上的档案；数据不会上传云端。" : isSignup ? "每一条体重、饮食与训练记录都只属于你。" : "登录后继续读取你的真实进度，不展示演示数据。"}</p>
        </div>
        ${serviceNotice}
        ${usingLocal ? "" : `<div class="record-entry-actions"><button class="outline-button" type="button" data-account-mail="recover">忘记密码</button><button class="outline-button" type="button" data-account-mail="resend">重发验证邮件</button></div>`}
        <div class="field-label ${escapeHtml(emailError ? "has-error" : "")}">
          <label for="auth-email">邮箱</label>
          <input id="auth-email" data-auth-email name="email" type="email" inputmode="email" autocomplete="email" autocapitalize="none" spellcheck="false" placeholder="you@example.com" value="${escapeHtml(emailValue)}" ${emailError ? 'aria-invalid="true" aria-describedby="auth-email-error"' : state.authError ? 'aria-describedby="auth-error"' : ""} ${authBlocked ? "disabled" : ""} required />
          ${emailError ? `<small class="field-error" id="auth-email-error" role="alert">${escapeHtml(emailError)}</small>` : ""}
        </div>
        <div class="field-label ${escapeHtml(passwordError ? "has-error" : "")}">
          <label for="auth-password">密码</label>
          <span class="password-control">
            <input id="auth-password" data-auth-password name="password" type="${escapeHtml(passwordType)}" autocomplete="${escapeHtml(isSignup ? "new-password" : "current-password")}" placeholder="至少 6 位…" minlength="6" ${passwordError ? 'aria-invalid="true" aria-describedby="auth-password-error"' : state.authError ? 'aria-describedby="auth-error"' : ""} ${authBlocked ? "disabled" : ""} required />
            <button class="password-toggle" type="button" data-toggle-password aria-label="${escapeHtml(state.authPasswordVisible ? "隐藏密码" : "显示密码")}" ${authBlocked ? "disabled" : ""}>${state.authPasswordVisible ? "隐藏" : "显示"}</button>
          </span>
          ${passwordError ? `<small class="field-error" id="auth-password-error" role="alert">${escapeHtml(passwordError)}</small>` : ""}
        </div>
        ${state.authError ? `<p class="form-error" role="alert" aria-live="assertive" id="auth-error">${escapeHtml(state.authError)}</p>` : ""}
        <button class="complete-button" type="submit" data-auth-submit aria-busy="${escapeHtml(state.authLoading || serviceChecking)}" ${authBlocked ? "disabled" : ""}>
          ${icon("check")}${submitLabel}
        </button>
        <button class="auth-switch-button" type="button" data-auth-mode="${escapeHtml(isSignup ? "login" : "signup")}">
          ${isSignup ? `已有${usingLocal ? "本机" : ""}账号，去登录` : `还没有${usingLocal ? "本机" : ""}账号，创建一个`}
        </button>
      </form>
    </section>
  `;
}

function renderNavItem(item) {
  const active = state.activeTab === item.key;
  return `
    <a class="nav-item ${escapeHtml(active ? "active" : "")}" href="#tab-${escapeHtml(item.key)}" data-tab="${escapeHtml(item.key)}" ${active ? 'aria-current="page"' : ""}>
      ${item.svg}
      <span>${item.label}</span>
    </a>
  `;
}

function renderCurrentPage() {
  const pages = {
    home: renderHome,
    diet: renderDietLab,
    training: renderTrainingLab,
    data: renderDataLab,
    profile: renderProfileLab,
  };
  return pages[state.activeTab]();
}

function renderSettingsPanel() {
  const draft = state.settingsDraft || {};
  const unit = draft.unit ?? state.preferences.unit;
  const aiAssist = draft.aiAssist ?? state.preferences.aiAssist;
  const reminderTime = draft.reminderTime ?? state.preferences.reminderTime ?? "21:30";
  const pushEnabled = draft.pushEnabled ?? state.preferences.pushEnabled;
  const trustedOfflineAccess = draft.trustedOfflineAccess ?? isOfflineAccessTrusted();
  const saveBusy = runtime.pendingActions.has("saveSettings");
  return `
    <section class="settings-scrim" ${saveBusy ? "" : "data-close-settings"}></section>
    <form class="settings-sheet" data-settings-form role="dialog" aria-modal="true" aria-labelledby="settings-title" tabindex="-1" novalidate>
      <div class="settings-appbar">
        <div><h2 id="settings-title">目标与设置</h2></div>
        <button class="mini-icon-button" type="button" data-close-settings aria-label="关闭设置" ${saveBusy ? "disabled" : ""}>${icon("close")}</button>
      </div>
      <div class="settings-group">
        <h3>基础信息</h3>
        <div class="settings-grid">
          ${metricNumberFields(["height", "age", "weight", "targetWeight", "weeklyLoss"])}
        </div>
      </div>
      <div class="settings-group">
        <h3>腰围（选填）</h3>
        <div class="settings-grid">${metricNumberFields(["waist", "targetWaist"])}</div>
      </div>
      <div class="settings-group">
        <h3>目标与偏好</h3>
        ${renderEstimateOptions()}
        <div class="settings-grid">
          ${renderCalorieSetting()}
          <label class="field-label">
            <span>单位</span>
            <select data-setting-unit data-setting-control name="unit" autocomplete="off">
              <option value="metric" ${unit === "metric" ? "selected" : ""}>公制 kg/cm</option>
            </select>
          </label>
          <label class="field-label">
            <span>AI 辅助</span>
            <select data-setting-ai data-setting-control name="aiAssist" autocomplete="off">
              <option value="on" ${aiAssist ? "selected" : ""}>开启</option>
              <option value="off" ${!aiAssist ? "selected" : ""}>关闭</option>
            </select>
          </label>
          ${isNativeApp() ? `<p class="settings-note">AI 识别需要登录云账号并联网。可在“我的”中连接云服务。</p>` : ""}
          <label class="field-label">
            <span>${isNativeApp() ? "每日记录提醒时间" : "应用打开时提醒时间"}</span>
            <input data-setting-reminder data-setting-control name="reminderTime" type="time" autocomplete="off" value="${escapeHtml(reminderTime)}" aria-describedby="settings-reminder-note" />
          </label>
          <label class="toggle-row">
            <span>应用内记录提醒</span>
            <span class="toggle-switch">
              <input data-setting-push data-setting-control name="pushEnabled" type="checkbox" role="switch" aria-describedby="settings-reminder-note" ${pushEnabled ? "checked" : ""} />
              <span class="toggle-track" aria-hidden="true"></span>
            </span>
          </label>
          <p class="settings-note" id="settings-reminder-note">${isNativeApp() ? "开启后由手机系统安排每日通知，送达时间可能受系统省电设置影响。" : "仅在应用保持打开时按所选时间提醒。允许通知后还会显示系统通知；关闭或挂起应用后无法保证提醒。"}</p>
        </div>
      </div>
      ${
        isNativeApp()
          ? ""
          : `<div class="settings-group">
        <h3>隐私与离线</h3>
        <label class="toggle-row">
          <span>信任此设备离线查看</span>
          <span class="toggle-switch">
            <input data-setting-trusted-offline data-setting-control name="trustedOfflineAccess" type="checkbox" role="switch" aria-describedby="trusted-offline-note" ${trustedOfflineAccess ? "checked" : ""} />
            <span class="toggle-track" aria-hidden="true"></span>
          </span>
        </label>
        <p class="settings-note" id="trusted-offline-note">默认关闭。开启后，这台设备断网重开应用时可直接查看和继续记录当前账号的健康数据，不再要求登录。退出登录、删除账号或联网确认身份失效后会自动关闭。能使用此浏览器的人也能查看，请勿在共用设备开启。</p>
      </div>`
      }
      <div class="settings-group">
        <h3>记录保留与导出</h3>
        <div class="settings-grid"><label class="field-label"><span>喝水习惯目标 (ml)</span><input autocomplete="off" name="waterTarget" type="number" min="250" max="5000" step="50" value="${escapeHtml(state.settingsDraft?.waterTarget ?? state.waterTarget)}" /></label><label class="field-label"><span>步数习惯目标</span><input autocomplete="off" name="stepsTarget" type="number" min="0" max="50000" step="100" value="${escapeHtml(state.settingsDraft?.stepsTarget ?? state.stepsTarget)}" /></label><label class="field-label"><span>睡眠习惯目标 (小时)</span><input autocomplete="off" name="sleepTarget" type="number" min="0" max="12" step="0.5" value="${escapeHtml(state.settingsDraft?.sleepTarget ?? state.sleepTarget ?? 7)}" /></label></div>
        <p class="settings-note">${isNativeApp() ? "手机当前保留近期档案，请定期导出备份。" : "日常界面加载近期记录，完整历史按账号、日期独立归档，不自动到期。导出包含本机未同步记录和云端历史。"}旧版本曾经裁掉的数据无法恢复。</p>
        <p class="settings-note">如需长期保存，请定期导出备份。导出包含当前仍保留的数据，无法恢复已移除的旧记录。</p>
        <button class="outline-button" type="button" data-export-data>${icon("download")}导出当前数据备份</button>
        <button class="outline-button" type="button" data-import-data>从文件导入备份</button><input data-import-backup-file type="file" accept="application/json,.json" hidden aria-label="选择稳减备份文件" />
      </div>
      <div class="settings-actions">
        <button class="complete-button" type="submit" data-save-settings aria-busy="${escapeHtml(saveBusy)}" ${saveBusy ? "disabled" : ""}>${saveBusy ? loadingSpinner() : icon("check")}<span>${saveBusy ? "保存中…" : "保存设置"}</span></button>
      </div>
    </form>
  `;
}

function renderClearConfirmPanel() {
  const clearBusy = runtime.pendingActions.has("clearData");
  return `
    <section class="settings-scrim" ${clearBusy ? "" : "data-close-clear-confirm"}></section>
    <section class="confirm-sheet" role="dialog" aria-modal="true" aria-labelledby="clear-confirm-title" aria-describedby="clear-confirm-copy" tabindex="-1">
      <span class="ai-mark danger-mark">${icon("trash")}</span>
      <div>
        <h2 id="clear-confirm-title">清空所有数据？</h2>
        <p id="clear-confirm-copy">${isNativeApp() ? "这会删除这部手机里的全部健康记录。建议先导出备份。" : state.authProvider === "local" ? "这会删除当前本机账号的全部健康记录。" : "这会删除本机记录，并尝试同步清空云端状态。"}操作完成后不能撤销。</p>
      </div>
      <div class="confirm-actions">
        <button class="outline-button" data-close-clear-confirm ${clearBusy ? "disabled" : ""}>取消</button>
        <button class="outline-button danger" data-confirm-clear-data aria-busy="${escapeHtml(clearBusy)}" ${clearBusy ? "disabled" : ""}>${clearBusy ? loadingSpinner() : icon("trash")}<span>${clearBusy ? "清空中…" : "清空数据"}</span></button>
      </div>
    </section>
  `;
}

function renderDeleteAccountPanel() {
  const deleteBusy = runtime.pendingActions.has("deleteAccount");
  return `
    <section class="settings-scrim" ${deleteBusy ? "" : "data-close-delete-account"}></section>
    <section class="confirm-sheet" role="dialog" aria-modal="true" aria-labelledby="delete-account-title" aria-describedby="delete-account-copy" tabindex="-1">
      <span class="ai-mark danger-mark">${icon("trash")}</span>
      <div>
        <h2 id="delete-account-title">永久删除账号？</h2>
        <p id="delete-account-copy">${state.authProvider === "local" ? "这会删除本机账号、全部健康记录和登录会话。" : "这会删除云端账号和全部健康记录。"}删除后无法恢复，也无法再用该邮箱登录。</p>
      </div>
      <div class="confirm-actions">
        <button class="outline-button" data-close-delete-account ${deleteBusy ? "disabled" : ""}>取消</button>
        <button class="outline-button danger" data-confirm-delete-account aria-busy="${escapeHtml(deleteBusy)}" ${deleteBusy ? "disabled" : ""}>${deleteBusy ? loadingSpinner() : icon("trash")}<span>${deleteBusy ? "删除中…" : "永久删除"}</span></button>
      </div>
    </section>
  `;
}

function renderCelebrationPanel() {
  return `
    <section class="celebration-scrim" data-dismiss-celebration></section>
    <section class="celebration-card" data-celebration-dialog role="dialog" aria-modal="true" aria-labelledby="celebration-title" aria-describedby="celebration-copy" tabindex="-1">
      <span class="celebration-mark" aria-hidden="true">${icon("check")}</span>
      <div>
        <p class="eyebrow">今天的三件事</p>
        <h2 id="celebration-title">都完成了，做得很稳</h2>
        <p id="celebration-copy">饮食、训练和喝水都留下了真实记录。今天到这里已经很好，明天继续按自己的节奏来。</p>
      </div>
      <button class="complete-button" type="button" data-dismiss-celebration>${icon("check")}收下这份进步</button>
    </section>
  `;
}

export {
  hasBlockingOverlay,
  appShell,
  shellSignature,
  patchCurrentPage,
  captureSettingsPanelState,
  restoreSettingsPanelState,
  renderCurrentPage,
  renderOnboardingScreen,
  renderLockScreen,
  renderSettingsPanel,
  renderClearConfirmPanel,
  renderDeleteAccountPanel,
  renderCelebrationPanel,
};
