import { icon, escapeHtml, avg } from "../../app-utils.js";
import {
  weightSeries,
  waistSeries,
  calorieBalanceSeries,
  burnedSeries,
  completionSeries,
  trendInsight,
  weeklyActionPlan,
} from "../../app-logic.js";
import { pageHeader, miniMetric, barCard, lineChart, chartDataDetails, renderEnergyBudget } from "../shared.js";
import { renderHistory } from "../records.js";

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

    <section class="data-energy-overview content-section section-overview" aria-label="今日热量概览">
      <div class="section-title"><h2>今日热量</h2></div>
      ${renderEnergyBudget()}
    </section>

    ${
      !hasTrend
        ? `
      <section class="data-empty-lab content-section section-chart">
        <span class="empty-plot" aria-hidden="true">${icon("chart")}</span>
        <h2>真实趋势正在建立</h2>
        <p>至少需要 2 个记录日。继续记录体重和饮食后，这里会自动生成趋势，不会填充演示数据。</p>
        <div class="baseline-progress"><span data-baseline="${escapeHtml(Math.min(2, Math.max(weights.length, balances.length)))}"></span></div>
        <button class="complete-button" type="button" data-week-action="home">${icon("plus")}完成今天的记录</button>
      </section>
    `
        : `
      <section class="trend-coach-card lab-insight content-section section-advice">
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
        <figure class="chart-card wide lab-chart content-section section-chart">
          <figcaption class="section-title"><div><p class="eyebrow">近 7 次记录</p><h2>体重趋势</h2></div><span>${(weightValues.at(-1) - weightValues[0]).toFixed(1)} kg</span></figcaption>
          ${lineChart(weights, `近 ${weights.length} 次体重记录，变化 ${(weightValues.at(-1) - weightValues[0]).toFixed(1)} 千克`, "weightTrendFill", "kg")}
        </figure>
      `
          : ""
      }

      ${
        waists.length >= 2
          ? `
        <figure class="chart-card wide lab-chart content-section section-chart">
          <figcaption class="section-title"><div><p class="eyebrow">近 7 次记录</p><h2>腰围趋势</h2></div><span>${(waistValues.at(-1) - waistValues[0]).toFixed(1)} cm</span></figcaption>
          ${lineChart(waists, `近 ${waists.length} 次腰围记录，变化 ${(waistValues.at(-1) - waistValues[0]).toFixed(1)} 厘米`, "waistTrendFill", "cm")}
        </figure>
      `
          : ""
      }

      <section class="weekly-action-card content-section section-list">
        <div class="section-title"><div><h2>下一步调整</h2></div><span>${actions.length} 项</span></div>
        <div class="weekly-action-list">${actions.map((action) => `<article class="weekly-action-item"><div><strong>${escapeHtml(action.title)}</strong><span>${escapeHtml(action.meta)}</span><p>${escapeHtml(action.detail)}</p></div><button class="mini-icon-button" type="button" data-week-action="${escapeHtml(action.target)}" aria-label="执行${escapeHtml(action.title)}">${icon("arrow")}</button></article>`).join("")}</div>
      </section>

      ${balanceValues.length ? `<div class="two-chart-grid">${barCard("预算差额", balances, "kcal")}${barCard("运动消耗", burns, "kcal")}</div>` : ""}
      ${completions.length ? `<section class="section-block content-section section-chart"><div class="section-title"><h2>记录完成率</h2><span>${Math.round(avg(completions.map((item) => item.value)))}%</span></div><div class="completion-row" aria-hidden="true">${completions.map((item) => `<span data-height="${escapeHtml(item.value)}"><i>${escapeHtml(item.date.slice(5))}</i></span>`).join("")}</div>${chartDataDetails("记录完成率", completions, "%")}</section>` : ""}
    `
    }
    ${renderHistory()}
  `;
}
