import { state } from "../app-state.js";
import { icon, escapeHtml, avg, dateLabel } from "../app-utils.js";
import { backendStatusText } from "../app-logic.js";

export function loadingSpinner() {
  return `<span class="button-spinner" aria-hidden="true"></span>`;
}

export function renderSyncStatus() {
  const retryable = state.backendStatus === "local" || state.backendStatus === "offline";
  const busy = state.backendStatus === "saving" || state.backendStatus === "connecting";
  return `
    <div class="sync-control" data-backend-status data-status="${escapeHtml(state.backendStatus)}" data-error-kind="${escapeHtml(state.syncErrorKind || "none")}" aria-busy="${escapeHtml(busy)}">
      <span class="sync-indicator" role="status" aria-live="polite" aria-atomic="true">
        <i aria-hidden="true"></i><span data-backend-status-text>${backendStatusText()}</span>
      </span>
      <button class="sync-retry-button" type="button" data-sync-now data-sync-retry aria-label="重试同步" aria-busy="${escapeHtml(busy)}" ${retryable ? "" : "hidden disabled"}>重试</button>
    </div>
  `;
}

export function pageHeader(title, subtitle, action = "") {
  return `
    <header class="page-header">
      <div>
        <p class="eyebrow">${subtitle}</p>
        <h1>${title}</h1>
      </div>
      <div class="page-header-side">
        ${renderSyncStatus()}
        ${action}
      </div>
    </header>
  `;
}

export function statCard(label, value, unit, tone) {
  return `
    <article class="stat-card ${escapeHtml(tone)}">
      <span>${label}</span>
      <strong>${value}<small>${unit}</small></strong>
    </article>
  `;
}

export function miniMetric(label, value, unit) {
  return `
    <article>
      <span>${label}</span>
      <strong>${value}<small>${unit}</small></strong>
    </article>
  `;
}

export function renderMeal(meal) {
  const empty = meal.calories === 0;
  const mealId = meal.id;
  const mealName = meal.name;
  const mealStatus = escapeHtml(meal.status);
  const foods = Array.isArray(meal.foods) ? meal.foods.map(escapeHtml).join(" · ") : "";
  return `
    <article class="meal-card ${escapeHtml(empty ? "empty" : "")}">
      <div class="meal-head">
        <div>
          <h3>${escapeHtml(mealName)}</h3>
          <span>${mealStatus}</span>
        </div>
        <strong>${empty ? "--" : meal.calories}<small>kcal</small></strong>
      </div>
      ${
        empty
          ? `<button class="outline-button" data-record-meal="${escapeHtml(mealId)}">${icon("plus")}记录${escapeHtml(mealName)}</button>`
          : `
        <p>${foods}</p>
        <div class="macro-tags">
          <span>P ${meal.macros.protein}g</span>
          <span>C ${meal.macros.carbs}g</span>
          <span>F ${meal.macros.fat}g</span>
        </div>
        <button class="meal-repeat-button" type="button" data-repeat-meal="${escapeHtml(mealId)}">${icon("refresh")}再记一次</button>
      `
      }
    </article>
  `;
}

export function renderMealTemplate(template) {
  const id = template.id;
  const name = template.name;
  return `
    <article class="template-chip">
      <div>
        <strong>${escapeHtml(name)}</strong>
        <span>${template.calories} kcal · P${template.protein} C${template.carbs} F${template.fat}</span>
      </div>
      <button class="mini-icon-button" data-use-template="${escapeHtml(id)}" aria-label="使用${escapeHtml(name)}">${icon("plus")}</button>
    </article>
  `;
}

export function renderNutritionResult(result) {
  const context = result.context || null;
  const confidence = Number.isFinite(Number(result.confidence)) ? Math.round(Number(result.confidence) * 100) : null;
  const contextLabel = context
    ? `按 ${escapeHtml(context.amount || "--")}${escapeHtml(context.unit)} · ${escapeHtml(context.cooking)} · 用油 ${escapeHtml(context.oilGrams)}g · 酱料${escapeHtml(context.sauce)} 修正`
    : "已根据食物内容生成估算，可继续手动微调。";
  return `
    <div class="nutrition-result ${escapeHtml(result.needsReview ? "needs-review" : "")}" role="status" aria-live="polite">
      <div class="nutrition-result-head">
        <div>
          <span>${result.needsReview ? "需要复核" : "AI 模型估算"}</span>
          <strong>${escapeHtml(result.calories)}<small>kcal</small></strong>
        </div>
        <span class="model-badge">${escapeHtml(result.model || "AI MODEL")}${confidence === null ? "" : ` · ${confidence}%`}</span>
      </div>
      <div class="nutrition-macro-row"><span>P ${escapeHtml(result.protein)}g</span><span>C ${escapeHtml(result.carbs)}g</span><span>F ${escapeHtml(result.fat)}g</span></div>
      ${
        Array.isArray(result.details) && result.details.length
          ? `
        <div class="nutrition-detail-list">
          ${result.details
            .map(
              (item) => `
            <span><b>${escapeHtml(item.name)}</b>${escapeHtml(item.grams)}g · ${escapeHtml(item.calories)}kcal · P${escapeHtml(item.protein)}/C${escapeHtml(item.carbs)}/F${escapeHtml(item.fat)}${Number.isFinite(Number(item.confidence)) ? ` · 置信度 ${Math.round(Number(item.confidence) * 100)}%` : ""}</span>
          `,
            )
            .join("")}
        </div>
      `
          : ""
      }
      ${Array.isArray(result.assumptions) && result.assumptions.length ? `<div class="ai-assumption-list"><strong>模型假设</strong>${result.assumptions.map((item) => `<p>${escapeHtml(item)}</p>`).join("")}</div>` : ""}
      ${Array.isArray(result.warnings) && result.warnings.length ? `<div class="ai-warning-list">${result.warnings.map((item) => `<p>${escapeHtml(item)}</p>`).join("")}</div>` : ""}
      <small>${contextLabel}</small>
      <small>${escapeHtml(result.note || "请核对实际份量后再保存。")}</small>
    </div>
  `;
}

export function renderActivity(item) {
  const id = item.id;
  const name = item.name;
  const type = escapeHtml(item.type);
  const createdAt = escapeHtml(item.createdAt);
  return `
    <article class="activity-item">
      <span class="activity-icon">${icon("flame")}</span>
      <div>
        <h3>${escapeHtml(name)}</h3>
        <p>${type} · ${escapeHtml(item.minutes)} 分钟 · ${createdAt}</p>
      </div>
      <strong>${item.kcal}<small>kcal</small></strong>
      <button class="mini-icon-button" data-delete-activity="${escapeHtml(id)}" aria-label="删除${escapeHtml(name)}">${icon("trash")}</button>
    </article>
  `;
}

export function renderEmptyState() {
  return `
    <div class="empty-state">
      ${icon("dumbbell")}
      <div>
        <strong>今天还没有运动记录</strong>
        <p>从一段轻松的活动开始，完成后会自动汇总消耗。</p>
      </div>
      <button class="complete-button" type="button" data-coach-action="training">${icon("plus")}记录一次运动</button>
    </div>
  `;
}

export function renderWorkout(workout) {
  const selected = state.activityDraft.type === workout.type;
  return `
    <article class="workout-item ${escapeHtml(selected ? "selected" : "")}">
      <div>
        <span>${workout.type}</span>
        <h3>${workout.name}</h3>
        <p>${workout.minutes} 分钟 · ${workout.level} · 预计 ${workout.kcal} kcal</p>
      </div>
      <button class="${escapeHtml(selected ? "check-button checked" : "icon-button")}" data-select-workout="${escapeHtml(workout.type)}" aria-label="选择${escapeHtml(workout.type)}">
        ${selected ? icon("check") : icon("arrow")}
      </button>
    </article>
  `;
}

function normalizeChartSeries(series) {
  return series
    .map((item, index) => {
      const entry = typeof item === "number" ? { date: `记录 ${index + 1}`, value: item } : item;
      if (!entry || !Number.isFinite(entry.value)) return null;
      const date = String(entry.date || entry.label || `记录 ${index + 1}`);
      return { date, readableDate: dateLabel(date), value: Number(entry.value) };
    })
    .filter(Boolean);
}

export function chartDataDetails(title, series, unit) {
  const safeSeries = normalizeChartSeries(series);
  if (!safeSeries.length) return "";
  return `
    <details class="chart-data-details">
      <summary aria-label="${escapeHtml(`${title}：查看每日数据`)}">查看每日数据</summary>
      <dl aria-label="${escapeHtml(`${title}逐日数据`)}">
        ${safeSeries
          .map(
            (item) => `
              <div>
                <dt>${escapeHtml(item.readableDate)}</dt>
                <dd>${escapeHtml(item.value)}${unit ? ` ${escapeHtml(unit)}` : ""}</dd>
              </div>
            `,
          )
          .join("")}
      </dl>
    </details>
  `;
}

export function barCard(title, series, unit) {
  const safeSeries = normalizeChartSeries(series);
  const safeValues = safeSeries.map((item) => item.value);
  const maxValue = Math.max(1, ...safeValues.map((value) => Math.abs(value)));
  return `
    <section class="chart-card">
      <div class="section-title">
        <h2>${title}</h2>
        <span>${safeValues.length ? Math.round(avg(safeValues)) : "--"} ${unit}</span>
      </div>
      <div class="mini-bars" aria-hidden="true">
        ${safeSeries.map((item) => `<span class="${escapeHtml(item.value < 0 ? "negative" : "")}" data-height="${escapeHtml(Math.max(10, (Math.abs(item.value) / maxValue) * 100))}" title="${escapeHtml(`${item.readableDate}，${item.value} ${unit}`)}"></span>`).join("")}
      </div>
      ${chartDataDetails(title, safeSeries, unit)}
    </section>
  `;
}

export function lineChart(series, ariaLabel = "趋势折线图", chartId = "chartFill", unit = "") {
  const width = 300;
  const height = 150;
  const padding = 23;
  const safeSeries = series
    .map((item, index) => (typeof item === "number" ? { date: `记录 ${index + 1}`, value: item } : item))
    .filter((item) => item && Number.isFinite(Number(item.value)))
    .map((item) => ({ date: String(item.date || item.label || "记录"), value: Number(item.value) }));
  if (!safeSeries.length) {
    return `
      <div class="line-chart-wrap">
        <svg class="line-chart" viewBox="0 0 ${escapeHtml(width)} ${escapeHtml(height)}" role="img" aria-label="${escapeHtml(ariaLabel)}">
          <text x="${escapeHtml(width / 2)}" y="${escapeHtml(height / 2)}" text-anchor="middle" dominant-baseline="middle" fill="#5f6b70" font-size="14">暂无趋势</text>
        </svg>
      </div>
    `;
  }
  const values = safeSeries.map((item) => item.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pointList = safeSeries.map((item, index) => {
    const x = safeSeries.length === 1 ? width / 2 : padding + (index / (safeSeries.length - 1)) * (width - padding * 2);
    const y = height - padding - ((item.value - min) / (max - min || 1)) * (height - padding * 2);
    const parsed = new Date(`${item.date}T00:00:00`);
    const readableDate = Number.isNaN(parsed.getTime()) ? item.date : parsed.toLocaleDateString("zh-CN", { month: "long", day: "numeric" });
    return { ...item, x, y, readableDate };
  });
  const points = pointList.map((point) => `${point.x},${point.y}`).join(" ");
  const fillPoints = pointList.length > 1 ? `${padding},${height - padding} ${points} ${width - padding},${height - padding}` : "";
  const liveId = `${chartId}-selection`;
  return `
    <div class="line-chart-wrap" data-line-chart>
      <svg class="line-chart" viewBox="0 0 ${escapeHtml(width)} ${escapeHtml(height)}" role="img" aria-label="${escapeHtml(ariaLabel)}">
        <defs>
          <linearGradient id="${escapeHtml(chartId)}" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stop-color="#16A77D" stop-opacity="0.22" />
            <stop offset="100%" stop-color="#16A77D" stop-opacity="0" />
          </linearGradient>
        </defs>
        ${fillPoints ? `<polyline class="chart-area" points="${escapeHtml(fillPoints)}" fill="url(#${escapeHtml(chartId)})" stroke="none"></polyline>` : ""}
        ${pointList.length > 1 ? `<polyline class="chart-line" pathLength="1" points="${escapeHtml(points)}" fill="none" stroke="#16A77D" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"></polyline>` : ""}
        ${pointList.map(({ x, y, value, readableDate }) => `<circle cx="${escapeHtml(x)}" cy="${escapeHtml(y)}" r="4.5" fill="#ffffff" stroke="#16A77D" stroke-width="3"><title>${escapeHtml(`${readableDate}，${value}${unit}`)}</title></circle>`).join("")}
      </svg>
      <div class="chart-point-layer" aria-label="图表数据点">
        ${pointList
          .map(({ x, y, value, date, readableDate }, index) => {
            const label = `${readableDate}，${value}${unit}`;
            return `<button class="chart-point-button" type="button" data-chart-point data-chart-index="${escapeHtml(index)}" data-chart-date="${escapeHtml(date)}" data-chart-value="${escapeHtml(value)}" data-chart-unit="${escapeHtml(unit)}" data-chart-label="${escapeHtml(label)}" data-chart-x="${escapeHtml(x)}" data-chart-y="${escapeHtml(y)}" data-point-x="${escapeHtml((x / width) * 100)}" data-point-y="${escapeHtml((y / height) * 100)}" aria-label="${escapeHtml(label)}" aria-pressed="false" aria-describedby="${escapeHtml(liveId)}"></button>`;
          })
          .join("")}
      </div>
      <output class="chart-tooltip" id="${escapeHtml(liveId)}" role="status" aria-live="polite" hidden></output>
    </div>
  `;
}
