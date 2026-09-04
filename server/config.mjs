import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDotEnv } from "./env.mjs";

// Resolve the project root from this module's location so the server behaves
// the same no matter which directory it is launched from.
export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

loadDotEnv(join(root, ".env"));

export const port = Number(process.env.PORT || 5173);
export const supabaseUrl = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
export const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || "";
// Optional service-role key, used only for account deletion (admin deleteUser).
// Never exposed to the client; leave empty to disable cloud account deletion.
export const supabaseServiceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

function boundedNumber(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(Math.max(min, Math.min(max, parsed))) : fallback;
}

export const supabaseProbeTimeoutMs = boundedNumber(process.env.SUPABASE_PROBE_TIMEOUT_MS, 3500, 1000, 10000);
export const supabaseReadinessTtlMs = boundedNumber(process.env.SUPABASE_READINESS_TTL_MS, 30000, 5000, 300000);
export const supabaseRequestTimeoutMs = boundedNumber(process.env.SUPABASE_REQUEST_TIMEOUT_MS, 12000, 3000, 45000);
const hostedRuntime = process.env.NODE_ENV === "production" || process.env.RENDER === "true" || Boolean(process.env.VERCEL);
export const localAuthEnabled = process.env.LOCAL_AUTH_ENABLED ? process.env.LOCAL_AUTH_ENABLED === "true" : !hostedRuntime;
const configuredLocalAuthPath = String(process.env.LOCAL_AUTH_DATA_PATH || "").trim();
export const localAuthDataPath = configuredLocalAuthPath
  ? isAbsolute(configuredLocalAuthPath)
    ? configuredLocalAuthPath
    : resolve(root, configuredLocalAuthPath)
  : join(root, "data", "local-auth.json");
export const nutritionAiEndpoint = String(process.env.NUTRITION_AI_ENDPOINT || "").trim();
export const nutritionAiApiKey = String(process.env.NUTRITION_AI_API_KEY || "").trim();
export const nutritionAiModel = String(process.env.NUTRITION_AI_MODEL || "").trim();
export const nutritionAiProtocol = process.env.NUTRITION_AI_PROTOCOL === "contract" ? "contract" : "openai-compatible";
export const nutritionAiTimeoutMs = Math.max(3000, Math.min(45000, Number(process.env.NUTRITION_AI_TIMEOUT_MS || 15000)));
export const MAX_JSON_BODY_BYTES = 1_000_000;
export const REFRESH_COOKIE_NAME = "fat_loss_refresh";
