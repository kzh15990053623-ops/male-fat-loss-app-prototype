import { state, runtime } from "../app-state.js";
import { escapeHtml, todayKey } from "../app-utils.js";
import { mealEntries, macrosAreKnown } from "../meal-entries.js";

export function renderEntryList(meal, date) {
  return mealEntries(meal, date)
    .filter((entry) => !entry.deletedAt)
    .map(
      (entry) => `
    <div class="record-entry"><p><strong>${escapeHtml(entry.food)}</strong><br />${entry.nutritionKnown === false ? "营养待补充" : `${Number(entry.calories)} kcal${macrosAreKnown(entry) ? "" : " · 宏量营养待补充"}`} · ${entry.amount ? `${Number(entry.amount)} ${escapeHtml(entry.unit)}` : "份量待补充"} · ${escapeHtml(entry.cooking || "不确定")}</p>
      <div class="record-entry-actions"><button type="button" class="outline-button" data-copy-meal-entry="${escapeHtml(entry.id)}" data-record-date="${escapeHtml(date)}">复制</button><button type="button" class="outline-button" data-edit-meal-entry="${escapeHtml(entry.id)}" data-record-date="${escapeHtml(date)}">修改</button><button type="button" class="outline-button" data-delete-meal-entry="${escapeHtml(entry.id)}" data-record-date="${escapeHtml(date)}">删除</button></div>
    </div>`,
    )
    .join("");
}

export function renderHistory() {
  const records = {
    ...Object.fromEntries((runtime.historyRows || []).filter((row) => row.record).map((row) => [row.date, row.record])),
    ...state.dailyRecords,
  };
  const dates = Object.keys(records).sort().reverse();
  const page = Math.max(0, Math.min(runtime.historyPage || 0, Math.max(0, Math.ceil(dates.length / 14) - 1)));
  return `<section class="content-section section-list history-records"><div class="section-title"><h2>历史明细与补录</h2><span>${dates.length} 个记录日</span></div>
    <form data-history-metrics class="settings-grid"><label class="field-label"><span>指标日期</span><input autocomplete="off" name="history-date" type="date" max="${escapeHtml(todayKey())}" value="${escapeHtml(todayKey())}" required /></label><label class="field-label"><span>体重 (kg)</span><input autocomplete="off" name="history-weight" type="number" min="40" max="200" step="0.1" /></label><label class="field-label"><span>腰围 (cm)</span><input autocomplete="off" name="history-waist" type="number" min="50" max="180" step="0.1" /></label><button class="outline-button" type="submit">保存所选日期指标</button></form>
    ${(state.recordConflicts || []).map((item, index) => `<details class="history-day"><summary>同步修改冲突 · 双方值已保留</summary><p>${escapeHtml(item.path.join(" / "))}</p><p>本机：${escapeHtml(JSON.stringify(item.local))}</p><p>云端：${escapeHtml(JSON.stringify(item.remote))}</p><button class="outline-button" type="button" data-snapshot-conflict="${escapeHtml(index)}" data-conflict-choice="local">保留本机值</button><button class="outline-button" type="button" data-snapshot-conflict="${escapeHtml(index)}" data-conflict-choice="remote">采用云端值</button></details>`).join("")}
    ${(runtime.historyConflicts || []).map((row) => `<details class="history-day"><summary>${escapeHtml(row.date)} 记录冲突 · 双方内容已保留</summary><pre>${escapeHtml(JSON.stringify({ 本机: row.record, 云端: row.conflict.record }, null, 2))}</pre><button class="outline-button" data-history-choice="local" data-record-date="${escapeHtml(row.date)}">保留本机版本</button><button class="outline-button" data-history-choice="remote" data-record-date="${escapeHtml(row.date)}">保留云端版本</button></details>`).join("")}
    <button class="outline-button" type="button" data-load-history>读取更早的云端历史</button>
    <p>饮食补录：在饮食页选择日期。旧记录营养和完整度需要重新确认。</p>
    ${
      dates
        .slice(page * 14, (page + 1) * 14)
        .map((date) => {
          const record = records[date];
          return `<details class="history-day"><summary>${escapeHtml(date)} · ${record.intakeStatus === "complete" ? "饮食已确认" : "饮食待确认"}</summary><p>${record.weight ? `体重 ${Number(record.weight)} kg` : "体重未记录"} · ${record.waist ? `腰围 ${Number(record.waist)} cm` : "腰围未记录"}</p>
        ${(record.meals || []).map((meal) => renderEntryList(meal, date)).join("") || "<p>饮食未记录</p>"}<button class="outline-button" type="button" data-confirm-intake data-record-date="${escapeHtml(date)}">${record.intakeStatus === "complete" ? "改为待确认" : "确认这天的饮食完整"}</button>
        ${(record.customActivities || []).map((activity, index) => `<p>${escapeHtml(activity.name || "运动记录")} · ${Number(activity.minutes || 0)} 分钟 ${date !== todayKey() ? `<button type="button" class="outline-button" data-delete-history-activity="${escapeHtml(activity.id ?? index)}" data-record-date="${escapeHtml(date)}">删除误记运动</button>` : ""}</p>`).join("")}</details>`;
        })
        .join("") || "<p>还没有历史记录。</p>"
    }
    <div class="record-entry-actions"><button type="button" class="outline-button" data-history-page="${escapeHtml(page - 1)}" ${page === 0 ? "disabled" : ""}>上一页</button><button type="button" class="outline-button" data-history-page="${escapeHtml(page + 1)}" ${(page + 1) * 14 >= dates.length ? "disabled" : ""}>下一页</button></div></section>`;
}
