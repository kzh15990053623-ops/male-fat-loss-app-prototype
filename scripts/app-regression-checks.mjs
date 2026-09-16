import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeAppData } from "../server/data.mjs";
import { discoverFrontendJsFiles } from "./frontend-files.mjs";

// Sends pre-formed raw bytes and returns the raw response. fetch() cannot
// emit a malformed request-target, so the malformed-request regression has
// to go through a raw socket.
async function rawSocketResponse(port, rawRequest) {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1");
    socket.setTimeout(5000);
    socket.on("connect", () => socket.write(rawRequest));
    socket.on("data", (chunk) => {
      const response = chunk.toString("utf8");
      socket.end();
      resolve(response);
    });
    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error("raw socket timed out"));
    });
    socket.on("error", reject);
  });
}

async function waitForServer(origin) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 6000) {
    try {
      const response = await fetch(`${origin}/api/health`);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("Timed out waiting for local server");
}

async function withServer(runChecks) {
  const localAuthDirectory = await mkdtemp(join(tmpdir(), "weight-lab-regression-"));
  const child = spawn(process.execPath, [join("scripts", "start-regression-server.mjs")], {
    env: {
      ...process.env,
      SUPABASE_URL: "https://your-project-ref.supabase.co",
      SUPABASE_ANON_KEY: "your-supabase-anon-key",
      LOCAL_AUTH_ENABLED: "true",
      LOCAL_AUTH_DATA_PATH: join(localAuthDirectory, "local-auth.json"),
      NUTRITION_AI_ENDPOINT: "https://your-ai-gateway.example.com/v1/chat/completions",
      NUTRITION_AI_API_KEY: "your-server-side-ai-key",
      NUTRITION_AI_MODEL: "your-model-name",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let readyBuffer = "";
  let readySettled = false;
  let resolveReady;
  let rejectReady;
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const readyTimeout = setTimeout(() => {
    if (!readySettled) {
      readySettled = true;
      rejectReady(new Error("Timed out waiting for regression server to report its local port"));
    }
  }, 6000);
  child.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    output += text;
    readyBuffer += text;
    const match = readyBuffer.match(/REGRESSION_SERVER_READY (http:\/\/127\.0\.0\.1:\d+)/);
    if (!readySettled && match) {
      readySettled = true;
      clearTimeout(readyTimeout);
      resolveReady(match[1]);
    }
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  child.once("error", (error) => {
    if (!readySettled) {
      readySettled = true;
      clearTimeout(readyTimeout);
      rejectReady(error);
    }
  });
  child.once("exit", (code) => {
    if (!readySettled) {
      readySettled = true;
      clearTimeout(readyTimeout);
      rejectReady(new Error(`Regression server exited before readiness (code ${code})`));
    }
  });
  try {
    const origin = await ready;
    await waitForServer(origin);
    await runChecks(origin);
  } finally {
    if (child.exitCode === null) {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill();
      await exited;
    }
    await rm(localAuthDirectory, { recursive: true, force: true });
  }
  assert.equal(output.includes("SUPABASE_ANON_KEY"), false);
  assert.equal(output.includes("NUTRITION_AI_API_KEY"), false);
}

async function checkStaticSecurity(origin) {
  const home = await fetch(`${origin}/`);
  assert.equal(home.status, 200);
  assert.match(home.headers.get("content-security-policy") || "", /default-src 'self'/);
  assert.equal(home.headers.get("x-frame-options"), "DENY");
  assert.equal(home.headers.get("strict-transport-security"), null, "plain HTTP responses must not carry HSTS");

  const forwardedSecure = await fetch(`${origin}/`, { headers: { "x-forwarded-proto": "https" } });
  assert.equal(forwardedSecure.headers.get("strict-transport-security"), "max-age=63072000; includeSubDomains");
  const forwardedSecureApi = await fetch(`${origin}/api/health`, { headers: { "x-forwarded-proto": "https" } });
  assert.equal(forwardedSecureApi.headers.get("strict-transport-security"), "max-age=63072000; includeSubDomains");

  for (const path of [
    "/src/app.js",
    "/src/app-render.js",
    "/src/render/shared.js",
    "/src/render/pages/home.js",
    "/src/styles.css",
    "/src/styles/tokens.css",
    "/src/styles/base.css",
    "/src/styles/components.css",
    "/src/styles/pages.css",
    "/sw.js",
  ]) {
    const response = await fetch(`${origin}${path}`);
    assert.equal(response.status, 200, `${path} should be served`);
  }

  const missingAppScript = await fetch(`${origin}/src/does-not-exist.js`);
  assert.equal(missingAppScript.status, 404);
  assert.doesNotMatch(missingAppScript.headers.get("content-type") || "", /text\/html/);

  const brotliResponse = await fetch(`${origin}/src/app-render.js`, { headers: { "Accept-Encoding": "br" } });
  assert.equal(brotliResponse.status, 200);
  assert.equal(brotliResponse.headers.get("content-encoding"), "br");
  assert.match(brotliResponse.headers.get("etag") || "", /^W\/"[A-Za-z0-9_-]{24}"$/);
  assert.match(brotliResponse.headers.get("vary") || "", /Accept-Encoding/);
  assert.match(await brotliResponse.text(), /renderHome/);

  const gzipResponse = await fetch(`${origin}/src/app-render.js`, { headers: { "Accept-Encoding": "gzip" } });
  assert.equal(gzipResponse.headers.get("content-encoding"), "gzip");
  assert.notEqual(gzipResponse.headers.get("etag"), brotliResponse.headers.get("etag"));
  assert.match(await gzipResponse.text(), /renderHome/);

  const bothResponse = await fetch(`${origin}/src/app-render.js`, { headers: { "Accept-Encoding": "gzip, br" } });
  assert.equal(bothResponse.headers.get("content-encoding"), "br");

  const identityResponse = await fetch(`${origin}/src/app-render.js`, { headers: { "Accept-Encoding": "identity" } });
  assert.equal(identityResponse.headers.get("content-encoding"), null);
  assert.notEqual(identityResponse.headers.get("etag"), brotliResponse.headers.get("etag"));
  assert.notEqual(identityResponse.headers.get("etag"), gzipResponse.headers.get("etag"));
  assert.match(await identityResponse.text(), /renderHome/);

  const brotliEtag = brotliResponse.headers.get("etag");
  const notModified = await fetch(`${origin}/src/app-render.js`, {
    headers: { "Accept-Encoding": "br", "If-None-Match": brotliEtag },
  });
  assert.equal(notModified.status, 304);
  assert.equal(notModified.headers.get("etag"), brotliEtag);

  for (const path of [
    "/.env",
    "/.git/config",
    "/data/app-state.json",
    "/data/local-auth.json",
    "/supabase/migrations/202606300001_init_app_states.sql",
    "/scripts/validate-data-model.mjs",
  ]) {
    const response = await fetch(`${origin}${path}`);
    const body = await response.text();
    assert.equal(response.status, 404, `${path} should not be publicly served`);
    assert.equal(body.includes("SUPABASE_URL"), false);
    assert.equal(body.includes("app_states"), false);
  }

  const health = await fetch(`${origin}/api/health`).then((response) => response.json());
  assert.equal(health.liveness, "ok");
  assert.equal(health.supabaseConfigured, false);
  assert.equal(health.localAuthEnabled, true);
  assert.equal(health.nutritionAiConfigured, false);

  const readinessResponse = await fetch(`${origin}/api/readiness`);
  const readiness = await readinessResponse.json();
  assert.equal(readinessResponse.status, 503);
  assert.equal(readiness.ok, false);
  assert.equal(readiness.auth.code, "AUTH_NOT_CONFIGURED");
  assert.equal(readiness.auth.ready, false);
  assert.equal(readiness.localAuth.available, true);
  assert.equal(readiness.localAuth.ready, true);

  const localEmail = "regression-local@example.com";
  const signup = await fetch(`${origin}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "local", email: localEmail, password: "secure-pass-01" }),
  });
  assert.equal(signup.status, 200);
  const localSession = await signup.json();
  assert.equal(localSession.provider, "local");
  assert.match(localSession.accessToken, /^local_access_/);
  const localCookie = (signup.headers.get("set-cookie") || "").split(";")[0];
  assert.match(localCookie, /^fat_loss_refresh=local_refresh_/);

  const localState = await fetch(`${origin}/api/state`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${localSession.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ state: { schemaVersion: 3, setupCompleted: true, weight: 85.6 }, meals: [], revision: 0 }),
  });
  assert.equal(localState.status, 200);
  const firstStatePayload = await localState.json();
  assert.equal(firstStatePayload.state.weight, 85.6);
  assert.equal(firstStatePayload.revision, 1);

  // 乐观并发契约：过期 revision 的写入必须以 409 拒绝并回传服务端当前载荷；
  // 客户端拿 conflict.revision 合并重试后必须成功。这正是“两个会话各写一天、
  // 后写者静默覆盖前写者”数据丢失事故的回归门禁。
  const conflictRead = await fetch(`${origin}/api/state`, { headers: { Authorization: `Bearer ${localSession.accessToken}` } });
  assert.equal(conflictRead.status, 200);
  const serverPayload = await conflictRead.json();
  assert.ok(Number.isInteger(serverPayload.revision) && serverPayload.revision >= 1, "read must expose the stored revision");

  const missingRevision = await fetch(`${origin}/api/state`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${localSession.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ state: { schemaVersion: 3, weight: 1 }, meals: [] }),
  });
  assert.equal(missingRevision.status, 409);
  assert.equal((await missingRevision.json()).code, "STATE_REVISION_REQUIRED");

  const invalidRevision = await fetch(`${origin}/api/state`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${localSession.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ state: { schemaVersion: 3, weight: 1 }, meals: [], revision: "1" }),
  });
  assert.equal(invalidRevision.status, 400);
  assert.equal((await invalidRevision.json()).code, "STATE_REVISION_INVALID");

  const unsupportedDelete = await fetch(`${origin}/api/state`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${localSession.accessToken}` },
  });
  assert.equal(unsupportedDelete.status, 405);
  assert.equal((await unsupportedDelete.json()).code, "STATE_DELETE_UNSUPPORTED");

  const staleWrite = await fetch(`${origin}/api/state`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${localSession.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      state: { schemaVersion: 3, setupCompleted: true, weight: 84 },
      meals: [],
      revision: serverPayload.revision - 1,
    }),
  });
  assert.equal(staleWrite.status, 409, "a stale-revision write must be rejected");
  const staleBody = await staleWrite.json();
  assert.equal(staleBody.code, "STATE_CONFLICT");
  assert.equal(staleBody.conflict.revision, serverPayload.revision, "conflict must carry the server's current payload and revision");
  assert.equal(staleBody.conflict.state.weight, 85.6, "the rejected write must NOT have overwritten the stored records");

  const mergedWrite = await fetch(`${origin}/api/state`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${localSession.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      state: { schemaVersion: 3, setupCompleted: true, weight: 85.6 },
      meals: [],
      revision: staleBody.conflict.revision,
    }),
  });
  assert.equal(mergedWrite.status, 200);
  assert.equal((await mergedWrite.json()).revision, serverPayload.revision + 1, "merged retry must increment the revision");

  // 恶意 request-target（fetch 无法发出的非法 URL）必须得到 400，且进程存活。
  const rawPort = Number(new URL(origin).port);
  const malformedResponse = await rawSocketResponse(rawPort, "GET http://[ HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n");
  assert.match(malformedResponse, /^HTTP\/1\.1 400/, "malformed request-target must answer 400, not crash the process");
  assert.match(malformedResponse, /REQUEST_TARGET_INVALID/);
  const survived = await fetch(`${origin}/api/health`);
  assert.equal(survived.status, 200, "server must keep serving after a malformed request-target");

  const refreshed = await fetch(`${origin}/api/auth/refresh`, {
    method: "POST",
    headers: { Cookie: localCookie, "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(refreshed.status, 200);
  assert.equal((await refreshed.json()).provider, "local");

  const refresh = await fetch(`${origin}/api/auth/refresh`, { method: "POST" });
  assert.equal(refresh.status, 204);

  const invalidJson = await fetch(`${origin}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{not-json",
  });
  assert.equal(invalidJson.status, 400);
  assert.equal((await invalidJson.json()).code, "REQUEST_BODY_INVALID");

  const logout = await fetch(`${origin}/api/auth/logout`, { method: "POST" });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get("set-cookie") || "", /fat_loss_refresh=.*HttpOnly/);

  let rateLimited = null;
  for (let attempt = 0; attempt < 21; attempt += 1) {
    const loginAttempt = await fetch(`${origin}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "local", email: "nobody@example.com", password: "wrong-pass-1" }),
    });
    if (loginAttempt.status === 429) {
      rateLimited = loginAttempt;
      break;
    }
  }
  assert.ok(rateLimited, "login endpoint should rate-limit repeated attempts");
  assert.equal((await rateLimited.json()).code, "AUTH_RATE_LIMITED");
  assert.ok(rateLimited.headers.get("retry-after"), "rate-limited responses must carry Retry-After");

  const deletionSignup = await fetch(`${origin}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "local", email: "delete-me@example.com", password: "secure-pass-01" }),
  });
  assert.equal(deletionSignup.status, 200);
  const deletionSession = await deletionSignup.json();
  const deleteAccountResponse = await fetch(`${origin}/api/auth/account`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${deletionSession.accessToken}` },
  });
  assert.equal(deleteAccountResponse.status, 200);
  const deletedUserCheck = await fetch(`${origin}/api/auth/user`, {
    headers: { Authorization: `Bearer ${deletionSession.accessToken}` },
  });
  assert.equal(deletedUserCheck.status, 401, "deleted account sessions must stop working immediately");
}

async function checkFrontendSourceGuards() {
  const frontendFiles = await discoverFrontendJsFiles();
  const entry = await readFile("src/app.js", "utf8");
  const source = (await Promise.all(frontendFiles.map((file) => readFile(file, "utf8")))).join("\n");
  const serviceWorker = await readFile("sw.js", "utf8");
  const styles = await readFile("src/styles.css", "utf8");
  const layeredStyles = (
    await Promise.all(
      ["src/styles/tokens.css", "src/styles/base.css", "src/styles/components.css", "src/styles/pages.css"].map((file) =>
        readFile(file, "utf8"),
      ),
    )
  ).join("\n");
  const tokens = await readFile("src/styles/tokens.css", "utf8");
  const fontLicense = await readFile("src/fonts/OFL.txt", "utf8");
  const html = await readFile("index.html", "utf8");
  const httpModule = await readFile("server/http.mjs", "utf8");

  assert.match(entry, /import \{ registerServiceWorker, bindConnectivityRetry, initApp \} from "\.\/app-actions\.js"/);
  assert.doesNotMatch(source, /globalThis\.FitnessApp/);
  assert.doesNotMatch(source, /Object\.assign\(app/);
  assert.doesNotMatch(source, /free-local-estimator/);
  assert.doesNotMatch(source, /data-app-action="photo"/);
  assert.doesNotMatch(source, /localStorage\.setItem\(LEGACY_TOKEN_KEY/);
  assert.match(source, /source !== "model"/);
  assert.match(source, /locale: "zh-CN"/);
  assert.match(source, /nutritionSource/);
  assert.match(source, /targetWeight >= values\.weight/);
  assert.match(source, /targetWaist >= values\.waist/);
  assert.match(source, /return Number\(state\.calorieBudget \|\| 0\) - totalIntake\(\)/);
  assert.match(source, /Math\.max\(0, Math\.min\(100/);
  assert.match(source, /data-undo-activity/);
  assert.match(source, /location\.hash === "#settings"/);
  assert.match(source, /inert aria-hidden="true"/);
  assert.match(source, /role="alert"/);
  assert.match(source, /API_AUTH_READINESS_URL/);
  assert.match(source, /data-auth-service-state/);
  assert.match(source, /data-use-local-auth/);
  assert.match(source, /provider: state\.authProvider/);
  assert.match(source, /root\.addEventListener\("click", handleAppClick\)/);
  assert.match(source, /if \(delegatedEventsBound\) return/);
  assert.match(source, /class="app-skeleton"/);
  assert.doesNotMatch(source, /querySelectorAll\("\[data-tab\]"\)\.forEach/);
  assert.doesNotMatch(source, /class="status-bar"/);
  assert.doesNotMatch(source, /模拟时间|Wi-Fi|电池/);
  assert.doesNotMatch(html, /fonts\.googleapis|fonts\.gstatic/);
  assert.match(source, /hydrateDynamicStyles\(root\)/, "render() must hydrate dynamic styles after innerHTML updates");
  assert.doesNotMatch(httpModule, /unsafe-inline/, "CSP style-src must not carry 'unsafe-inline'");

  assert.match(styles, /tokens\.css/);
  assert.match(styles, /base\.css/);
  assert.match(styles, /components\.css/);
  assert.match(styles, /pages\.css/);
  assert.match(tokens, /--ink: #102a3a/i);
  assert.match(tokens, /--green: #0b715b/i);
  assert.match(tokens, /--signal: #16a77d/i);
  assert.match(tokens, /--paper: #f2f0e9/i);
  assert.match(tokens, /--orange: #d86b24/i);
  assert.match(tokens, /--radius-control: 12px/);
  assert.match(tokens, /--radius-card: 20px/);
  assert.match(tokens, /--radius-hero: 28px/);
  assert.match(tokens, /@font-face/);
  assert.match(tokens, /data:font\/woff2;base64/);
  assert.match(tokens, /font-family: "Barlow Condensed"/);
  assert.match(fontLicense, /SIL OPEN FONT LICENSE Version 1\.1/);
  assert.match(layeredStyles, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(layeredStyles, /transition:\s*all/);
  for (const [, transition] of layeredStyles.matchAll(/transition:\s*([^;]+);/g)) {
    assert.match(transition.trim(), /^transform\s/, `non-composited transition found: ${transition.trim()}`);
  }

  const cacheName = serviceWorker.match(/CACHE_NAME = "([^"]+)"/)?.[1] || "";
  assert.match(cacheName, /^fitness-fat-loss-app-shell-v\d+$/, "service worker cache name must carry a numeric version");
  ["tokens.css", "base.css", "components.css", "pages.css"].forEach((file) => assert.match(serviceWorker, new RegExp(file)));
}

function resetFrontendState(state, meals, snapshot, mealSnapshot) {
  Object.keys(state).forEach((key) => delete state[key]);
  Object.assign(state, structuredClone(snapshot));
  meals.splice(0, meals.length, ...structuredClone(mealSnapshot));
  Object.assign(state, {
    authRequired: false,
    setupCompleted: true,
    weight: 86.4,
    weightDraft: 86.4,
    waist: 96,
    waistDraft: 96,
    startWeight: 86.4,
    startWaist: 96,
    targetWeight: 76,
    targetWaist: 86,
    calorieBudget: 1880,
    user: { height: 178, age: 34, bmr: 1818, dailyCalories: 1880 },
  });
}

function assertSafeMarkup(markup, page, scenario) {
  assert.equal(typeof markup, "string");
  assert.ok(markup.length > 200, `${page}/${scenario} should render meaningful markup`);
  assert.doesNotMatch(markup, /\b(?:NaN|undefined)\b/, `${page}/${scenario} leaked invalid data`);
  assert.doesNotMatch(markup, /420\s*kcal/, `${page}/${scenario} leaked the old demo burn value`);
}

async function checkFrontendModuleRuntime() {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(String(key)) ?? null,
    setItem: (key, value) => storage.set(String(key), String(value)),
    removeItem: (key) => storage.delete(String(key)),
  };
  globalThis.location = { hash: "#tab-home", protocol: "http:" };
  globalThis.history = { pushState() {}, replaceState() {} };
  Object.defineProperty(globalThis, "navigator", {
    value: { onLine: true },
    configurable: true,
  });

  const stateModule = await import("../src/app-state.js");
  const sync = await import("../src/app-sync.js");
  const render = await import("../src/app-render.js");
  const actions = await import("../src/app-actions.js");
  const { state, domainState, sessionState, uiState, meals, initialStateSnapshot, initialMealsSnapshot } = stateModule;

  state.weight = 88.1;
  state.backendStatus = "testing";
  state.toast = "slice-check";
  assert.equal(domainState.weight, 88.1);
  assert.equal(sessionState.backendStatus, "testing");
  assert.equal(uiState.toast, "slice-check");
  assert.equal(
    Object.keys(domainState).some((key) => key in sessionState || key in uiState),
    false,
  );
  assert.equal(
    Object.keys(sessionState).some((key) => key in uiState),
    false,
  );

  const pages = {
    home: render.renderHome,
    diet: render.renderDietLab,
    training: render.renderTrainingLab,
    data: render.renderDataLab,
    profile: render.renderProfileLab,
  };

  resetFrontendState(state, meals, initialStateSnapshot, initialMealsSnapshot);
  Object.entries(pages).forEach(([page, renderPage]) => assertSafeMarkup(renderPage(), page, "empty"));
  assert.match(render.renderDataLab(), /真实趋势正在建立/);
  assert.match(render.renderTrainingLab(), /燃脂快练/);
  assert.match(render.renderHome(), /现在记录/);
  assert.match(render.renderHome(), /体重 \/ 腰围/);

  meals[1].calories = 620;
  meals[1].status = "已记录";
  meals[1].foods = ["鸡胸肉", "米饭"];
  meals[1].macros = { protein: 42, carbs: 58, fat: 14 };
  state.weightLogs = [{ date: "2026-08-08", label: "今天", value: 86.4 }];
  state.dailyRecords = {
    "2026-08-08": {
      date: "2026-08-08",
      meals: structuredClone(meals),
      calorieBudget: 1880,
      waterMl: 800,
      steps: 3200,
      sleep: 6.5,
      customActivities: [],
      taskOverrides: {},
      workoutDone: false,
    },
  };
  Object.entries(pages).forEach(([page, renderPage]) => assertSafeMarkup(renderPage(), page, "partial"));

  state.weight = 85.7;
  state.waist = 95.2;
  state.weightLogs = [
    { date: "2026-08-07", label: "8月7日", value: 86.4 },
    { date: "2026-08-08", label: "今天", value: 85.7 },
  ];
  state.waistLogs = [
    { date: "2026-08-07", label: "8月7日", value: 96 },
    { date: "2026-08-08", label: "今天", value: 95.2 },
  ];
  state.customActivities = [{ id: 1, name: "坡度快走", type: "有氧恢复", minutes: 35, kcal: 205, createdAt: "19:20" }];
  state.dailyRecords["2026-08-07"] = {
    date: "2026-08-07",
    meals: structuredClone(meals),
    calorieBudget: 1880,
    waterMl: 2400,
    steps: 9800,
    sleep: 7.2,
    customActivities: [{ kcal: 180 }],
    taskOverrides: {},
    workoutDone: true,
  };
  state.dailyRecords["2026-08-08"].customActivities = structuredClone(state.customActivities);
  Object.entries(pages).forEach(([page, renderPage]) => assertSafeMarkup(renderPage(), page, "full"));
  assert.match(render.renderDataLab(), /体重趋势/);
  assert.match(render.renderDataLab(), /基于真实记录/);

  state.calorieBudget = 1880;
  meals.forEach((meal) => {
    meal.calories = 0;
  });
  meals[0].calories = 500;
  state.customActivities = [{ kcal: 600 }];

  const invalidGoals = actions.validateCoreSettings({
    height: 178,
    age: 34,
    weight: 80,
    waist: 90,
    targetWeight: 80,
    targetWaist: 91,
    weeklyLoss: 0.5,
    calories: 1880,
  });
  assert.match(invalidGoals.targetWeight, /低于当前体重/);
  assert.match(invalidGoals.targetWaist, /低于当前腰围/);

  // Remote-clear tombstones must wipe stale local copies, not resurrect them.
  globalThis.document = { querySelectorAll: () => [] };
  const { runtime } = stateModule;
  runtime.accessToken = "regression-token";
  runtime.authUserId = "regression-user";
  runtime.authProvider = "supabase";
  const tombstoneStorageKey = "fat-loss-state-v3:regression-user";
  const staleLocal = {
    state: { ...initialStateSnapshot, setupCompleted: true, weight: 88 },
    meals: [],
    localUpdatedAt: "2036-08-20T00:00:00.000Z",
    revision: 0,
    dirtyBaseRevision: 0,
  };
  globalThis.localStorage.setItem(tombstoneStorageKey, JSON.stringify(staleLocal));
  const tombstone = {
    state: { schemaVersion: 3, clearedAt: "2026-08-21T00:00:00.000Z", syncRevision: 1 },
    meals: null,
    updatedAt: "2026-08-21T00:00:00.000Z",
    revision: 1,
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify(tombstone), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  try {
    assert.equal(await sync.loadServerState(), true);
    assert.equal(state.weight, 0, "remote tombstone must wipe stale local data");
    assert.equal(state.syncPending, false);
    const storedMarker = JSON.parse(globalThis.localStorage.getItem(tombstoneStorageKey));
    assert.equal(storedMarker.state.weight, undefined);
    assert.equal(storedMarker.state.clearedAt, tombstone.state.clearedAt);
    assert.equal(storedMarker.revision, 1);

    const postClearLocal = {
      ...staleLocal,
      state: { ...staleLocal.state, weight: 87.5 },
      localUpdatedAt: "2026-08-22T00:00:00.000Z",
      revision: 1,
      dirtyBaseRevision: 1,
    };
    globalThis.localStorage.setItem(tombstoneStorageKey, JSON.stringify(postClearLocal));
    state.weight = 87.5;
    assert.equal(await sync.loadServerState(), true);
    assert.equal(state.weight, 87.5, "a dirty mutation based on the observed clear revision must survive");
    assert.equal(state.syncPending, true, "post-clear local data should be scheduled for sync");
    clearTimeout(runtime.retryTimer);
  } finally {
    globalThis.fetch = originalFetch;
    runtime.accessToken = "";
    runtime.authUserId = "";
    runtime.retryTimer = undefined;
  }

  resetFrontendState(state, meals, initialStateSnapshot, initialMealsSnapshot);
  state.appLoading = false;
  state.authRequired = true;
  state.authFieldErrors = { email: "请输入有效邮箱地址", password: "密码至少需要 6 位" };
  const authShell = render.appShell();
  assert.match(authShell, /data-auth-form novalidate/);
  assert.match(authShell, /label for="auth-email"/);
  assert.match(authShell, /id="auth-password"/);
  assert.match(authShell, /auth-email-error/);
  state.authRequired = false;
  state.setupCompleted = false;
  const setupShell = render.appShell();
  assert.match(setupShell, /data-setup-form novalidate/);
  assert.match(setupShell, /type="submit" data-complete-setup/);

  resetFrontendState(state, meals, initialStateSnapshot, initialMealsSnapshot);
  state.appLoading = false;
  Object.keys(pages).forEach((tab) => {
    state.activeTab = tab;
    const shell = render.appShell();
    assertSafeMarkup(shell, tab, "shell");
    assert.match(shell, new RegExp(`href="#tab-${tab}"`));
  });
}

function checkServerNormalization() {
  const normalized = normalizeAppData({
    state: {
      schemaVersion: 3,
      appLoading: true,
      toast: "do not persist",
      authPasswordVisible: true,
      authFieldErrors: { email: "bad" },
      setupFieldErrors: { weight: "bad" },
      settingsDraft: { weight: 90 },
      undoActivity: { id: 1 },
      baseBurned: 420,
      chartData: { fake: true },
      user: { height: 178 },
      dailyRecords: {
        "2026-08-08": { calorieBudget: 1880, meals: [], customActivities: [], taskOverrides: {} },
      },
    },
    meals: [
      {
        id: "lunch",
        name: "午餐",
        calories: 620,
        foods: ["鸡胸肉"],
        macros: { protein: 42, carbs: 58, fat: 14 },
        nutritionSource: "ai",
        aiMeta: { requestId: "req-1", model: "model-a", confidence: 1.4, needsReview: true, edited: true },
      },
    ],
  });
  assert.equal(normalized.state.toast, undefined);
  assert.equal(normalized.state.appLoading, undefined);
  assert.equal(normalized.state.authPasswordVisible, undefined);
  assert.equal(normalized.state.authFieldErrors, undefined);
  assert.equal(normalized.state.setupFieldErrors, undefined);
  assert.equal(normalized.state.settingsDraft, undefined);
  assert.equal(normalized.state.undoActivity, undefined);
  assert.equal(normalized.state.baseBurned, undefined);
  assert.equal(normalized.state.chartData, undefined);
  assert.equal(normalized.state.dailyRecords["2026-08-08"].calorieBudget, 1880);
  assert.equal(normalized.meals[0].nutritionSource, "ai");
  assert.equal(normalized.meals[0].aiMeta.confidence, 1);
  assert.equal(normalized.meals[0].aiMeta.edited, true);
}

await withServer(checkStaticSecurity);
await checkFrontendSourceGuards();
await checkFrontendModuleRuntime();
checkServerNormalization();

console.log("App regression checks passed");
