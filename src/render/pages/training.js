import { state, workouts, activityTypes, runtime } from "../../app-state.js";
import { icon, escapeHtml } from "../../app-utils.js";
import { estimateCalories, todayPlanWorkout, weeklyTrainingPlan, customBurned } from "../../app-logic.js";
import { pageHeader, renderActivity, renderEmptyState, renderWorkout } from "../shared.js";

export function renderTrainingLab() {
  const draftKcal = estimateCalories(state.activityDraft.type, state.activityDraft.minutes);
  const todayPlan = todayPlanWorkout();
  const plan = weeklyTrainingPlan();
  const todayIndex = plan.findIndex((item) => item.today);
  const workoutJustCompleted = runtime.completionFeedback?.tasks?.includes("训练");
  return `
    ${pageHeader("动起来", "本周节奏与今日执行")}

    <section class="training-hero-lab">
      <div class="training-orbit" aria-hidden="true"><span>${String(todayIndex + 1).padStart(2, "0")}</span><small>/ 07</small></div>
      <div class="training-copy">
        <p class="eyebrow">今天的安排</p>
        <h2>${escapeHtml(todayPlan.focus)}</h2>
        <p>${escapeHtml(todayPlan.type)} · 为当前目标生成的今日训练建议</p>
        <div class="workout-meta">
          <span>${icon("timer")}${todayPlan.minutes} 分钟</span>
          <span>${icon("flame")}约 ${todayPlan.kcal} kcal</span>
          <span>${icon("level")}${state.weeklyLossTarget >= 0.7 ? "偏高" : "适中"}</span>
        </div>
      </div>
      <div class="training-hero-actions">
        <button class="outline-button" type="button" data-apply-today-plan>${icon("plus")}套用计划</button>
        <button class="complete-button ${escapeHtml(workoutJustCompleted ? "just-completed" : "")}" type="button" data-complete-workout aria-pressed="${escapeHtml(state.workoutDone)}" ${state.workoutDone ? "disabled" : ""}>${icon("check")}${state.workoutDone ? "今日已完成" : "完成打卡"}</button>
      </div>
    </section>

    ${renderWeekTrainingPlan()}

    <details class="activity-capture" open>
      <summary><div><h2>快速记录运动</h2></div><span>预估 <b data-activity-estimate>${draftKcal}</b> kcal</span></summary>
      <div class="activity-form-card">
        <label class="field-label"><span>运动名称</span><input data-activity-name name="activity-name" type="text" maxlength="40" autocomplete="off" placeholder="例如：快走、游泳、篮球…" value="${escapeHtml(state.activityDraft.name)}" /></label>
        <div class="form-grid">
          <label class="field-label"><span>类型</span><select data-activity-type name="activity-type" autocomplete="off">${Object.entries(
            activityTypes,
          )
            .map(
              ([type, info]) =>
                `<option value="${escapeHtml(type)}" ${state.activityDraft.type === type ? "selected" : ""}>${type} · ${info.hint}</option>`,
            )
            .join("")}</select></label>
          <label class="field-label"><span>时间 (分钟)</span><input data-activity-minutes name="activity-minutes" type="number" inputmode="numeric" autocomplete="off" min="5" max="180" step="5" value="${escapeHtml(state.activityDraft.minutes)}" /></label>
        </div>
        <button class="complete-button" type="button" data-add-activity>${icon("plus")}加入今日消耗</button>
      </div>
    </details>

    <section class="section-block activity-log-card">
      <div class="section-title"><div><h2>今日运动记录</h2></div><span>${customBurned()} kcal</span></div>
      ${state.undoActivity ? `<div class="undo-banner" role="status"><span>已删除 ${escapeHtml(state.undoActivity.name)}</span><button type="button" data-undo-activity>撤销</button></div>` : ""}
      <div class="activity-list">${state.customActivities.length ? state.customActivities.map(renderActivity).join("") : renderEmptyState()}</div>
    </section>

    <section class="section-block training-library">
      <div class="section-title"><div><h2>训练类型</h2></div><span>${workouts.length} 项</span></div>
      <div class="workout-list">${workouts.map(renderWorkout).join("")}</div>
    </section>
  `;
}

function renderWeekTrainingPlan() {
  const plan = weeklyTrainingPlan();
  const totalMinutes = plan.reduce((sum, item) => sum + item.minutes, 0);
  return `
    <section class="week-plan-card">
      <div class="section-title">
        <h2>本周训练安排</h2>
        <span>${totalMinutes} 分钟</span>
      </div>
      <div class="week-plan-list">
        ${plan
          .map(
            (item) => `
          <article class="week-plan-item ${escapeHtml(item.today ? "today" : "")}">
            <span>周${item.day}</span>
            <div>
              <strong>${item.type}</strong>
              <p>${item.focus} · ${item.minutes} 分钟 · ${item.kcal} kcal</p>
            </div>
          </article>
        `,
          )
          .join("")}
      </div>
    </section>
  `;
}
