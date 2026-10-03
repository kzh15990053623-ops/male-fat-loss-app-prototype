// A server-to-server gateway with its own limited credential. Supabase's injected
// admin key stays inside the function and is never returned to callers or Render.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
const MAX_BODY_BYTES = 4096;

const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const unavailable = () => json({ code: "AI_BUDGET_UNAVAILABLE" }, 503);

async function boundedJson(request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("missing body");
  let length = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) throw new Error("body too large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

function validOperation(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  if (
    Object.keys(body).some(
      (key) => !["p_action", "p_request_id", "p_limit", "p_usage", "p_user_id", "p_monthly_limit", "p_daily_limit"].includes(key),
    )
  )
    return false;
  if (!["status", "reserve", "report"].includes(body.p_action)) return false;
  if (
    body.p_user_id !== undefined &&
    (!UUID.test(body.p_user_id) ||
      !Number.isInteger(body.p_monthly_limit) ||
      body.p_monthly_limit < 1 ||
      body.p_monthly_limit > 20 ||
      !Number.isInteger(body.p_daily_limit) ||
      body.p_daily_limit < 1 ||
      body.p_daily_limit > 5)
  )
    return false;
  if (body.p_user_id === undefined && (body.p_monthly_limit !== undefined || body.p_daily_limit !== undefined)) return false;
  if (!Number.isSafeInteger(body.p_limit) || body.p_limit < 0 || body.p_limit > 100_000_000) return false;
  if (body.p_action === "status" ? body.p_request_id !== null : !UUID.test(body.p_request_id)) return false;
  if (body.p_action !== "report") return body.p_usage === null;
  const usage = body.p_usage;
  return Boolean(
    usage &&
    Object.keys(usage).length === 3 &&
    [usage.inputTokens, usage.outputTokens].every((n) => Number.isSafeInteger(n) && n >= 0 && n <= 1_000_000) &&
    usage.estimatedMicros === usage.inputTokens * 2 + usage.outputTokens * 8,
  );
}

function equalHash(actual, expected) {
  if (!HASH.test(expected)) return false;
  let difference = 0;
  for (let index = 0; index < 64; index++) difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  return difference === 0;
}

export function createBudgetGateway({ url, apiKey, fetchImpl = fetch }) {
  return async (request) => {
    if (request.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED" }, 405);
    const token = request.headers.get("X-Budget-Token") || "";
    if (!HASH.test(token)) return json({ code: "UNAUTHORIZED" }, 401);
    if (!url || !apiKey) return unavailable();
    const headers = {
      apikey: apiKey,
      ...(!apiKey.startsWith("sb_secret_") ? { Authorization: `Bearer ${apiKey}` } : {}),
      "Content-Type": "application/json",
    };
    try {
      const credential = await fetchImpl(`${url}/rest/v1/nutrition_budget_gateway_credentials?select=token_hash&singleton=eq.true`, {
        headers,
        signal: AbortSignal.timeout(5000),
      });
      if (!credential.ok) return unavailable();
      const rows = await credential.json();
      if (!Array.isArray(rows) || rows.length !== 1) return unavailable();
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
      const actual = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      if (!equalHash(actual, rows[0].token_hash)) return json({ code: "UNAUTHORIZED" }, 401);
      let body;
      try {
        body = await boundedJson(request);
      } catch {
        return json({ code: "INVALID_BUDGET_OPERATION" }, 400);
      }
      if (!validOperation(body)) return json({ code: "INVALID_BUDGET_OPERATION" }, 400);
      const result = await fetchImpl(`${url}/rest/v1/rpc/${body.p_user_id ? "nutrition_budget_for_user" : "nutrition_budget"}`, {
        method: "POST",
        headers,
        signal: AbortSignal.timeout(5000),
        body: JSON.stringify(body),
      });
      if (!result.ok) return unavailable();
      return json(await result.json());
    } catch {
      return unavailable();
    }
  };
}
