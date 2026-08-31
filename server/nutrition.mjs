import { createHash, randomUUID } from "node:crypto";
import { nutritionAiApiKey, nutritionAiEndpoint, nutritionAiModel, nutritionAiProtocol, nutritionAiTimeoutMs } from "./config.mjs";

const MAX_FOOD_TEXT_LENGTH = 600;
const MAX_UPSTREAM_BODY_BYTES = 256 * 1024;
const RESPONSE_CACHE_TTL_MS = 10 * 60 * 1000;
const RESPONSE_CACHE_MAX_ENTRIES = 200;
const responseCache = new Map();

function hasRealValue(value) {
  const text = String(value || "").trim();
  return Boolean(text && !text.includes("your-") && !text.includes("example.com"));
}

export function nutritionAiConfigured() {
  return hasRealValue(nutritionAiEndpoint) && hasRealValue(nutritionAiModel);
}

function nutritionError(message, { status = 502, code = "AI_SERVICE_FAILED", retryable = true, requestId = randomUUID() } = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.retryable = retryable;
  error.requestId = requestId;
  return error;
}

function finiteNutritionNumber(value, field, requestId) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw nutritionError(`模型返回的 ${field} 数据无效`, {
      status: 502,
      code: "AI_INVALID_RESPONSE",
      retryable: false,
      requestId,
    });
  }
  return Math.round(number * 10) / 10;
}

function clampConfidence(value, fallback = 0.5) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
}

function stringList(value, limit = 8) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, limit);
}

function parseJsonText(value, requestId) {
  if (typeof value !== "string") return value;
  const trimmed = value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
      } catch {
        // Fall through to the structured error below.
      }
    }
  }
  throw nutritionError("模型没有返回可解析的营养 JSON", {
    status: 502,
    code: "AI_INVALID_RESPONSE",
    retryable: false,
    requestId,
  });
}

function candidateFromUpstream(payload, requestId) {
  if (payload && Number.isFinite(Number(payload.calories))) return payload;
  if (payload?.result && Number.isFinite(Number(payload.result.calories))) return payload.result;
  if (typeof payload?.output_text === "string") return parseJsonText(payload.output_text, requestId);

  const chatContent = payload?.choices?.[0]?.message?.content;
  if (typeof chatContent === "string") return parseJsonText(chatContent, requestId);
  if (Array.isArray(chatContent)) {
    const text = chatContent.map((part) => part?.text || part?.content || "").join("");
    if (text) return parseJsonText(text, requestId);
  }

  const responseText = payload?.output
    ?.flatMap((item) => (Array.isArray(item?.content) ? item.content : []))
    ?.map((part) => part?.text || "")
    ?.join("");
  if (responseText) return parseJsonText(responseText, requestId);

  throw nutritionError("模型响应缺少营养结果", {
    status: 502,
    code: "AI_INVALID_RESPONSE",
    retryable: false,
    requestId,
  });
}

function normalizeDetails(details, requestId) {
  if (!Array.isArray(details)) return [];
  return details.slice(0, 20).map((item, index) => ({
    name: String(item?.name || `食物 ${index + 1}`).slice(0, 80),
    amount: String(item?.amount || "").slice(0, 40),
    grams: finiteNutritionNumber(item?.grams ?? 0, "食物克重", requestId),
    calories: finiteNutritionNumber(item?.calories, "食物热量", requestId),
    protein: finiteNutritionNumber(item?.protein, "食物蛋白质", requestId),
    carbs: finiteNutritionNumber(item?.carbs, "食物碳水", requestId),
    fat: finiteNutritionNumber(item?.fat, "食物脂肪", requestId),
    confidence: clampConfidence(item?.confidence),
  }));
}

function normalizeNutritionResponse(payload, { requestId, context, upstreamRequestId }) {
  const candidate = candidateFromUpstream(payload, requestId);
  const assumptions = stringList(candidate.assumptions);
  const warnings = stringList(candidate.warnings);
  const confidence = clampConfidence(candidate.confidence);
  return {
    requestId: String(candidate.requestId || upstreamRequestId || requestId),
    source: "model",
    model: String(candidate.model || payload?.model || nutritionAiModel),
    confidence,
    needsReview: Boolean(candidate.needsReview) || confidence < 0.72 || warnings.length > 0,
    calories: finiteNutritionNumber(candidate.calories, "热量", requestId),
    protein: finiteNutritionNumber(candidate.protein, "蛋白质", requestId),
    carbs: finiteNutritionNumber(candidate.carbs, "碳水", requestId),
    fat: finiteNutritionNumber(candidate.fat, "脂肪", requestId),
    details: normalizeDetails(candidate.details, requestId),
    assumptions,
    warnings,
    context,
  };
}

function openAiCompatibleBody(foodText, context, locale) {
  const schema = {
    calories: "number",
    protein: "number",
    carbs: "number",
    fat: "number",
    confidence: "0-1 number",
    needsReview: "boolean",
    assumptions: ["string"],
    warnings: ["string"],
    details: [
      {
        name: "string",
        amount: "string",
        grams: "number",
        calories: "number",
        protein: "number",
        carbs: "number",
        fat: "number",
        confidence: "0-1 number",
      },
    ],
  };
  return {
    model: nutritionAiModel,
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `你是谨慎的营养记录助手。只输出 JSON，不提供医疗诊断。无法确定份量时必须写入 assumptions，并降低 confidence。输出结构：${JSON.stringify(schema)}`,
      },
      {
        role: "user",
        content: JSON.stringify({ foodText, context, locale }),
      },
    ],
  };
}

function requestBody(foodText, context, locale) {
  if (nutritionAiProtocol === "contract") {
    return { foodText, context, locale, model: nutritionAiModel };
  }
  return openAiCompatibleBody(foodText, context, locale);
}

async function responsePayload(response, requestId) {
  const reader = typeof response.body?.getReader === "function" ? response.body.getReader() : null;
  let text;
  if (!reader) {
    text = await response.text();
    if (text.length > MAX_UPSTREAM_BODY_BYTES) {
      throw nutritionError("AI 服务响应过大，无法处理", { status: 502, code: "AI_INVALID_RESPONSE", retryable: false, requestId });
    }
  } else {
    const chunks = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value?.byteLength || 0;
      if (received > MAX_UPSTREAM_BODY_BYTES) {
        await reader.cancel().catch(() => {});
        throw nutritionError("AI 服务响应过大，无法处理", { status: 502, code: "AI_INVALID_RESPONSE", retryable: false, requestId });
      }
      if (value) chunks.push(value);
    }
    const merged = new Uint8Array(received);
    let offset = 0;
    chunks.forEach((chunk) => {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    });
    text = new TextDecoder().decode(merged);
  }
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { error: { message: text.slice(0, 240) } };
  }
}

function responseCacheKey(foodText, context, locale) {
  return createHash("sha256")
    .update(JSON.stringify([foodText, context, locale, nutritionAiModel, nutritionAiEndpoint]))
    .digest("hex");
}

function readCachedResponse(key) {
  const entry = responseCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    responseCache.delete(key);
    return null;
  }
  responseCache.delete(key);
  responseCache.set(key, entry); // Refresh LRU position.
  return { ...entry.value, cached: true };
}

function writeCachedResponse(key, value) {
  responseCache.set(key, { expiresAt: Date.now() + RESPONSE_CACHE_TTL_MS, value });
  while (responseCache.size > RESPONSE_CACHE_MAX_ENTRIES) {
    responseCache.delete(responseCache.keys().next().value);
  }
}

export async function requestNutritionEstimate(foodTextValue, context = {}, { locale = "zh-CN" } = {}) {
  const requestId = randomUUID();
  const foodText = String(foodTextValue || "")
    .trim()
    .slice(0, MAX_FOOD_TEXT_LENGTH);
  if (!foodText) {
    throw nutritionError("请先填写食物内容", {
      status: 400,
      code: "EMPTY_FOOD_TEXT",
      retryable: false,
      requestId,
    });
  }
  if (!nutritionAiConfigured()) {
    throw nutritionError("真实 AI 营养服务尚未配置，请先手动记录", {
      status: 503,
      code: "AI_PROVIDER_NOT_CONFIGURED",
      retryable: false,
      requestId,
    });
  }

  const cacheKey = responseCacheKey(foodText, context, locale);
  const cached = readCachedResponse(cacheKey);
  if (cached) return cached;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), nutritionAiTimeoutMs);
  try {
    const response = await fetch(nutritionAiEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(nutritionAiApiKey ? { Authorization: `Bearer ${nutritionAiApiKey}` } : {}),
        "X-Request-Id": requestId,
      },
      body: JSON.stringify(requestBody(foodText, context, locale)),
      signal: controller.signal,
    });
    const payload = await responsePayload(response, requestId);
    const upstreamRequestId = response.headers.get("x-request-id") || "";
    if (!response.ok) {
      const isRateLimited = response.status === 429;
      const message =
        payload?.error?.message || payload?.error || (isRateLimited ? "AI 请求过于频繁，请稍后重试" : "AI 营养服务暂时不可用");
      throw nutritionError(String(message), {
        status: isRateLimited ? 429 : 503,
        code: isRateLimited ? "AI_RATE_LIMITED" : "AI_UPSTREAM_FAILED",
        retryable: true,
        requestId: upstreamRequestId || requestId,
      });
    }
    const result = normalizeNutritionResponse(payload, { requestId, context, upstreamRequestId });
    writeCachedResponse(cacheKey, result);
    return result;
  } catch (error) {
    if (error?.code && error?.requestId) throw error;
    if (error?.name === "AbortError") {
      throw nutritionError("AI 营养服务响应超时，请稍后重试", {
        status: 504,
        code: "AI_TIMEOUT",
        retryable: true,
        requestId,
      });
    }
    throw nutritionError("无法连接 AI 营养服务，请稍后重试", {
      status: 503,
      code: "AI_NETWORK_ERROR",
      retryable: true,
      requestId,
    });
  } finally {
    clearTimeout(timeout);
  }
}
