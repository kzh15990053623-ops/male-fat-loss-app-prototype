import { state, runtime } from "../../app-state.js";
import { icon, escapeHtml } from "../../app-utils.js";
import {
  backendStatusText,
  healthGuardrails,
  calorieRecommendation,
  bmi,
  fatLossProgress,
  waistProgress,
  targetEta,
} from "../../app-logic.js";
import { pageHeader, statCard, loadingSpinner } from "../shared.js";

export function renderProfileLab() {
  const guardrails = healthGuardrails();
  const recommendation = calorieRecommendation();
  const logoutBusy = runtime.pendingActions.has("logout");
  const syncBusy = state.backendStatus === "saving" || state.backendStatus === "connecting";
  return `
    ${pageHeader(
      "我的",
      "目标、估算与数据主权",
      `
      <span class="header-actions">
        <button class="ghost-small" type="button" data-logout aria-busy="${escapeHtml(logoutBusy)}" ${logoutBusy ? "disabled" : ""}>${logoutBusy ? loadingSpinner() : ""}<span>${logoutBusy ? "退出中…" : "退出"}</span></button>
        <button class="icon-button" type="button" data-app-action="settings" aria-label="打开设置">${icon("settings")}</button>
      </span>
    `,
    )}

    <section class="profile-identity-lab">
      <div class="profile-stamp"><span>稳</span><small>手账</small></div>
      <div><h2>我的健康档案</h2><p>${state.user.age} 岁 · ${state.user.height}cm · 当前 ${state.weight}kg</p></div>
      <span class="profile-status">记录中</span>
    </section>

    <section class="profile-metrics-lab">
      ${statCard("BMI 估算", bmi(), "", "budget")}
      ${statCard("基础代谢", state.user.bmr, "kcal", "intake")}
      ${statCard("每日预算", state.user.dailyCalories, "kcal", "remain")}
      ${statCard("目标腰围", state.targetWaist, "cm", "burned")}
    </section>

    <section class="goal-lab-card">
      <div class="section-title"><div><h2>当前目标</h2></div><span>每周 -${state.weeklyLossTarget}kg</span></div>
      <div class="goal-measure"><div><span>体重</span><strong>${state.weight}<small>→ ${state.targetWeight}kg</small></strong><div class="inline-progress"><span data-progress="${escapeHtml(fatLossProgress())}"></span></div></div><div><span>腰围</span><strong>${state.waist}<small>→ ${state.targetWaist}cm</small></strong><div class="inline-progress"><span data-progress="${escapeHtml(waistProgress())}"></span></div></div></div>
      <div class="goal-footer"><span>预计达成</span><strong>${targetEta()}</strong><button class="outline-button" type="button" data-app-action="goal">调整目标</button></div>
    </section>

    <section class="guardrail-card health-estimate-card">
      <div class="section-title"><div><h2>健康指标估算</h2></div><span>仅供日常参考</span></div>
      <div class="guardrail-list">${guardrails.map((item) => `<article class="guardrail-item ${escapeHtml(item.tone)}"><div><strong>${escapeHtml(item.label)}</strong><p>${escapeHtml(item.note)}</p></div><span>${escapeHtml(item.value)}<small>${escapeHtml(item.status)}</small></span></article>`).join("")}</div>
      <p class="medical-note">计算依据为你填写的身高、体重、腰围和目标速度，不构成医疗诊断或治疗建议。如有慢性病、眩晕或持续不适，请咨询专业医务人员。</p>
    </section>

    <section class="recommend-card budget-estimate-card">
      <div><h2>${recommendation.label}</h2><p>${recommendation.note}</p></div>
      <div class="recommend-numbers"><article><span>估算维持</span><strong>${recommendation.tdee}<small>kcal</small></strong></article><article><span>建议预算</span><strong>${recommendation.suggested}<small>kcal</small></strong></article></div>
      <button class="outline-button" type="button" data-apply-calorie>${icon("check")}应用建议预算</button>
    </section>

    <section class="section-block data-tools-card">
      <div class="section-title"><div><h2>数据管理</h2></div><span>${backendStatusText()}</span></div>
      <p class="tool-note">${state.authProvider === "local" ? "记录保存在这台电脑的本机账号中，不会上传云端。" : "记录会先保存在本机，再同步到你的云端账号。"}</p>
      <div class="data-tool-grid"><button class="outline-button" type="button" data-sync-now data-sync-manual aria-busy="${escapeHtml(syncBusy)}" ${syncBusy ? "disabled" : ""}>${syncBusy ? loadingSpinner() : icon("refresh")}<span data-sync-manual-label>${syncBusy ? "同步中…" : state.authProvider === "local" ? "立即保存" : "重试同步"}</span></button><button class="outline-button" type="button" data-export-data>${icon("download")}导出数据</button><button class="outline-button danger" type="button" data-clear-data>${icon("trash")}清空数据</button><button class="outline-button danger" type="button" data-delete-account>${icon("trash")}删除账号</button></div>
      ${state.lastSyncedAt ? `<p class="sync-detail">上次同步：${new Date(state.lastSyncedAt).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</p>` : ""}
      ${state.syncError ? `<p class="form-error" role="alert">${escapeHtml(state.syncError)}</p>` : ""}
    </section>
  `;
}
