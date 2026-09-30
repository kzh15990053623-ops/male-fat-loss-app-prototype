import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { supabaseApiHeaders } from "./supabase-headers.mjs";
import {
  hostedRuntime,
  nutritionAiAllowedUserId,
  nutritionAiBudgetPath,
  nutritionAiMonthlyBudgetMicros,
  nutritionAiBudgetGatewayToken,
  supabaseUrl,
  supabaseServiceRoleKey,
} from "./config.mjs";

// Reserve 0.10 CNY for EVERY dispatched attempt, including timeouts. No refunds:
// uncertain provider charges, retries and crashes must never replenish the quota.
// With one <=1024-token image, bounded text and <=2048 output tokens, this is
// conservative relative to the verified 2026-09-21 Flash peak prices (2/8 CNY per 1M).
export const REQUEST_RESERVE_MICROS = 100_000;
const MAX_MONTHLY_MICROS = 100_000_000;
let queue = Promise.resolve();

function unavailable() {
  return Object.assign(new Error("AI 预算账本不可用，已暂停识别，请检查服务端预算配置"), {
    status: 503,
    code: "AI_BUDGET_UNAVAILABLE",
    requestId: randomUUID(),
    retryable: false,
  });
}

export function assertNutritionOwner(userId) {
  if ((!nutritionAiAllowedUserId && hostedRuntime) || (nutritionAiAllowedUserId && nutritionAiAllowedUserId !== userId)) {
    throw Object.assign(new Error("拍照识别目前仅对配置的个人账号开放"), {
      status: 403,
      code: "AI_ACCOUNT_NOT_ALLOWED",
      requestId: randomUUID(),
      retryable: false,
    });
  }
}

export function budgetMonth(now = new Date()) {
  return new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 7);
}

function summary(month, entries, limit) {
  const rows = Object.values(entries).filter((entry) => entry.month === month);
  const reserved = rows.length * REQUEST_RESERVE_MICROS;
  return {
    month,
    limitCny: limit / 1_000_000,
    reservedCny: reserved / 1_000_000,
    estimatedCny: rows.reduce((sum, entry) => sum + (entry.estimatedMicros || 0), 0) / 1_000_000,
    requests: rows.length,
    unreportedRequests: rows.filter((entry) => entry.estimatedMicros === null).length,
    remainingRequests: rows.some((entry) => entry.estimatedMicros > REQUEST_RESERVE_MICROS)
      ? 0
      : Math.max(0, Math.floor((limit - reserved) / REQUEST_RESERVE_MICROS)),
  };
}

async function localOperation(action, requestId, usage) {
  await mkdir(dirname(nutritionAiBudgetPath), { recursive: true });
  // Cross-process exclusion. A crash leaves a lock and fails closed; do not
  // automatically discard it or erase a ledger to "recover" the budget.
  const lockPath = `${nutritionAiBudgetPath}.lock`;
  const lock = await open(lockPath, "wx", 0o600);
  try {
    let ledger;
    try {
      ledger = JSON.parse(await readFile(nutritionAiBudgetPath, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      ledger = { version: 1, entries: {} };
    }
    if (ledger.version !== 1 || !ledger.entries || Array.isArray(ledger.entries) || typeof ledger.entries !== "object") throw unavailable();
    for (const row of Object.values(ledger.entries)) {
      if (
        !/^\d{4}-\d{2}$/.test(row.month) ||
        !(row.estimatedMicros === null || (Number.isSafeInteger(row.estimatedMicros) && row.estimatedMicros >= 0))
      )
        throw unavailable();
    }
    const month = budgetMonth();
    const limit = Math.min(MAX_MONTHLY_MICROS, nutritionAiMonthlyBudgetMicros);
    const before = summary(month, ledger.entries, limit);
    if (action === "reserve") {
      if (!before.remainingRequests) return { ...before, allowed: false };
      if (ledger.entries[requestId]) throw unavailable();
      ledger.entries[requestId] = { month, estimatedMicros: null };
    } else if (action === "report") {
      const row = ledger.entries[requestId];
      if (!row) throw unavailable();
      row.estimatedMicros ??= usage.estimatedMicros;
      row.inputTokens = usage.inputTokens;
      row.outputTokens = usage.outputTokens;
    }
    if (action !== "status") {
      const tempPath = `${nutritionAiBudgetPath}.tmp`;
      const file = await open(tempPath, "w", 0o600);
      try {
        await file.writeFile(JSON.stringify(ledger));
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(tempPath, nutritionAiBudgetPath);
    }
    return { ...summary(month, ledger.entries, limit), allowed: true };
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}

async function operation(action, requestId = null, usage = null) {
  try {
    if (hostedRuntime) {
      if (!supabaseUrl || (!supabaseServiceRoleKey && !nutritionAiBudgetGatewayToken)) throw unavailable();
      const useGateway = Boolean(nutritionAiBudgetGatewayToken);
      const response = await fetch(
        `${supabaseUrl}${useGateway ? "/functions/v1/nutrition-budget-gateway" : "/rest/v1/rpc/nutrition_budget"}`,
        {
          method: "POST",
          signal: AbortSignal.timeout(useGateway ? 10000 : 5000),
          headers: useGateway
            ? { "Content-Type": "application/json", "X-Budget-Token": nutritionAiBudgetGatewayToken }
            : supabaseApiHeaders(supabaseServiceRoleKey, "", { "Content-Type": "application/json" }),
          body: JSON.stringify({ p_action: action, p_request_id: requestId, p_limit: nutritionAiMonthlyBudgetMicros, p_usage: usage }),
        },
      );
      if (!response.ok) throw unavailable();
      const data = await response.json();
      if (
        !data ||
        typeof data.allowed !== "boolean" ||
        !/^\d{4}-(0[1-9]|1[0-2])$/.test(data.month) ||
        ![data.reservedCny, data.limitCny, data.estimatedCny].every((n) => Number.isFinite(n) && n >= 0) ||
        ![data.requests, data.remainingRequests, data.unreportedRequests].every((n) => Number.isSafeInteger(n) && n >= 0) ||
        data.limitCny > 100 ||
        data.reservedCny !== data.requests / 10 ||
        data.unreportedRequests > data.requests ||
        (action === "reserve" && data.allowed && (data.requests === 0 || data.reservedCny > data.limitCny))
      )
        throw unavailable();
      return data;
    }
    const pending = queue.then(() => localOperation(action, requestId, usage));
    queue = pending.catch(() => {});
    return await pending;
  } catch {
    throw unavailable();
  }
}

export function nutritionBudgetStatus() {
  return operation("status");
}

export async function reserveNutritionBudget(requestId) {
  const result = await operation("reserve", requestId);
  if (!result.allowed)
    throw Object.assign(new Error("本月 AI 预算额度已用完，请下月再试或手动记录"), {
      status: 429,
      code: "AI_MONTHLY_BUDGET_EXCEEDED",
      requestId,
      retryable: false,
    });
  return result;
}

export async function reportNutritionUsage(requestId, usage) {
  const inputTokens = usage?.prompt_tokens;
  const outputTokens = usage?.completion_tokens;
  if (![inputTokens, outputTokens].every((n) => Number.isSafeInteger(n) && n >= 0 && n <= 1_000_000)) return null;
  // Peak, uncached pricing intentionally overestimates cache hits/off-peak usage.
  const estimatedMicros = inputTokens * 2 + outputTokens * 8;
  return operation("report", requestId, { inputTokens, outputTokens, estimatedMicros });
}
