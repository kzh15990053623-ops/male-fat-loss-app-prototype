import { state, runtime } from "../../app-state.js";
import { icon, escapeHtml } from "../../app-utils.js";
import {
  totalIntake,
  totalBurned,
  remainingCalories,
  weightSeries,
  weeklyCompletionSummary,
  todayTasks,
  computeStreak,
  coachPlan,
  reviewSummary,
} from "../../app-logic.js";
import { pageHeader, lineChart } from "../shared.js";

export function renderHome() {
  const weeklyProgress = weeklyCompletionSummary();
  const streak = computeStreak(state.dailyRecords);
  const remaining = remainingCalories();
  const allTasks = todayTasks();
  const focusTasks = ["饮食记录", "训练", "喝水"].map((label) => allTasks.find((task) => task.label === label)).filter(Boolean);
  return `
    ${pageHeader("今天", renderStreakSubtitle(streak), `<button class="icon-button" data-app-action="goal" aria-label="目标与设置">${icon("settings")}</button>`)}

    <section class="hero-panel lab-hero">
      <div class="hero-measure">
        <div>
          <span class="metric-label">当前体重</span>
          <strong><span data-count-up data-count-key="home-weight" data-count-value="${escapeHtml(state.weight)}" data-count-decimals="1">${state.weight}</span><small>kg</small></strong>
        </div>
        <div class="hero-waist">
          <span class="metric-label">腰围</span>
          <strong>${state.waist}<small>cm</small></strong>
        </div>
      </div>
      <div class="weekly-progress" data-progress="${escapeHtml(weeklyProgress.percent ?? 0)}" aria-label="${escapeHtml(weeklyProgress.percent === null ? "本周还没有行动记录" : `本周行动完成度 ${weeklyProgress.percent}%`)}">
        <span>本周行动</span>
        <strong>${weeklyProgress.percent === null ? "从第一笔开始" : `<span data-count-up data-count-key="weekly-progress" data-count-value="${escapeHtml(weeklyProgress.percent)}" data-count-decimals="0">${weeklyProgress.percent}</span>%`}</strong>
        <span class="weekly-progress-track" aria-hidden="true"><i></i></span>
      </div>
      <div class="home-budget-strip" aria-label="今日热量概览">
        <div><span>剩余可摄入</span><strong class="${escapeHtml(remaining < 0 ? "negative" : "")}">${remaining}<small>kcal</small></strong></div>
        <div><span>今日摄入</span><strong>${totalIntake()}<small>kcal</small></strong></div>
        <div><span>运动消耗</span><strong>${totalBurned()}<small>kcal</small></strong></div>
      </div>
    </section>

    <section class="quick-capture-panel focus-board" aria-label="快速记录">
      <div class="section-title">
        <div><h2>现在记录</h2></div>
        <span>今日三件事 · ${focusTasks.filter((task) => task.done).length} / ${focusTasks.length}</span>
      </div>
      <div class="focus-list">${focusTasks.map(renderFocusTask).join("")}</div>
      <form class="quick-weight-card" id="body-record-form" data-body-form>
        <label class="field-label">
          <span>体重 (kg)</span>
          <input data-weight-input name="weight" type="number" inputmode="decimal" autocomplete="off" min="40" max="200" step="0.1" value="${escapeHtml(state.weightDraft || state.weight)}" />
        </label>
        <label class="field-label">
          <span>腰围 (cm)</span>
          <input data-waist-input name="waist" type="number" inputmode="decimal" autocomplete="off" min="50" max="180" step="0.1" value="${escapeHtml(state.waistDraft || state.waist)}" />
        </label>
        <button class="primary-small" type="submit" data-save-body>${icon("check")}保存</button>
      </form>
    </section>

    ${renderHabitControls()}
    ${renderHomeWeightTrend()}
    ${renderSmartCoach()}
  `;
}

function renderStreakSubtitle(streak) {
  if (!streak) return "从今天建立真实基线";
  const hasProgressToday = todayTasks().some((task) => task.done);
  return `
    <span class="streak-badge">${icon("flame")}连续记录 <strong>${streak}</strong> 天</span>
    ${hasProgressToday ? "" : '<span class="streak-nudge">今天记下一笔，稳稳接上</span>'}
  `;
}

function renderFocusTask(task) {
  const action = task.label === "饮食记录" ? "diet" : task.label === "训练" ? "training" : "water";
  const justCompleted = runtime.completionFeedback?.tasks?.includes(task.label);
  return `
    <button class="focus-item ${escapeHtml(task.done ? "done" : "")} ${escapeHtml(justCompleted ? "just-completed" : "")}" type="button" ${action === "water" ? 'data-habit-step="water" data-step-direction="1"' : `data-coach-action="${escapeHtml(action)}"`}>
      <span class="focus-symbol" aria-hidden="true">${icon(action === "diet" ? "fork" : action === "training" ? "dumbbell" : "water")}</span>
      <span class="focus-copy"><strong>${escapeHtml(task.label)}</strong><small>${escapeHtml(task.value)}</small></span>
      <span class="focus-status" aria-label="${escapeHtml(task.done ? "已完成" : "待完成")}">${task.done ? icon("check") : icon("arrow")}</span>
    </button>
  `;
}

function renderHomeWeightTrend() {
  const weights = weightSeries().slice(-7);
  if (weights.length < 2) {
    return `
      <section class="home-trend-card trend-empty compact-empty">
        <div>
          <h2>体重趋势待生成</h2>
          <p>再记录 ${2 - weights.length} 次体重，就能看到真实变化。</p>
        </div>
        <span class="empty-signal" aria-hidden="true">${icon("chart")}</span>
        <button class="outline-button" type="button" data-scroll-body-form>${icon("plus")}记录体重</button>
      </section>
    `;
  }
  const delta = Number((weights.at(-1).value - weights[0].value).toFixed(1));
  const deltaText = delta > 0 ? `+${delta}` : `${delta}`;
  return `
    <section class="home-trend-card">
      <div>
        <div class="section-title">
          <h2>体重趋势</h2>
          <span>近 7 天</span>
        </div>
        <strong>${state.weight}<small>kg</small></strong>
        <p>较上周 <span>${deltaText} kg</span></p>
      </div>
      ${lineChart(weights, "首页近 7 次体重趋势折线图", "homeWeightTrendFill", "kg")}
    </section>
  `;
}

function renderSmartCoach() {
  const plan = coachPlan();
  const review = reviewSummary();
  return `
    <section class="coach-card">
      <div class="section-title"><h2>教练洞察</h2></div>
      <div class="coach-plan-list">
        ${plan.actions
          .slice(0, 1)
          .map((item) => `<p>${item}</p>`)
          .join("")}
      </div>
      <details class="coach-details">
        <summary>每日复盘 <span>${review.score} 分${icon("arrow")}</span></summary>
        <h3>${review.title}</h3>
        <p>${review.good.concat(review.todo).slice(0, 3).join(" · ")}</p>
        ${plan.actions
          .slice(1)
          .map((item) => `<p>${item}</p>`)
          .join("")}
        <div class="coach-risk">${plan.risks.map((item) => `<p>${item}</p>`).join("")}</div>
      </details>
    </section>
  `;
}

function renderHabitControls() {
  const waterPercent = Math.min(100, Math.round((state.waterMl / state.waterTarget) * 100));
  const stepsPercent = Math.min(100, Math.round((state.steps / state.stepsTarget) * 100));
  const sleepPercent = Math.min(100, Math.round((state.sleep / 7.5) * 100));
  return `
    <section class="habit-control-card">
      <div class="section-title">
        <h2>快捷补记</h2>
        <span>${waterPercent}% 饮水</span>
      </div>
      ${habitControl("water", "饮水", `${state.waterMl} / ${state.waterTarget}ml`, waterPercent, "water", "+200ml")}
      ${habitControl("steps", "步数", `${state.steps} / ${state.stepsTarget}步`, stepsPercent, "steps", "+1000")}
      ${habitControl("sleep", "睡眠", `${state.sleep} / 7.5h`, sleepPercent, "moon", "+0.5h")}
    </section>
  `;
}

function habitControl(key, label, value, percent, iconName, addLabel) {
  return `
    <article class="habit-control">
      <span class="habit-symbol">${icon(iconName)}</span>
      <div>
        <div class="habit-meta">
          <strong>${label}</strong>
          <small>${value}</small>
        </div>
        <div class="mini-progress"><span data-progress="${escapeHtml(percent)}"></span></div>
      </div>
      <div class="habit-actions">
        <button class="mini-icon-button" data-habit-step="${escapeHtml(key)}" data-step-direction="-1" aria-label="减少${escapeHtml(label)}">${icon("minus")}</button>
        <button class="habit-add-button" data-habit-step="${escapeHtml(key)}" data-step-direction="1">${addLabel}</button>
      </div>
    </article>
  `;
}
