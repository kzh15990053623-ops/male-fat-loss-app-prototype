import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const config = vi.hoisted(() => ({}));
const budget = vi.hoisted(() => ({
  assertNutritionOwner: vi.fn(),
  nutritionBudgetStatus: vi.fn(),
  reserveNutritionBudget: vi.fn(),
  reportNutritionUsage: vi.fn(),
}));
vi.mock("../../server/config.mjs", () => config);
vi.mock("../../server/nutrition-budget.mjs", () => budget);
const nutrition = { calories: 500, protein: 30, carbs: 60, fat: 15, confidence: 0.9, details: [] };
const response = (payload, status = 200) => new Response(JSON.stringify(payload), { status, headers: { "x-request-id": "upstream-id" } });
let service;
beforeEach(async () => {
  for (const mock of Object.values(budget)) mock.mockReset();
  budget.reserveNutritionBudget.mockResolvedValue({ reservedCny: 0.1 });
  budget.reportNutritionUsage.mockResolvedValue(null);
  budget.nutritionBudgetStatus.mockResolvedValue({ reservedCny: 0.2 });
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

describe("DeepSeek photos and spending boundary", () => {
  const photo = `data:image/jpeg;base64,${Buffer.from([255, 216, 255, 192, 0, 11, 8, 0, 10, 0, 20, 1, 1, 17, 0, 255, 217]).toString("base64")}`;
  function useDeepseek() {
    Object.assign(config, {
      nutritionAiProtocol: "deepseek",
      nutritionAiEndpoint: "https://api.deepseek.com/chat/completions",
      nutritionAiModel: "deepseek-flash",
    });
    fetch.mockImplementation(async () =>
      response({
        ...nutrition,
        details: [{ ...nutrition, name: "米饭", amount: "一碗", grams: 150 }],
        usage: { prompt_tokens: 1700, completion_tokens: 500 },
      }),
    );
  }
  it("accepts a photo without text, bounds output, disables thinking and always requires review", async () => {
    useDeepseek();
    const result = await service.requestNutritionEstimate("", { extra: "private", oilGrams: 0 }, { imageDataUrl: photo, userId: "owner" });
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body).toMatchObject({ model: "deepseek-flash", max_tokens: 2048, thinking: { type: "disabled" } });
    expect(body.messages[1].content).toEqual([
      { type: "text", text: JSON.stringify({ foodText: "", context: { oilGrams: null }, locale: "zh-CN" }) },
      { type: "image_url", image_url: { url: photo, detail: "high" } },
    ]);
    expect(result).toMatchObject({ inputMode: "photo", foodText: "米饭（一碗）", needsReview: true, budget: { reservedCny: 0.1 } });
    expect(JSON.stringify(result)).not.toContain("base64");
    expect(budget.assertNutritionOwner).toHaveBeenCalledWith("owner");
    expect(budget.reserveNutritionBudget.mock.invocationCallOrder[0]).toBeLessThan(fetch.mock.invocationCallOrder[0]);
    expect(budget.reportNutritionUsage).toHaveBeenCalledWith(expect.any(String), { prompt_tokens: 1700, completion_tokens: 500 });
  });
  it("blocks before spending on invalid photo, unsupported vision, wrong endpoint/model/key or denied owner", async () => {
    await expect(service.requestNutritionEstimate("饭", {}, { imageDataUrl: "https://localhost/private" })).rejects.toMatchObject({
      code: "AI_INVALID_IMAGE",
    });
    await expect(service.requestNutritionEstimate("饭", {}, { imageDataUrl: photo })).rejects.toMatchObject({
      code: "AI_VISION_NOT_CONFIGURED",
    });
    useDeepseek();
    for (const key of ["nutritionAiEndpoint", "nutritionAiModel", "nutritionAiApiKey"]) {
      const original = config[key];
      config[key] = "wrong";
      // The key must be blank or a placeholder to be detectably unconfigured.
      if (key === "nutritionAiApiKey") config[key] = "your-key";
      await expect(service.requestNutritionEstimate("饭")).rejects.toMatchObject({ code: "AI_PROVIDER_NOT_CONFIGURED" });
      config[key] = original;
    }
    budget.assertNutritionOwner.mockImplementation(() => {
      throw Object.assign(new Error("denied"), { code: "AI_ACCOUNT_NOT_ALLOWED" });
    });
    await expect(service.requestNutritionEstimate("饭")).rejects.toMatchObject({ code: "AI_ACCOUNT_NOT_ALLOWED" });
    expect(fetch).not.toHaveBeenCalled();
    expect(budget.reserveNutritionBudget).not.toHaveBeenCalled();
  });
  it("does not dispatch when reservation fails and keeps the reservation after upstream failure", async () => {
    useDeepseek();
    budget.reserveNutritionBudget.mockRejectedValueOnce(Object.assign(new Error("limit"), { code: "AI_MONTHLY_BUDGET_EXCEEDED" }));
    await expect(service.requestNutritionEstimate("饭")).rejects.toMatchObject({ code: "AI_MONTHLY_BUDGET_EXCEEDED" });
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockRejectedValueOnce(new Error("network"));
    await expect(service.requestNutritionEstimate("饭")).rejects.toMatchObject({ code: "AI_NETWORK_ERROR" });
    expect(budget.reserveNutritionBudget).toHaveBeenCalledTimes(2);
    expect(budget.reportNutritionUsage).not.toHaveBeenCalled();
  });
  it("retains a result when usage reporting fails, rejects no-food photos and malformed results after charging", async () => {
    useDeepseek();
    budget.reportNutritionUsage.mockRejectedValueOnce(new Error("database timeout"));
    expect(await service.requestNutritionEstimate("饭")).toMatchObject({ budget: { reservedCny: 0.1 } });
    fetch.mockResolvedValueOnce(response(nutrition));
    await expect(service.requestNutritionEstimate("", {}, { imageDataUrl: photo })).rejects.toMatchObject({ code: "AI_FOOD_NOT_FOUND" });
    fetch.mockResolvedValueOnce(response({ broken: true, usage: { prompt_tokens: 100, completion_tokens: 10 } }));
    await expect(service.requestNutritionEstimate("未知食物")).rejects.toMatchObject({ code: "AI_INVALID_RESPONSE" });
    expect(budget.reserveNutritionBudget).toHaveBeenCalledTimes(3);
    expect(budget.reportNutritionUsage).toHaveBeenCalledTimes(3);
  });
  it("scopes caches by photo and user and returns fresh budget without spending on a cache hit", async () => {
    useDeepseek();
    await service.requestNutritionEstimate("饭", {}, { imageDataUrl: photo, userId: "a" });
    expect(await service.requestNutritionEstimate("饭", {}, { imageDataUrl: photo, userId: "a" })).toMatchObject({
      cached: true,
      budget: { reservedCny: 0.2 },
    });
    await service.requestNutritionEstimate("饭", {}, { imageDataUrl: photo, userId: "b" });
    await service.requestNutritionEstimate("饭", {}, { userId: "a" });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(budget.reserveNutritionBudget).toHaveBeenCalledTimes(3);
  });
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
