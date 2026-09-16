import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const config = vi.hoisted(() => ({}));
vi.mock("../../server/config.mjs", () => config);
const nutrition = { calories: 500, protein: 30, carbs: 60, fat: 15, confidence: 0.9, details: [] };
const response = (payload, status = 200) => new Response(JSON.stringify(payload), { status, headers: { "x-request-id": "upstream-id" } });
let service;
beforeEach(async () => {
  vi.resetModules();
  Object.assign(config, {
    nutritionAiEndpoint: "https://nutrition.test/estimate",
    nutritionAiApiKey: "test-only",
    nutritionAiModel: "test-model",
    nutritionAiProtocol: "contract",
    nutritionAiTimeoutMs: 3000,
  });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async () => response(nutrition)),
  );
  service = await import("../../server/nutrition.mjs");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("nutrition service failure and response contracts", () => {
  it("rejects empty food and unconfigured providers before contacting an upstream", async () => {
    await expect(service.requestNutritionEstimate(" ")).rejects.toMatchObject({ status: 400, code: "EMPTY_FOOD_TEXT", retryable: false });
    config.nutritionAiEndpoint = "https://example.com";
    expect(service.nutritionAiConfigured()).toBe(false);
    await expect(service.requestNutritionEstimate("米饭")).rejects.toMatchObject({ status: 503, code: "AI_PROVIDER_NOT_CONFIGURED" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("bounds input, passes context, and marks uncertain responses for review", async () => {
    fetch.mockResolvedValue(
      response({
        ...nutrition,
        confidence: 0.5,
        warnings: ["份量不确定"],
        assumptions: [" 一碗 "],
        details: [{ ...nutrition, grams: 100 }],
      }),
    );
    const result = await service.requestNutritionEstimate("饭".repeat(700), { oilGrams: 5 });
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({
      foodText: "饭".repeat(600),
      locale: "zh-CN",
      context: { oilGrams: 5 },
    });
    expect(result).toMatchObject({
      requestId: "upstream-id",
      source: "model",
      needsReview: true,
      assumptions: ["一碗"],
      details: [{ name: "食物 1", grams: 100 }],
    });
  });

  it.each([
    [429, "AI_RATE_LIMITED", 429],
    [500, "AI_UPSTREAM_FAILED", 503],
    [401, "AI_UPSTREAM_FAILED", 503],
  ])("maps upstream %i into a retryable structured error", async (status, code, expectedStatus) => {
    fetch.mockResolvedValue(response({ error: { message: "provider unavailable" } }, status));
    await expect(service.requestNutritionEstimate("米饭")).rejects.toMatchObject({
      status: expectedStatus,
      code,
      retryable: true,
      requestId: "upstream-id",
    });
  });

  it.each([{}, { ...nutrition, protein: -1 }, { output_text: "not json" }, { choices: [{ message: { content: "{broken}" } }] }])(
    "rejects malformed or negative model data: %j",
    async (payload) => {
      fetch.mockResolvedValue(response(payload));
      await expect(service.requestNutritionEstimate("米饭")).rejects.toMatchObject({
        status: 502,
        code: "AI_INVALID_RESPONSE",
        retryable: false,
      });
    },
  );

  it.each([
    { result: nutrition },
    { output_text: `说明 ${JSON.stringify(nutrition)} 完毕` },
    { choices: [{ message: { content: `\`\`\`json\n${JSON.stringify(nutrition)}\n\`\`\`` } }] },
    { choices: [{ message: { content: [{ text: JSON.stringify(nutrition) }] } }] },
    { output: [{ content: [{ text: JSON.stringify(nutrition) }] }] },
  ])("accepts supported provider envelopes without trusting their source label", async (payload) => {
    fetch.mockResolvedValue(response(payload));
    expect(await service.requestNutritionEstimate("米饭")).toMatchObject({ calories: 500, source: "model", needsReview: false });
  });

  it("rejects oversized streamed responses before parsing them", async () => {
    fetch.mockResolvedValue(new Response("饭".repeat(90000)));
    await expect(service.requestNutritionEstimate("米饭")).rejects.toMatchObject({ code: "AI_INVALID_RESPONSE", retryable: false });
  });

  it("maps network failures and aborts to different actionable errors", async () => {
    fetch.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(service.requestNutritionEstimate("米饭")).rejects.toMatchObject({ code: "AI_NETWORK_ERROR", status: 503 });
    vi.useFakeTimers();
    fetch.mockImplementationOnce(
      (url, { signal }) =>
        new Promise((resolve, reject) => {
          signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
        }),
    );
    const pending = expect(service.requestNutritionEstimate("米饭")).rejects.toMatchObject({ code: "AI_TIMEOUT", status: 504 });
    await vi.advanceTimersByTimeAsync(3000);
    await pending;
  });

  it("uses the OpenAI-compatible request contract when configured", async () => {
    config.nutritionAiProtocol = "openai-compatible";
    config.nutritionAiApiKey = "";
    await service.requestNutritionEstimate("米饭");
    const request = fetch.mock.calls[0][1];
    expect(request.headers.Authorization).toBeUndefined();
    expect(JSON.parse(request.body)).toMatchObject({
      model: "test-model",
      response_format: { type: "json_object" },
      messages: [{ role: "system" }, { role: "user" }],
    });
  });

  it("caches identical requests, isolates context, and expires after ten minutes", async () => {
    vi.useFakeTimers();
    await service.requestNutritionEstimate("米饭", { oilGrams: 5 });
    expect(await service.requestNutritionEstimate("米饭", { oilGrams: 5 })).toMatchObject({ cached: true });
    await service.requestNutritionEstimate("米饭", { oilGrams: 10 });
    expect(fetch).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(600000);
    await service.requestNutritionEstimate("米饭", { oilGrams: 5 });
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
