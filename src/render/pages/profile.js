import { renderProductInfo } from "../product-info.js";
import { state, runtime } from "../../app-state.js";
import { isNativeApp, nativeCloudEnabled } from "../../native-runtime.js";
import { renderNativeCloudPanel } from "../native-cloud.js";
import { icon, escapeHtml } from "../../app-utils.js";
import {
  backendStatusText,
  healthGuardrails,
  calorieRecommendation,
  dailyCalorieEstimate,
  bmi,
  fatLossProgress,
  waistProgress,
  targetEta,
} from "../../app-logic.js";
import { pageHeader, statCard, loadingSpinner, renderCalorieExplanation } from "../shared.js";

export function renderProfileLab() {
  const guardrails = healthGuardrails();
  const recommendation = calorieRecommendation();
  const logoutBusy = runtime.pendingActions.has("logout");
  const syncBusy = state.backendStatus === "saving" || state.backendStatus === "connecting";
  return `
    ${pageHeader(
      "我的",
      "目标、估算与数据管理",
      `
      <span class="header-actions">
        ${isNativeApp() ? "" : `<button class="ghost-small" type="button" data-logout aria-busy="${escapeHtml(logoutBusy)}" ${logoutBusy ? "disabled" : ""}>${logoutBusy ? loadingSpinner() : ""}<span>${logoutBusy ? "退出中…" : "退出"}</span></button>`}
        <button class="icon-button" type="button" data-app-action="settings" aria-label="打开设置">${icon("settings")}</button>
      </span>
    `,
    )}

    <section class="profile-identity-lab">
      <div class="profile-stamp"><span>稳</span><small>手账</small></div>
      <div><h2>我的健康档案</h2><p>${state.user.age} 岁 · ${state.user.height}cm · 当前 ${state.weight}kg</p></div>
      <span class="profile-status">记录中</span>
    </section>

    ${renderNativeCloudPanel()}
    <section class="content-section section-overview profile-overview" aria-labelledby="profile-metrics-title">
      <div class="section-title"><h2 id="profile-metrics-title">身体指标</h2></div>
      <div class="profile-metrics-lab">
      ${statCard("BMI 估算", bmi(), "", "budget")}
      ${statCard("基础代谢估算", dailyCalorieEstimate()?.bmr || "暂停估算", "kcal", "intake")}
      ${statCard("饮食预算", state.user.dailyCalories, "kcal", "remain")}
      ${statCard("目标腰围", state.targetWaist > 0 ? state.targetWaist : "待补充", state.targetWaist > 0 ? "cm" : "", "burned")}
      </div>
    </section>

    <section class="goal-lab-card content-section section-list">
      <div class="section-title"><div><h2>当前目标</h2></div><span>每周 -${state.weeklyLossTarget}kg</span></div>
      <div class="goal-measure"><div><span>体重</span><strong>${state.weight}<small>→ ${state.targetWeight}kg</small></strong><div class="inline-progress"><span data-progress="${escapeHtml(fatLossProgress())}"></span></div></div><div><span>腰围</span>${state.waist > 0 && state.targetWaist > 0 && state.startWaist > state.targetWaist ? `<strong>${state.waist}<small>→ ${state.targetWaist}cm</small></strong><div class="inline-progress"><span data-progress="${escapeHtml(waistProgress())}"></span></div>` : "<strong>待补充</strong>"}</div></div>
      <div class="goal-footer"><span>预计达成</span><strong>${targetEta()}</strong>${state.weight > 0 && state.weight <= state.targetWeight && state.user.goalMode !== "maintain" ? `<button class="outline-button" type="button" data-enter-maintenance>进入维持阶段</button>` : ""}<button class="outline-button" type="button" data-app-action="goal">调整目标</button></div>
    </section>

    <section class="guardrail-card health-estimate-card content-section section-list">
      <div class="section-title"><div><h2>健康指标估算</h2></div><span>仅供日常参考</span></div>
      <div class="guardrail-list">${guardrails.map((item) => `<article class="guardrail-item ${escapeHtml(item.tone)}"><div><strong>${escapeHtml(item.label)}</strong><p>${escapeHtml(item.note)}</p></div><span>${escapeHtml(item.value)}<small>${escapeHtml(item.status)}</small></span></article>`).join("")}</div>
      <p class="medical-note">计算依据为你已填写的身体信息和目标速度，不构成医疗诊断或治疗建议。如有慢性病、眩晕或持续不适，请咨询专业医务人员。</p>
    </section>

    <section class="recommend-card budget-estimate-card content-section section-advice">
      <div><h2>${recommendation.label}</h2><p>${recommendation.note}</p></div>
      <div class="recommend-numbers"><article><span>预估全天总消耗</span><strong>${recommendation.tdee || "待完善"}${recommendation.tdee ? "<small>kcal</small>" : ""}</strong></article><article><span>自动建议饮食预算</span><strong>${recommendation.suggested || "待完善"}${recommendation.suggested ? "<small>kcal</small>" : ""}</strong></article></div>
      ${renderCalorieExplanation()}
      <button class="outline-button" type="button" data-apply-calorie ${recommendation.suggested ? "" : "disabled"}>${icon("check")}应用建议预算</button>
    </section>

    <section class="section-block data-tools-card content-section section-form">
      <div class="section-title"><div><h2>数据管理</h2></div><span>${backendStatusText()}</span></div>
      <p class="tool-note">${isNativeApp() ? (nativeCloudEnabled() ? "记录先保存到手机，联网后同步到绑定账号。请定期导出备份。" : "记录保存在这部手机，可在上方开启云同步。") : state.authProvider === "local" ? "记录保存在这台电脑的本机账号中，不会上传云端。" : "记录会先保存在本机，再同步到你的云端账号。"}</p>
      <div class="data-tool-grid"><button class="outline-button" type="button" data-sync-now data-sync-manual aria-busy="${escapeHtml(syncBusy)}" ${syncBusy ? "disabled" : ""}>${syncBusy ? loadingSpinner() : icon("refresh")}<span data-sync-manual-label>${syncBusy ? "保存中…" : isNativeApp() ? "确认保存" : state.authProvider === "local" ? "立即保存" : "重试同步"}</span></button><button class="outline-button" type="button" data-export-data>${icon("download")}导出数据</button><button class="outline-button" type="button" data-import-data>导入备份</button><input data-import-backup-file type="file" accept="application/json,.json" hidden aria-label="选择稳减备份文件" /></div>
      <div class="data-danger-actions" aria-label="删除操作"><button class="outline-button danger" type="button" data-clear-data>${icon("trash")}清空数据</button>${isNativeApp() ? "" : `<button class="outline-button danger" type="button" data-delete-account>${icon("trash")}删除账号</button>`}</div>
      ${state.lastSyncedAt ? `<p class="sync-detail">上次同步：${new Date(state.lastSyncedAt).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</p>` : ""}
      ${state.syncError ? `<p class="form-error" role="alert">${escapeHtml(state.syncError)}</p>` : ""}
    </section>
    ${renderProductInfo()}
  `;
}
