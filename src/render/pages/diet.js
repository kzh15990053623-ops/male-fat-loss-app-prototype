import { hasRecordedMeal, mealEntries } from "../../meal-entries.js";
import { todayKey } from "../../app-utils.js";
import { state, meals, runtime } from "../../app-state.js";
import { isNativeApp, aiAvailable } from "../../native-runtime.js";
import { icon, escapeHtml } from "../../app-utils.js";
import { macrosTotal, totalIntake, mealPlateOptions, dietScenarios } from "../../app-logic.js";
import { pageHeader, loadingSpinner, renderMeal, renderMealTemplate, renderNutritionResult, renderEnergyBudget } from "../shared.js";

export function renderDietLab() {
  const aiEnabled = aiAvailable() && state.preferences.aiAssist !== false;
  const recorded = meals.filter(hasRecordedMeal).length;
  return `
    ${pageHeader("好好吃饭", `${recorded} / 4 餐已记录`, `<button class="primary-small" type="button" data-scroll-meal-form>${icon("plus")}记录一餐</button>`)}

    <form class="meal-composer content-section section-form" id="meal-form" data-meal-form>
      <div class="composer-head">
        <span class="ai-orb" aria-hidden="true">${isNativeApp() && !aiEnabled ? "记" : "AI"}</span>
        <div>
          <h2>${state.mealDraft.editingId ? "修改这条饮食记录" : "记录刚刚吃的一餐"}</h2>
          <p>${aiEnabled ? "拍照或输入文字，识别后核对份量与营养。" : "可以先记录食物，营养未知时稍后补充。"}</p>
        </div>
      </div>
      <div class="composer-group">
      <h3 class="subsection-title">食物输入</h3>
      ${aiEnabled || isNativeApp() ? renderPhotoInput() : ""}
      <label class="composer-input">
        <span class="sr-only">食物内容</span>
        <textarea data-meal-food name="meal-food" autocomplete="off" maxlength="240" rows="3" placeholder="例如：午餐吃了半碗米饭、150g 鸡胸肉和一份炒青菜…" ${runtime.mealPhoto && aiEnabled ? "" : "required"}>${escapeHtml(state.mealDraft.food)}</textarea>
      </label>
      <label class="field-label"><span>记录日期</span><input type="date" autocomplete="off" name="meal-date" data-meal-date max="${escapeHtml(todayKey())}" value="${escapeHtml(state.mealDraft.date || todayKey())}" /></label><div class="composer-toolbar">
        <label class="compact-select">
          <span>记录到</span>
          <select ${state.mealDraft.editingId ? "disabled" : ""} data-meal-slot name="meal-slot" autocomplete="off">
            ${meals.map((meal) => `<option value="${escapeHtml(meal.id)}" ${state.mealDraft.slot === meal.id ? "selected" : ""}>${meal.name}</option>`).join("")}
          </select>
        </label>
        ${
          aiEnabled
            ? `<span class="ai-action-group"><button class="ai-recognize-button" type="button" data-ai-nutrition aria-busy="${escapeHtml(state.mealDraft.aiStatus === "submitting")}" ${state.mealDraft.aiStatus === "submitting" || runtime.mealPhotoLoading ? "disabled" : ""}>
          ${state.mealDraft.aiStatus === "submitting" ? loadingSpinner() : icon("spark")}${state.mealDraft.aiStatus === "submitting" ? "模型分析中…" : "AI 识别营养"}
        </button>${state.mealDraft.aiStatus === "submitting" ? `<button class="ai-cancel-button" type="button" data-cancel-ai>取消</button>` : ""}</span>`
            : `<span class="ai-offline-label">${isNativeApp() && !aiAvailable() ? "AI 暂不可用，可在“我的”查看连接状态" : "AI 已关闭"}</span>`
        }
      </div>
      </div>
      <div class="composer-group">
      <h3 class="subsection-title">营养核对</h3>
      ${aiEnabled ? renderAiFeedback() : ""}
      ${aiEnabled ? renderBudget() : ""}
      <details class="advanced-fields" ${state.mealDraft.advancedOpen ? "open" : ""}>
        <summary><span>份量与营养细节</span><small>可选 · 用于提升准确度</small></summary>
        <div class="ai-context-grid">
          <label class="field-label"><span>总量</span><input data-meal-amount name="meal-amount" type="number" inputmode="decimal" autocomplete="off" min="0" max="2000" step="any" value="${escapeHtml(state.mealDraft.amount || "")}" placeholder="300" /></label>
          <label class="field-label"><span>单位</span><select data-meal-unit name="meal-unit" autocomplete="off">${["g", "份", "碗", "个", "杯"].map((unit) => `<option value="${escapeHtml(unit)}" ${state.mealDraft.unit === unit ? "selected" : ""}>${unit}</option>`).join("")}</select></label>
          <label class="field-label"><span>做法</span><select data-meal-cooking name="meal-cooking" autocomplete="off">${["不确定", "清淡", "水煮", "蒸", "烤", "炒", "煎", "油炸"].map((item) => `<option value="${escapeHtml(item)}" ${state.mealDraft.cooking === item ? "selected" : ""}>${item}</option>`).join("")}</select></label>
          <label class="field-label"><span>用油 (g)</span><input data-meal-oil name="meal-oil" type="number" inputmode="decimal" autocomplete="off" min="0" max="80" step="1" value="${escapeHtml(state.mealDraft.oilGrams || "")}" placeholder="0" /></label>
          <label class="field-label"><span>酱料</span><select data-meal-sauce name="meal-sauce" autocomplete="off">${["不确定", "无", "少", "中", "多"].map((item) => `<option value="${escapeHtml(item)}" ${state.mealDraft.sauce === item ? "selected" : ""}>${item}</option>`).join("")}</select></label>
        </div>
        <div class="macro-input-grid nutrition-edit-grid">
          <label class="field-label"><span>热量</span><input data-meal-calories name="meal-calories" type="number" inputmode="decimal" autocomplete="off" min="0" max="1800" step="0.1" value="${escapeHtml(state.mealDraft.calories)}" /></label>
          <label class="field-label"><span>蛋白</span><input data-meal-protein name="meal-protein" type="number" inputmode="decimal" autocomplete="off" min="0" max="160" step="0.1" value="${escapeHtml(state.mealDraft.protein)}" /></label>
          <label class="field-label"><span>已知碳水</span><input data-meal-carbs name="meal-carbs" type="number" inputmode="decimal" autocomplete="off" min="0" max="220" step="0.1" value="${escapeHtml(state.mealDraft.carbs)}" /></label>
          <label class="field-label"><span>已知脂肪</span><input data-meal-fat name="meal-fat" type="number" inputmode="decimal" autocomplete="off" min="0" max="120" step="0.1" value="${escapeHtml(state.mealDraft.fat)}" /></label>
        </div>
        ${state.mealDraft.portionBase ? `<button class="outline-button" type="button" data-scale-portion>按当前份量比例调整营养</button>` : ""}
      </details>
      ${runtime.mealPhoto && state.mealDraft.aiResult?.inputMode === "photo" ? `<label class="photo-review"><input type="checkbox" data-photo-reviewed ${runtime.mealPhotoReviewKey ? "checked" : ""} /><span>我已核对食物、份量和营养数值</span></label>` : ""}
      </div>
      <div class="meal-action-grid composer-actions" aria-label="保存操作">
        <button class="outline-button" type="button" data-save-template>${icon("medal")}存为常用</button>
        <button class="complete-button" type="submit" data-add-meal>${icon("check")}保存本餐</button>
      </div>
    </form>

<section class="content-section section-overview"><p>已记录的摄入只包含已知营养；待补充条目不会被当成零摄入。</p><button class="outline-button" type="button" data-confirm-intake>${state.intakeStatus === "complete" ? "今天已确认完整 · 改为待确认" : "确认今天饮食已记录完整"}</button></section>
    ${renderMealOverview()}

    <details class="context-lab content-section section-advice">
      <summary><div><h2>食物搭配示例 · 营养需核对</h2></div><span>${icon("arrow")}</span></summary>
      ${renderDietScenarioGuide()}
      ${renderMealPlateGuide()}
    </details>

    ${renderRecentMeals()}

    <section class="section-block compact-block content-section section-list">
      <div class="section-title"><div><h2>常用餐</h2></div><span>${state.mealTemplates.length} 个</span></div>
      <div class="template-list">${state.mealTemplates.length ? state.mealTemplates.map(renderMealTemplate).join("") : `<div class="empty-state compact">${icon("fork")}<div><strong>还没有常用餐</strong><p>记录一餐后，可以把它存下来，下次更快完成。</p></div><button class="complete-button" type="button" data-scroll-meal-form>${icon("plus")}去记一餐</button></div>`}</div>
    </section>

    <section class="section-block content-section section-list">
      <div class="section-title"><div><h2>餐次明细</h2></div><span>${totalIntake()} kcal</span></div>
      <div class="meal-list">${meals.map(renderMeal).join("")}</div>
    </section>
  `;
}

function renderPhotoInput() {
  return `<div class="meal-photo-input">
    <div class="meal-photo-buttons">
      <button class="outline-button" type="button" data-pick-photo="camera">拍照记一餐</button>
      <button class="outline-button" type="button" data-pick-photo="album">从相册选择</button>
    </div>
    <input type="file" data-meal-photo="camera" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" capture="environment" hidden aria-label="拍摄餐食照片" />
    <input type="file" data-meal-photo="album" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" hidden aria-label="选择餐食照片" />
    ${runtime.mealPhotoLoading ? `<p class="composer-note" role="status">正在处理照片…</p>` : ""}
    ${runtime.mealPhotoError ? `<p class="photo-error" role="alert">${escapeHtml(runtime.mealPhotoError)}</p>` : ""}
    ${runtime.mealPhoto ? `<figure class="meal-photo-preview"><img src="${escapeHtml(runtime.mealPhoto.dataUrl)}" alt="${escapeHtml(isNativeApp() ? "本餐照片预览" : "待识别的本餐照片")}" /><figcaption><span>${isNativeApp() && (!aiAvailable() || state.preferences.aiAssist === false) ? "请手动填写食物与营养数值" : "可补充吃了多少、做法或用油"}</span><button type="button" class="ai-cancel-button" data-remove-photo>移除照片</button></figcaption></figure>` : ""}
    <p class="photo-privacy">${isNativeApp() && !aiAvailable() ? "照片仅供当前填写参考，不随记录保存。" : "识别时发送至 DeepSeek；本应用不保存照片。"}</p>
  </div>`;
}

function renderBudget() {
  const budget = runtime.nutritionBudget;
  return `<div class="nutrition-budget">
    <button type="button" class="ai-cancel-button" data-ai-budget ${runtime.nutritionBudgetLoading ? "disabled" : ""}>${runtime.nutritionBudgetLoading ? "读取中…" : "查看本月 AI 用量"}</button>
    ${budget ? `<p>${escapeHtml(budget.month)} · 已用 ${escapeHtml(budget.requests ?? 0)} / ${escapeHtml(budget.monthlyLimit ?? 20)} 次 · 今日最多 ${escapeHtml(budget.dailyLimit ?? 5)} 次<br />目前还可识别 ${escapeHtml(budget.remainingRequests)} 次</p><small>项目共用每月 ¥100 预算；调用前预占次数；发送失败、超时或识别失败不退回。相同账号 10 分钟内相同输入命中缓存不计次。个人次数或项目预算用完后仍可手动记录。</small>` : ""}
    ${runtime.nutritionBudgetMessage ? `<p role="status">${escapeHtml(runtime.nutritionBudgetMessage)}</p>` : ""}
  </div>`;
}

function renderDietScenarioGuide() {
  const scenarios = dietScenarios();
  return `
    <section class="scenario-card">
      <div class="section-title">
        <h3>生活场景策略</h3>
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
        <h3>今日餐盘方案</h3>
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
      AI_MONTHLY_BUDGET_EXCEEDED: "本月 AI 预算已用完",
      AI_BUDGET_UNAVAILABLE: "AI 预算暂时无法核实",
      AI_ACCOUNT_NOT_ALLOWED: "AI 仅对个人账号开放",
      AI_FOOD_NOT_FOUND: "请换一张餐食照片",
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
  return `<p class="composer-note">识别结果供记录参考，保存前请核对份量。</p>`;
}

function renderMealOverview() {
  const recorded = meals.filter(hasRecordedMeal).length;
  const macros = macrosTotal();
  return `
    <section class="meal-overview-card content-section section-overview">
      <div class="section-title">
        <h2>今日饮食汇总</h2>
        <span>${recorded} / 4 餐已记录</span>
      </div>
      ${renderEnergyBudget()}
      <div class="meal-overview-grid">
        ${meals
          .map((meal) => {
            const empty = !hasRecordedMeal(meal);
            const mealId = meal.id;
            const mealName = meal.name;
            return `
            <article class="meal-overview-item ${escapeHtml(empty ? "empty" : "done")}">
              <div>
                <strong>${escapeHtml(mealName)}</strong>
                <span>${empty ? "待记录" : meal.nutritionKnown === false ? "营养待补充" : `${meal.calories} kcal`}</span>
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
      <div class="nutrition-strip" role="group" aria-label="今日营养汇总">
        <div><span>已知蛋白质</span><strong>${macros.protein}<small>/${state.proteinTarget}g</small></strong></div>
        <div><span>碳水</span><strong>${macros.carbs}<small>g</small></strong></div>
        <div><span>脂肪</span><strong>${macros.fat}<small>g</small></strong></div>
      </div>
    </section>
  `;
}

function renderRecentMeals() {
  const dated = {
    ...Object.fromEntries((runtime.historyRows || []).map((row) => [row.date, row.record])),
    ...state.dailyRecords,
    [todayKey()]: { meals },
  };
  const recent = Object.entries(dated)
    .sort(([a], [b]) => b.localeCompare(a))
    .flatMap(([date, record]) =>
      (record?.meals || []).flatMap((meal) =>
        mealEntries(meal, date)
          .filter((entry) => !entry.deletedAt)
          .map((entry) => ({ date, entry })),
      ),
    )
    .slice(0, 5);
  if (!recent.length) return "";
  return (
    '<section class="content-section section-list"><div class="section-title"><h2>最近记录 · 快速复制</h2></div>' +
    recent
      .map(
        ({ date, entry }) =>
          '<button type="button" class="outline-button" data-copy-meal-entry="' +
          escapeHtml(entry.id) +
          '" data-record-date="' +
          escapeHtml(date) +
          '">' +
          escapeHtml(entry.food) +
          " · 复制到今天</button>",
      )
      .join("") +
    "</section>"
  );
}
