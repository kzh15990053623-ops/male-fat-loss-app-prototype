import { icon, escapeHtml, avg } from "../../app-utils.js";
import {
  totalIntake,
  totalBurned,
  remainingCalories,
  weightSeries,
  waistSeries,
  calorieBalanceSeries,
  burnedSeries,
  completionSeries,
  trendInsight,
  weeklyActionPlan,
} from "../../app-logic.js";
import { pageHeader, miniMetric, barCard, lineChart } from "../shared.js";

export function renderDataLab() {
  const weights = weightSeries().slice(-7);
  const waists = waistSeries().slice(-7);
  const balances = calorieBalanceSeries(7);
  const burns = burnedSeries(7);
  const completions = completionSeries(7);
  const balanceValues = balances.map((item) => item.value);
  const burnValues = burns.map((item) => item.value);
  const weightValues = weights.map((item) => item.value);
  const waistValues = waists.map((item) => item.value);
  const insight = trendInsight(weightValues, balanceValues, burnValues);
  const actions = weeklyActionPlan(weightValues, balanceValues, burnValues);
  const hasTrend = weights.length >= 2 || balances.length >= 2;
  return `
    ${pageHeader("你的进步", `${Math.max(weights.length, balances.length, burns.length)} 个真实记录日`)}

    <section class="data-command-strip">
      <article><span>今日摄入</span><strong>${totalIntake()}<small>kcal</small></strong></article>
      <article><span>剩余预算</span><strong class="${escapeHtml(remainingCalories() < 0 ? "negative" : "")}">${remainingCalories()}<small>kcal</small></strong></article>
      <article><span>运动消耗</span><strong>${totalBurned()}<small>kcal</small></strong></article>
    </section>

    ${
      !hasTrend
        ? `
      <section class="data-empty-lab">
        <span class="empty-plot" aria-hidden="true">${icon("chart")}</span>
        <h2>真实趋势正在建立</h2>
        <p>至少需要 2 个记录日。继续记录体重和饮食后，这里会自动生成趋势，不会填充演示数据。</p>
        <div class="baseline-progress"><span data-baseline="${escapeHtml(Math.min(2, Math.max(weights.length, balances.length)))}"></span></div>
        <button class="complete-button" type="button" data-week-action="home">${icon("plus")}完成今天的记录</button>
      </section>
    `
        : `
      <section class="trend-coach-card lab-insight">
        <div class="section-title"><div><h2>${insight.title}</h2></div><span>基于真实记录</span></div>
        <div class="trend-metric-row">
          ${miniMetric("体重变化", insight.weightDelta, "kg")}
          ${miniMetric("平均预算差", insight.avgBalance, "kcal")}
          ${miniMetric("完成率", insight.completion, "%")}
        </div>
        <div class="insight-list">${insight.items.map((item) => `<p>${escapeHtml(item)}</p>`).join("")}</div>
      </section>

      ${
        weights.length >= 2
          ? `
        <figure class="chart-card wide lab-chart">
          <figcaption class="section-title"><div><p class="eyebrow">近 7 次记录</p><h2>体重趋势</h2></div><span>${(weightValues.at(-1) - weightValues[0]).toFixed(1)} kg</span></figcaption>
          ${lineChart(weights, `近 ${weights.length} 次体重记录，变化 ${(weightValues.at(-1) - weightValues[0]).toFixed(1)} 千克`, "weightTrendFill", "kg")}
        </figure>
      `
          : ""
      }

      ${
        waists.length >= 2
          ? `
        <figure class="chart-card wide lab-chart">
          <figcaption class="section-title"><div><p class="eyebrow">近 7 次记录</p><h2>腰围趋势</h2></div><span>${(waistValues.at(-1) - waistValues[0]).toFixed(1)} cm</span></figcaption>
          ${lineChart(waists, `近 ${waists.length} 次腰围记录，变化 ${(waistValues.at(-1) - waistValues[0]).toFixed(1)} 厘米`, "waistTrendFill", "cm")}
        </figure>
      `
          : ""
      }

      <section class="weekly-action-card">
        <div class="section-title"><div><h2>下一步调整</h2></div><span>${actions.length} 项</span></div>
        <div class="weekly-action-list">${actions.map((action) => `<article class="weekly-action-item"><div><strong>${escapeHtml(action.title)}</strong><span>${escapeHtml(action.meta)}</span><p>${escapeHtml(action.detail)}</p></div><button class="mini-icon-button" type="button" data-week-action="${escapeHtml(action.target)}" aria-label="执行${escapeHtml(action.title)}">${icon("arrow")}</button></article>`).join("")}</div>
      </section>

      ${balanceValues.length ? `<div class="two-chart-grid">${barCard("预算差额", balanceValues, "kcal")}${barCard("运动消耗", burnValues, "kcal")}</div>` : ""}
      ${completions.length ? `<section class="section-block"><div class="section-title"><h2>记录完成率</h2><span>${Math.round(avg(completions.map((item) => item.value)))}%</span></div><div class="completion-row" role="img" aria-label="近 ${escapeHtml(completions.length)} 日平均完成率 ${escapeHtml(Math.round(avg(completions.map((item) => item.value))))}%">${completions.map((item) => `<span data-height="${escapeHtml(item.value)}"><i>${escapeHtml(item.date.slice(5))}</i></span>`).join("")}</div></section>` : ""}
    `
    }
  `;
}
