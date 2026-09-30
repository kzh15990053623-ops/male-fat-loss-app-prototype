import assert from "node:assert/strict";
import {
  assertSupabaseAuthReady,
  classifySupabaseNetworkError,
  probeSupabaseAuth,
  resetSupabaseReadinessCache,
  validateSupabaseConfig,
} from "../server/supabase.mjs";

const testUrl = "https://project-ref.supabase.co";
const testKey = "sb_publishable_test_key_1234567890";

const placeholder = validateSupabaseConfig({
  url: "https://your-project-ref.supabase.co",
  anonKey: "your-supabase-anon-key",
});
assert.equal(placeholder.valid, false);
assert.equal(placeholder.code, "AUTH_NOT_CONFIGURED");

let fetchCalls = 0;
const readyFetch = async (url, options) => {
  fetchCalls += 1;
  assert.equal(url, `${testUrl}/auth/v1/settings`);
  assert.equal(options.method, "GET");
  assert.equal(options.headers.apikey, testKey);
  return new Response(JSON.stringify({ disable_signup: false, autoconfirm: false }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

resetSupabaseReadinessCache();
const ready = await probeSupabaseAuth({
  fetchImpl: readyFetch,
  url: testUrl,
  anonKey: testKey,
  now: Date.parse("2026-08-10T00:00:00.000Z"),
  ttlMs: 30000,
});
assert.deepEqual(
  {
    configured: ready.configured,
    reachable: ready.reachable,
    ready: ready.ready,
    signupAllowed: ready.signupAllowed,
    emailConfirmationRequired: ready.emailConfirmationRequired,
    code: ready.code,
  },
  {
    configured: true,
    reachable: true,
    ready: true,
    signupAllowed: true,
    emailConfirmationRequired: true,
    code: "AUTH_READY",
  },
);

const cached = await probeSupabaseAuth({
  fetchImpl: readyFetch,
  url: testUrl,
  anonKey: testKey,
  now: Date.parse("2026-08-10T00:00:01.000Z"),
  ttlMs: 30000,
});
assert.equal(cached, ready);
assert.equal(fetchCalls, 1);

await probeSupabaseAuth({
  force: true,
  fetchImpl: readyFetch,
  url: testUrl,
  anonKey: testKey,
  now: Date.parse("2026-08-10T00:00:02.000Z"),
});
assert.equal(fetchCalls, 2);

resetSupabaseReadinessCache();
const signupDisabled = await probeSupabaseAuth({
  fetchImpl: async () => new Response(JSON.stringify({ disable_signup: true, autoconfirm: true }), { status: 200 }),
  url: testUrl,
  anonKey: testKey,
});
assert.equal(signupDisabled.ready, true);
assert.equal(signupDisabled.signupAllowed, false);
assert.equal(signupDisabled.code, "AUTH_SIGNUP_DISABLED");
assert.equal(signupDisabled.emailConfirmationRequired, false);
await assert.rejects(
  () => assertSupabaseAuthReady({ forSignup: true, probe: async () => signupDisabled }),
  (error) => error.code === "AUTH_SIGNUP_DISABLED" && error.status === 403 && error.retryable === false,
);
assert.equal(await assertSupabaseAuthReady({ probe: async () => signupDisabled }), signupDisabled);

resetSupabaseReadinessCache();
const badKey = await probeSupabaseAuth({
  fetchImpl: async () => new Response(JSON.stringify({ message: "Invalid API key" }), { status: 401 }),
  url: testUrl,
  anonKey: testKey,
});
assert.equal(badKey.reachable, true);
assert.equal(badKey.ready, false);
assert.equal(badKey.code, "AUTH_KEY_REJECTED");

resetSupabaseReadinessCache();
const dnsFailure = await probeSupabaseAuth({
  fetchImpl: async () => {
    throw new TypeError("fetch failed", { cause: { code: "ENOTFOUND" } });
  },
  url: testUrl,
  anonKey: testKey,
});
assert.equal(dnsFailure.configured, true);
assert.equal(dnsFailure.reachable, false);
assert.equal(dnsFailure.code, "AUTH_PROJECT_NOT_FOUND");
assert.doesNotMatch(dnsFailure.message, /fetch failed/i);
await assert.rejects(
  () => assertSupabaseAuthReady({ probe: async () => dnsFailure }),
  (error) => error.code === "AUTH_PROJECT_NOT_FOUND" && error.status === 503 && error.retryable === false,
);

const timeout = new Error("timed out");
timeout.name = "TimeoutError";
assert.equal(classifySupabaseNetworkError(timeout).code, "AUTH_PROVIDER_TIMEOUT");
assert.equal(classifySupabaseNetworkError({ code: "CERT_HAS_EXPIRED" }).code, "AUTH_TLS_FAILED");

console.log("Supabase auth readiness checks passed");
