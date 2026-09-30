import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { API_PORT, assertDockerReady, assertExpectedLocalUrl, localSupabaseStatus } from "./supabase-test-stack.mjs";

function requiredStatusValue(status, key) {
  const value = String(status?.[key] || "").trim();
  assert.ok(value, `Local Supabase status is missing ${key}`);
  return value;
}

async function jsonRequest(url, { method = "GET", headers = {}, body } = {}) {
  const response = await fetch(url, {
    method,
    signal: AbortSignal.timeout(15000),
    headers: {
      ...headers,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text.slice(0, 500);
    }
  }
  return { response, payload };
}

function authHeaders(apiKey, token = apiKey) {
  return { apikey: apiKey, Authorization: `Bearer ${token}` };
}

async function createUser(apiUrl, serviceRoleKey, email, password) {
  const { response, payload } = await jsonRequest(`${apiUrl}/auth/v1/admin/users`, {
    method: "POST",
    headers: authHeaders(serviceRoleKey),
    body: { email, password, email_confirm: true },
  });
  assert.equal(response.status, 200, `Local admin user creation failed (${response.status})`);
  assert.ok(payload?.id, "Local admin user creation did not return an id");
  return payload;
}

async function deleteUser(apiUrl, serviceRoleKey, userId) {
  const { response } = await jsonRequest(`${apiUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: "DELETE",
    headers: authHeaders(serviceRoleKey),
  });
  assert.ok(response.ok || response.status === 404, `Local admin user cleanup failed (${response.status})`);
}

async function signIn(apiUrl, anonKey, email, password) {
  const { response, payload } = await jsonRequest(`${apiUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anonKey },
    body: { email, password },
  });
  assert.equal(response.status, 200, `Local sign-in failed (${response.status})`);
  assert.ok(payload?.access_token && payload?.user?.id, "Local sign-in did not return a user session");
  return payload;
}

async function restRequest(apiUrl, apiKey, token, path, options = {}) {
  return jsonRequest(`${apiUrl}/rest/v1/${path}`, {
    ...options,
    headers: {
      ...authHeaders(apiKey, token),
      ...(options.headers || {}),
    },
  });
}

async function assertReadIsDeniedOrEmpty(result, label) {
  if (result.response.ok) {
    assert.deepEqual(result.payload, [], `${label} unexpectedly returned another user's health record`);
    return;
  }
  assert.ok([401, 403].includes(result.response.status), `${label} failed with an unexpected status ${result.response.status}`);
}

let status;
try {
  await assertDockerReady();
  status = await localSupabaseStatus();
} catch (error) {
  console.error(
    error.message?.startsWith("NOT RUN:")
      ? error.message
      : "NOT RUN: Dedicated local Supabase is unavailable. Run npm run supabase:test:start. No remote project is accepted.",
  );
  process.exit(1);
}
const apiUrl = assertExpectedLocalUrl(requiredStatusValue(status, "API_URL"), API_PORT, "API").origin;
const anonKey = requiredStatusValue(status, "ANON_KEY");
const serviceRoleKey = requiredStatusValue(status, "SERVICE_ROLE_KEY");

// Set server configuration only after the loopback and dedicated-port checks.
process.env.SUPABASE_URL = apiUrl;
process.env.SUPABASE_ANON_KEY = anonKey;
process.env.SUPABASE_SERVICE_ROLE_KEY = serviceRoleKey;
process.env.LOCAL_AUTH_ENABLED = "false";

const { readAppState, writeAppState } = await import(`../server/supabase.mjs?local-integration=${Date.now()}`);
const runId = randomUUID();
const password = `Local-only-${runId}`;
const createdUserIds = new Set();

try {
  const userA = await createUser(apiUrl, serviceRoleKey, `integration-a-${runId}@example.com`, password);
  createdUserIds.add(userA.id);
  const userB = await createUser(apiUrl, serviceRoleKey, `integration-b-${runId}@example.com`, password);
  createdUserIds.add(userB.id);
  const [sessionA, sessionB] = await Promise.all([
    signIn(apiUrl, anonKey, userA.email, password),
    signIn(apiUrl, anonKey, userB.email, password),
  ]);

  const firstA = await writeAppState(
    { state: { schemaVersion: 3, weight: 82.4 }, meals: [], revision: 0 },
    sessionA.access_token,
    userA.id,
  );
  assert.equal(firstA.revision, 1);
  assert.equal((await readAppState(sessionA.access_token, userA.id)).state.weight, 82.4);
  console.log("PASS: migrations allow a signed-in user to create and read their own record");

  for (const [label, token] of [
    ["Cross-user", sessionB.access_token],
    ["Anonymous", anonKey],
  ]) {
    const inserted = await restRequest(apiUrl, anonKey, token, "app_states", {
      method: "POST",
      body: { user_id: randomUUID(), state: { weight: 1 } },
    });
    assert.ok([401, 403].includes(inserted.response.status), `${label} insertion must be rejected by the user policy`);
    const updated = await restRequest(apiUrl, anonKey, token, `app_states?user_id=eq.${encodeURIComponent(userA.id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: { state: { schemaVersion: 3, weight: 1, syncRevision: 999 } },
    });
    await assertReadIsDeniedOrEmpty(updated, `${label} update`);
    const removed = await restRequest(apiUrl, anonKey, token, `app_states?user_id=eq.${encodeURIComponent(userA.id)}`, {
      method: "DELETE",
      headers: { Prefer: "return=representation" },
    });
    await assertReadIsDeniedOrEmpty(removed, `${label} deletion`);
  }
  assert.equal((await readAppState(sessionA.access_token, userA.id)).state.weight, 82.4);

  const firstB = await writeAppState(
    { state: { schemaVersion: 3, weight: 70.1 }, meals: [], revision: 0 },
    sessionB.access_token,
    userB.id,
  );
  assert.equal(firstB.revision, 1);

  const crossUserRead = await restRequest(
    apiUrl,
    anonKey,
    sessionB.access_token,
    `app_states?select=user_id,state&user_id=eq.${encodeURIComponent(userA.id)}`,
  );
  await assertReadIsDeniedOrEmpty(crossUserRead, "User B read");

  const anonymousRead = await restRequest(
    apiUrl,
    anonKey,
    anonKey,
    `app_states?select=user_id,state&user_id=eq.${encodeURIComponent(userA.id)}`,
  );
  await assertReadIsDeniedOrEmpty(anonymousRead, "Anonymous read");

  assert.equal((await readAppState(sessionA.access_token, userA.id)).state.weight, 82.4);
  console.log("PASS: anonymous and cross-user reads, inserts, updates and deletes cannot access another user's record");

  const competingWrites = await Promise.allSettled([
    writeAppState({ state: { schemaVersion: 3, weight: 81.9 }, meals: [], revision: 1 }, sessionA.access_token, userA.id),
    writeAppState({ state: { schemaVersion: 3, weight: 81.7 }, meals: [], revision: 1 }, sessionA.access_token, userA.id),
  ]);
  const fulfilled = competingWrites.filter((result) => result.status === "fulfilled");
  const rejected = competingWrites.filter((result) => result.status === "rejected");
  assert.equal(fulfilled.length, 1, "Exactly one same-revision write must win the local Supabase CAS race");
  assert.equal(rejected.length, 1, "Exactly one same-revision write must be rejected as a conflict");
  assert.equal(rejected[0].reason?.code, "STATE_CONFLICT");
  assert.equal((await readAppState(sessionA.access_token, userA.id)).revision, 2);
  console.log("PASS: exactly one concurrent same-revision save succeeds and the other reports a conflict");

  const ownDelete = await restRequest(apiUrl, anonKey, sessionB.access_token, `app_states?user_id=eq.${encodeURIComponent(userB.id)}`, {
    method: "DELETE",
    headers: { Prefer: "return=representation" },
  });
  assert.equal(ownDelete.response.status, 200);
  assert.equal(ownDelete.payload?.length, 1, "A signed-in user can delete their own record");
  assert.equal(ownDelete.payload[0].user_id, userB.id);
  assert.equal((await readAppState(sessionB.access_token, userB.id)).revision, 0);
  assert.equal((await readAppState(sessionA.access_token, userA.id)).revision, 2, "Deleting B's record must preserve A's record");
  console.log("PASS: deleting one's own record leaves the other user's record intact");

  await deleteUser(apiUrl, serviceRoleKey, userA.id);
  createdUserIds.delete(userA.id);
  const cascadeCheck = await restRequest(
    apiUrl,
    serviceRoleKey,
    serviceRoleKey,
    `app_states?select=user_id&user_id=eq.${encodeURIComponent(userA.id)}`,
  );
  assert.equal(cascadeCheck.response.status, 200);
  assert.deepEqual(cascadeCheck.payload, [], "Deleting an auth user must cascade-delete the user's app state");
  console.log("PASS: deleting an auth account removes its associated app record");
} finally {
  await Promise.all([...createdUserIds].map((userId) => deleteUser(apiUrl, serviceRoleKey, userId)));
}

console.log("Local Supabase migration, RLS, CAS, and delete-cascade integration checks passed");
