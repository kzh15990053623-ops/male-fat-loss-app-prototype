import assert from "node:assert/strict";
import { createServer } from "node:http";

const received = [];
let mode = "success";
const mock = createServer(async (request, response) => {
  let body = "";
  for await (const chunk of request) body += chunk;
  received.push({ headers: request.headers, body: JSON.parse(body || "{}") });

  if (mode === "rate-limit") {
    response.writeHead(429, { "Content-Type": "application/json", "X-Request-Id": "upstream-rate" });
    response.end(JSON.stringify({ error: { message: "too many requests" } }));
    return;
  }

  response.writeHead(200, { "Content-Type": "application/json", "X-Request-Id": "upstream-ok" });
  response.end(
    JSON.stringify({
      source: "provider-internal",
      model: "mock-nutrition-model",
      calories: 526,
      protein: 42,
      carbs: 58,
      fat: 14,
      confidence: 0.81,
      needsReview: false,
      assumptions: ["米饭按半碗估算"],
      warnings: [],
      details: [
        { name: "鸡胸肉", amount: "150g", grams: 150, calories: 248, protein: 40, carbs: 0, fat: 6, confidence: 0.9 },
        { name: "米饭", amount: "半碗", grams: 120, calories: 168, protein: 2, carbs: 38, fat: 0, confidence: 0.72 },
      ],
    }),
  );
});

await new Promise((resolve, reject) => {
  mock.once("error", reject);
  mock.listen(0, "127.0.0.1", resolve);
});

try {
  const address = mock.address();
  process.env.NUTRITION_AI_ENDPOINT = `http://127.0.0.1:${address.port}/nutrition`;
  process.env.NUTRITION_AI_API_KEY = "test-key";
  process.env.NUTRITION_AI_MODEL = "mock-nutrition-model";
  process.env.NUTRITION_AI_PROTOCOL = "contract";
  process.env.NUTRITION_AI_TIMEOUT_MS = "3000";

  const { nutritionAiConfigured, requestNutritionEstimate } = await import("../server/nutrition.mjs");
  assert.equal(nutritionAiConfigured(), true);

  const result = await requestNutritionEstimate("半碗米饭、150g 鸡胸肉", { cooking: "清淡", oilGrams: 5 }, { locale: "zh-CN" });
  assert.equal(result.source, "model");
  assert.equal(result.model, "mock-nutrition-model");
  assert.equal(result.requestId, "upstream-ok");
  assert.equal(result.calories, 526);
  assert.equal(result.details.length, 2);
  assert.equal(result.details[0].confidence, 0.9);
  assert.deepEqual(result.assumptions, ["米饭按半碗估算"]);
  assert.equal(received[0].body.locale, "zh-CN");
  assert.equal(received[0].body.foodText, "半碗米饭、150g 鸡胸肉");
  assert.equal(received[0].headers.authorization, "Bearer test-key");

  mode = "rate-limit";
  await assert.rejects(
    () => requestNutritionEstimate("一份牛肉饭", {}, { locale: "zh-CN" }),
    (error) => error.code === "AI_RATE_LIMITED" && error.status === 429 && error.retryable === true && error.requestId === "upstream-rate",
  );

  await assert.rejects(
    () => requestNutritionEstimate("", {}, { locale: "zh-CN" }),
    (error) => error.code === "EMPTY_FOOD_TEXT" && error.status === 400 && error.retryable === false && Boolean(error.requestId),
  );
} finally {
  await new Promise((resolve) => mock.close(resolve));
}

console.log("Nutrition AI contract checks passed");
