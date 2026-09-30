import { state, meals } from "../../app-state.js";
import { icon, escapeHtml } from "../../app-utils.js";
import { macrosTotal, totalIntake, remainingCalories, mealPlateOptions, dietScenarios } from "../../app-logic.js";
import { pageHeader, loadingSpinner, renderMeal, renderMealTemplate, renderNutritionResult } from "../shared.js";

export function renderDietLab() {
  const macros = macrosTotal();
  const aiEnabled = state.preferences.aiAssist !== false;
  const recorded = meals.filter((meal) => meal.calories > 0).length;
  return `
    ${pageHeader("好好吃饭", `${recorded} / 4 餐已记录`, `<button class="primary-small" type="button" data-scroll-meal-form>${icon("plus")}记录一餐</button>`)}

    <form class="meal-composer" id="meal-form" data-meal-form>
      <div class="composer-head">
        <span class="ai-orb" aria-hidden="true">AI</span>
        <div>
          <h2>描述你刚刚吃了什么</h2>
          <p>用自然语言输入，识别后所有数值都可以修改。</p>
        </div>
      </div>
      <label class="composer-input">
        <span class="sr-only">食物内容</span>
        <textarea data-meal-food name="meal-food" autocomplete="off" maxlength="240" rows="3" placeholder="例如：午餐吃了半碗米饭、150g 鸡胸肉和一份炒青菜…" required>${escapeHtml(state.mealDraft.food)}</textarea>
      </label>
      <div class="composer-toolbar">
        <label class="compact-select">
          <span>记录到</span>
          <select data-meal-slot name="meal-slot" autocomplete="off">
            ${meals.map((meal) => `<option value="${escapeHtml(meal.id)}" ${state.mealDraft.slot === meal.id ? "selected" : ""}>${meal.name}</option>`).join("")}
          </select>
        </label>
        ${
          aiEnabled
            ? `<span class="ai-action-group"><button class="ai-recognize-button" type="button" data-ai-nutrition aria-busy="${escapeHtml(state.mealDraft.aiStatus === "submitting")}" ${state.mealDraft.aiStatus === "submitting" ? "disabled" : ""}>
          ${state.mealDraft.aiStatus === "submitting" ? loadingSpinner() : icon("spark")}${state.mealDraft.aiStatus === "submitting" ? "模型分析中…" : "AI 识别营养"}
        </button>${state.mealDraft.aiStatus === "submitting" ? `<button class="ai-cancel-button" type="button" data-cancel-ai>取消</button>` : ""}</span>`
            : `<span class="ai-offline-label">AI 已关闭</span>`
        }
      </div>
      ${renderAiFeedback()}
      <details class="advanced-fields" ${state.mealDraft.advancedOpen ? "open" : ""}>
        <summary><span>份量与营养细节</span><small>可选 · 用于提升准确度</small></summary>
        <div class="ai-context-grid">
          <label class="field-label"><span>总量</span><input data-meal-amount name="meal-amount" type="number" inputmode="decimal" autocomplete="off" min="0" max="2000" step="10" value="${escapeHtml(state.mealDraft.amount || "")}" placeholder="300" /></label>
          <label class="field-label"><span>单位</span><select data-meal-unit name="meal-unit" autocomplete="off">${["g", "份", "碗", "个", "杯"].map((unit) => `<option value="${escapeHtml(unit)}" ${state.mealDraft.unit === unit ? "selected" : ""}>${unit}</option>`).join("")}</select></label>
          <label class="field-label"><span>做法</span><select data-meal-cooking name="meal-cooking" autocomplete="off">${["清淡", "水煮", "蒸", "烤", "炒", "煎", "油炸"].map((item) => `<option value="${escapeHtml(item)}" ${state.mealDraft.cooking === item ? "selected" : ""}>${item}</option>`).join("")}</select></label>
          <label class="field-label"><span>用油 (g)</span><input data-meal-oil name="meal-oil" type="number" inputmode="decimal" autocomplete="off" min="0" max="80" step="1" value="${escapeHtml(state.mealDraft.oilGrams || "")}" placeholder="0" /></label>
          <label class="field-label"><span>酱料</span><select data-meal-sauce name="meal-sauce" autocomplete="off">${["无", "少", "中", "多"].map((item) => `<option value="${escapeHtml(item)}" ${state.mealDraft.sauce === item ? "selected" : ""}>${item}</option>`).join("")}</select></label>
        </div>
        <div class="macro-input-grid nutrition-edit-grid">
          <label class="field-label"><span>热量</span><input data-meal-calories name="meal-calories" type="number" inputmode="numeric" autocomplete="off" min="0" max="1800" step="10" value="${escapeHtml(state.mealDraft.calories)}" /></label>
          <label class="field-label"><span>蛋白</span><input data-meal-protein name="meal-protein" type="number" inputmode="decimal" autocomplete="off" min="0" max="160" value="${escapeHtml(state.mealDraft.protein)}" /></label>
          <label class="field-label"><span>碳水</span><input data-meal-carbs name="meal-carbs" type="number" inputmode="decimal" autocomplete="off" min="0" max="220" value="${escapeHtml(state.mealDraft.carbs)}" /></label>
          <label class="field-label"><span>脂肪</span><input data-meal-fat name="meal-fat" type="number" inputmode="decimal" autocomplete="off" min="0" max="120" value="${escapeHtml(state.mealDraft.fat)}" /></label>
        </div>
      </details>
      <div class="meal-action-grid">
        <button class="outline-button" type="button" data-save-template>${icon("medal")}存为常用</button>
        <button class="complete-button" type="submit" data-add-meal>${icon("check")}保存本餐</button>
      </div>
    </form>

    ${renderMealOverview()}

    <section class="nutrition-strip" aria-label="今日营养汇总">
      <div><span>蛋白质</span><strong>${macros.protein}<small>/${state.proteinTarget}g</small></strong></div>
      <div><span>碳水</span><strong>${macros.carbs}<small>g</small></strong></div>
      <div><span>脂肪</span><strong>${macros.fat}<small>g</small></strong></div>
    </section>

    <details class="context-lab">
      <summary><div><h2>场景与餐盘建议</h2></div><span>${icon("arrow")}</span></summary>
      ${renderDietScenarioGuide()}
      ${renderMealPlateGuide()}
    </details>

    <section class="section-block compact-block">
      <div class="section-title"><div><h2>常用餐</h2></div><span>${state.mealTemplates.length} 个</span></div>
      <div class="template-list">${state.mealTemplates.length ? state.mealTemplates.map(renderMealTemplate).join("") : `<div class="empty-state compact">${icon("fork")}<div><strong>还没有常用餐</strong><p>记录一餐后，可以把它存下来，下次更快完成。</p></div><button class="complete-button" type="button" data-scroll-meal-form>${icon("plus")}去记一餐</button></div>`}</div>
    </section>

    <section class="section-block">
      <div class="section-title"><div><h2>餐次明细</h2></div><span>${totalIntake()} kcal</span></div>
      <div class="meal-list">${meals.map(renderMeal).join("")}</div>
    </section>
  `;
}

function renderDietScenarioGuide() {
  const scenarios = dietScenarios();
  return `
    <section class="scenario-card">
      <div class="section-title">
        <h2>生活场景策略</h2>
        <span>${scenarios.find((item) => item.id === state.dietScenario)?.title || "外卖"}</span>
      </div>
      <div class="scenario-tabs">
        ${scenarios
          .map(
            (item) => `
          <button class="${escapeHtml(state.dietScenario === item.id ? "active" : "")}" data-diet-scenario="${escapeHtml(item.id)}">${item.title}</button>
        `,
          )
          .join("")}
      </div>
      ${scenarios
        .filter((item) => item.id === state.dietScenario)
        .map(
          (item) => `
        <article class="scenario-detail">
          <div>
            <strong>${item.subtitle}</strong>
            <p>${item.rules.join(" · ")}</p>
          </div>
          <button class="outline-button" data-apply-scenario="${escapeHtml(item.id)}">${icon("plus")}套用记录</button>
        </article>
      `,
        )
        .join("")}
    </section>
  `;
}

function renderMealPlateGuide() {
  const options = mealPlateOptions();
  return `
    <section class="plate-guide-card">
      <div class="section-title">
        <h2>今日餐盘方案</h2>
        <span>按剩余热量生成</span>
      </div>
      <div class="plate-option-list">
        ${options
          .map(
            (option) => `
          <article class="plate-option">
            <div>
              <strong>${option.title}</strong>
              <p>${option.subtitle}</p>
              <span>${option.calories} kcal · P${option.protein} C${option.carbs} F${option.fat}</span>
            </div>
            <button class="mini-icon-button" data-plate-option="${escapeHtml(option.id)}" aria-label="套用${escapeHtml(option.title)}">${icon("plus")}</button>
          </article>
        `,
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderAiFeedback() {
  if (state.mealDraft.aiStatus === "submitting") {
    return `<div class="ai-feedback pending" role="status" aria-live="polite"><strong>正在分析这餐</strong><p>识别期间可以继续核对文字；取消后草稿仍会保留。</p></div>`;
  }
  if (state.mealDraft.aiStatus === "cancelled") {
    return `<div class="ai-feedback cancelled" role="status" aria-live="polite"><strong>没有改动当前草稿</strong><p>${escapeHtml(state.mealDraft.aiError || "已取消识别，当前草稿已保留。")}</p></div>`;
  }
  if (state.mealDraft.aiStatus === "error" || state.mealDraft.aiStatus === "offline") {
    const titles = {
      AI_RATE_LIMITED: "AI 请求过于频繁",
      AI_PROVIDER_NOT_CONFIGURED: "AI 服务尚未配置",
      AI_TIMEOUT: "AI 响应超时",
    };
    const title =
      state.mealDraft.aiStatus === "offline" ? "当前处于离线状态" : titles[state.mealDraft.aiErrorCode] || "AI 暂时无法完成识别";
    const nextStep =
      state.mealDraft.aiStatus === "offline"
        ? "联网后可以重试；当前手动输入会继续保留。"
        : state.mealDraft.aiRetryable
          ? "可以重试；当前手动输入会继续保留。"
          : "请展开营养细节并改用手动记录。";
    return `<div class="ai-feedback error" role="alert"><strong>${title}</strong><p>${escapeHtml(state.mealDraft.aiError || "AI 识别暂时不可用。")}</p><small>${nextStep}</small>${state.mealDraft.aiRequestId ? `<small>请求编号 ${escapeHtml(state.mealDraft.aiRequestId)}</small>` : ""}</div>`;
  }
  if (state.mealDraft.aiResult) return renderNutritionResult(state.mealDraft.aiResult);
  return `<p class="composer-note">AI 不会静默使用本地规则结果；服务不可用时将明确提示并保留手动输入。</p>`;
}

function renderMealOverview() {
  const recorded = meals.filter((meal) => meal.calories > 0).length;
  return `
    <section class="meal-overview-card">
      <div class="section-title">
        <h2>今日餐次</h2>
        <span>${totalIntake()} / ${state.calorieBudget} kcal</span>
      </div>
      <div class="meal-overview-stats">
        <article>
          <span>已记录</span>
          <strong>${recorded}<small> / 4 餐</small></strong>
        </article>
        <article>
          <span>剩余热量</span>
          <strong>${remainingCalories()}<small>kcal</small></strong>
        </article>
      </div>
      <div class="meal-overview-grid">
        ${meals
          .map((meal) => {
            const empty = meal.calories === 0;
            const mealId = meal.id;
            const mealName = meal.name;
            return `
            <article class="meal-overview-item ${escapeHtml(empty ? "empty" : "done")}">
              <div>
                <strong>${escapeHtml(mealName)}</strong>
                <span>${empty ? "待记录" : `${meal.calories} kcal`}</span>
              </div>
              ${
                empty
                  ? `<button class="mini-icon-button" data-record-meal="${escapeHtml(mealId)}" aria-label="记录${escapeHtml(mealName)}">${icon("plus")}</button>`
                  : `<span class="meal-overview-check" aria-hidden="true">${icon("check")}</span>`
              }
            </article>
          `;
          })
          .join("")}
      </div>
    </section>
  `;
}
