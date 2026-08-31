import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";
import { localAuthDataPath, localAuthEnabled } from "./config.mjs";
import { defaultData, isRecord, normalizeAppData, sanitizeMeals, stateRevision, stateWriteRevision, storedStateForWrite } from "./data.mjs";
import { clearExpiredAccessSessions } from "./session.mjs";

const scrypt = promisify(scryptCallback);
// Explicit cost parameters (OWASP-aligned, above the Node default N=2^14).
// maxmem must be raised alongside N, otherwise 128*N*r exceeds Node's
// 32MB default memory limit and scrypt throws.
const SCRYPT_COST = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

// Records created before cost logging carry no `cost` block and are verified
// with Node's default parameters. The range guard keeps a tampered store file
// from asking for pathological (multi-second) derivations.
function scryptCostFromRecord(record) {
  const cost = isRecord(record) && isRecord(record.cost) ? record.cost : null;
  const N = Number(cost?.N);
  const r = Number(cost?.r);
  const p = Number(cost?.p);
  if (![N, r, p].every((value) => Number.isInteger(value))) return {};
  if (N < 16384 || N > 65536 || r < 8 || r > 16 || p < 1 || p > 2) return {};
  return { N, r, p, maxmem: 128 * N * r * 2 };
}
const STORE_SCHEMA_VERSION = 1;
const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function localAuthError(message, { status = 400, code = "LOCAL_AUTH_FAILED", retryable = false } = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.retryable = retryable;
  return error;
}

function cleanEmail(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function emptyStore() {
  return { schemaVersion: STORE_SCHEMA_VERSION, users: {}, refreshSessions: {} };
}

function normalizeStore(value) {
  if (!isRecord(value)) return emptyStore();
  return {
    schemaVersion: STORE_SCHEMA_VERSION,
    users: isRecord(value.users) ? value.users : {},
    refreshSessions: isRecord(value.refreshSessions) ? value.refreshSessions : {},
  };
}

function tokenHash(token) {
  return createHash("sha256")
    .update(String(token || ""))
    .digest("hex");
}

function newToken(prefix) {
  return `${prefix}${randomBytes(32).toString("base64url")}`;
}

async function passwordRecord(password) {
  const salt = randomBytes(16);
  const derivedKey = await scrypt(String(password), salt, 64, SCRYPT_COST);
  return {
    algorithm: "scrypt",
    cost: { N: SCRYPT_COST.N, r: SCRYPT_COST.r, p: SCRYPT_COST.p },
    salt: salt.toString("base64"),
    hash: Buffer.from(derivedKey).toString("base64"),
  };
}

async function passwordMatches(password, record) {
  if (!isRecord(record) || record.algorithm !== "scrypt" || !record.salt || !record.hash) return false;
  const expected = Buffer.from(record.hash, "base64");
  const actual = Buffer.from(
    await scrypt(String(password), Buffer.from(record.salt, "base64"), expected.length, scryptCostFromRecord(record)),
  );
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function createLocalAuthService({ filePath = localAuthDataPath, enabled = localAuthEnabled } = {}) {
  let writeQueue = Promise.resolve();
  const accessSessions = new Map();

  function assertEnabled() {
    if (!enabled) {
      throw localAuthError("本机账号模式未启用。", {
        status: 503,
        code: "LOCAL_AUTH_DISABLED",
      });
    }
  }

  async function readStore() {
    try {
      return normalizeStore(JSON.parse(await readFile(filePath, "utf8")));
    } catch (error) {
      if (error?.code === "ENOENT") return emptyStore();
      if (error instanceof SyntaxError) {
        throw localAuthError("本机账号数据损坏，请先导出日志并恢复备份。", {
          status: 500,
          code: "LOCAL_AUTH_STORE_CORRUPT",
        });
      }
      throw localAuthError("无法读取本机账号数据。", {
        status: 500,
        code: "LOCAL_AUTH_STORE_UNAVAILABLE",
        retryable: true,
      });
    }
  }

  async function writeStore(store) {
    await mkdir(dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, filePath);
  }

  async function mutateStore(mutator) {
    const operation = writeQueue.then(async () => {
      const store = await readStore();
      const result = await mutator(store);
      await writeStore(store);
      return result;
    });
    writeQueue = operation.catch(() => {});
    return operation;
  }

  async function stableRead(reader) {
    await writeQueue.catch(() => {});
    return reader(await readStore());
  }

  function publicUser(user) {
    return { id: user.id, email: user.email };
  }

  function issueSession(store, user, now = Date.now()) {
    clearExpiredAccessSessions(accessSessions, now);
    const accessToken = newToken("local_access_");
    const refreshToken = newToken("local_refresh_");
    accessSessions.set(tokenHash(accessToken), { userId: user.id, expiresAt: now + ACCESS_TOKEN_TTL_MS });
    store.refreshSessions[tokenHash(refreshToken)] = { userId: user.id, expiresAt: now + REFRESH_TOKEN_TTL_MS };
    return {
      provider: "local",
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
      user: publicUser(user),
    };
  }

  async function signup(email, password) {
    assertEnabled();
    const normalizedEmail = cleanEmail(email);
    if (!normalizedEmail || String(password || "").length < 6) {
      throw localAuthError("请输入有效邮箱和至少 6 位密码。", { code: "LOCAL_AUTH_INPUT_INVALID" });
    }
    return mutateStore(async (store) => {
      const duplicate = Object.values(store.users).some((user) => cleanEmail(user?.email) === normalizedEmail);
      if (duplicate) {
        throw localAuthError("这个邮箱已经创建过本机账号，请直接登录。", {
          status: 409,
          code: "AUTH_EMAIL_EXISTS",
        });
      }
      const user = {
        id: `local-${randomUUID()}`,
        email: normalizedEmail,
        password: await passwordRecord(password),
        createdAt: new Date().toISOString(),
        state: null,
        meals: null,
        updatedAt: null,
      };
      store.users[user.id] = user;
      return issueSession(store, user);
    });
  }

  async function login(email, password) {
    assertEnabled();
    const normalizedEmail = cleanEmail(email);
    return mutateStore(async (store) => {
      const user = Object.values(store.users).find((item) => cleanEmail(item?.email) === normalizedEmail);
      if (!user || !(await passwordMatches(password, user.password))) {
        throw localAuthError("邮箱或密码不正确。", {
          status: 401,
          code: "AUTH_INVALID_CREDENTIALS",
        });
      }
      return issueSession(store, user);
    });
  }

  async function refresh(refreshToken) {
    assertEnabled();
    if (!isLocalRefreshToken(refreshToken)) {
      throw localAuthError("本机会话已失效，请重新登录。", { status: 401, code: "AUTH_SESSION_INVALID" });
    }
    return mutateStore(async (store) => {
      const now = Date.now();
      Object.entries(store.refreshSessions).forEach(([hash, session]) => {
        if (!session || Number(session.expiresAt) <= now) delete store.refreshSessions[hash];
      });
      const currentHash = tokenHash(refreshToken);
      const session = store.refreshSessions[currentHash];
      const user = session ? store.users[session.userId] : null;
      if (!session || !user) {
        delete store.refreshSessions[currentHash];
        throw localAuthError("本机会话已失效，请重新登录。", { status: 401, code: "AUTH_SESSION_INVALID" });
      }
      delete store.refreshSessions[currentHash];
      return issueSession(store, user, now);
    });
  }

  async function logout(refreshToken) {
    if (!enabled || !isLocalRefreshToken(refreshToken)) return;
    let loggedOutUserId = "";
    await mutateStore((store) => {
      const refreshHash = tokenHash(refreshToken);
      loggedOutUserId = String(store.refreshSessions[refreshHash]?.userId || "");
      delete store.refreshSessions[refreshHash];
    });
    if (loggedOutUserId) {
      accessSessions.forEach((session, hash) => {
        if (session.userId === loggedOutUserId) accessSessions.delete(hash);
      });
    }
  }

  async function currentUser(accessToken) {
    assertEnabled();
    if (!isLocalAccessToken(accessToken)) {
      throw localAuthError("请先登录。", { status: 401, code: "AUTH_REQUIRED" });
    }
    const accessHash = tokenHash(accessToken);
    const session = accessSessions.get(accessHash);
    if (!session || session.expiresAt <= Date.now()) {
      accessSessions.delete(accessHash);
      throw localAuthError("登录状态已过期，请重新连接。", { status: 401, code: "AUTH_SESSION_EXPIRED" });
    }
    return stableRead((store) => {
      const user = store.users[session.userId];
      if (!user) throw localAuthError("本机账号不存在。", { status: 401, code: "AUTH_SESSION_INVALID" });
      return { accessToken, provider: "local", user: publicUser(user) };
    });
  }

  async function readAppState(userId) {
    assertEnabled();
    return stableRead((store) => {
      const user = store.users[userId];
      if (!user) throw localAuthError("本机账号不存在。", { status: 404, code: "LOCAL_USER_NOT_FOUND" });
      if (!user.state && !user.meals) return { ...defaultData, revision: 0 };
      return {
        ...normalizeAppData({ state: user.state, meals: user.meals, updatedAt: user.updatedAt }),
        revision: stateRevision(user.state),
      };
    });
  }

  // The revision check and write share mutateStore's per-file queue, making
  // first-write and update CAS atomic within this process.
  async function writeAppState(payload, userId) {
    assertEnabled();
    const safePayload = isRecord(payload) ? payload : {};
    const revisionInput = stateWriteRevision(safePayload);
    if (!revisionInput.ok && !revisionInput.missing) {
      throw localAuthError("状态版本号必须是非负整数。", {
        status: 400,
        code: "STATE_REVISION_INVALID",
        retryable: false,
      });
    }
    return mutateStore((store) => {
      const user = store.users[userId];
      if (!user) throw localAuthError("本机账号不存在。", { status: 404, code: "LOCAL_USER_NOT_FOUND" });
      const currentRevision = stateRevision(user.state);
      const currentPayload =
        !user.state && !user.meals
          ? { ...defaultData, revision: 0 }
          : {
              ...normalizeAppData({ state: user.state, meals: user.meals, updatedAt: user.updatedAt }),
              revision: currentRevision,
            };
      if (revisionInput.missing) {
        const conflict = localAuthError("状态版本号缺失，请先合并当前记录。", {
          status: 409,
          code: "STATE_REVISION_REQUIRED",
          retryable: true,
        });
        conflict.conflict = currentPayload;
        throw conflict;
      }
      if (revisionInput.revision !== currentRevision) {
        const conflict = localAuthError("本机记录已在别处更新，正在自动合并", {
          status: 409,
          code: "STATE_CONFLICT",
          retryable: true,
        });
        conflict.conflict = currentPayload;
        throw conflict;
      }
      const nextRevision = currentRevision + 1;
      const updatedAt = new Date().toISOString();
      user.state = storedStateForWrite(safePayload.state, nextRevision, updatedAt);
      user.meals = sanitizeMeals(safePayload.meals);
      user.updatedAt = updatedAt;
      return {
        ...normalizeAppData({ state: user.state, meals: user.meals, updatedAt: user.updatedAt }),
        revision: nextRevision,
      };
    });
  }

  async function deleteAppState(userId) {
    assertEnabled();
    return mutateStore((store) => {
      const user = store.users[userId];
      if (!user) throw localAuthError("本机账号不存在。", { status: 404, code: "LOCAL_USER_NOT_FOUND" });
      user.state = null;
      user.meals = null;
      user.updatedAt = new Date().toISOString();
      return { ...defaultData };
    });
  }

  async function deleteAccount(userId) {
    assertEnabled();
    await mutateStore((store) => {
      if (!store.users[userId]) {
        throw localAuthError("本机账号不存在。", { status: 404, code: "LOCAL_USER_NOT_FOUND" });
      }
      delete store.users[userId];
      Object.entries(store.refreshSessions).forEach(([hash, session]) => {
        if (session?.userId === userId) delete store.refreshSessions[hash];
      });
    });
    accessSessions.forEach((session, hash) => {
      if (session.userId === userId) accessSessions.delete(hash);
    });
    return { ok: true };
  }

  return {
    enabled,
    signup,
    login,
    refresh,
    logout,
    currentUser,
    readAppState,
    writeAppState,
    deleteAppState,
    deleteAccount,
  };
}

export function isLocalAccessToken(token) {
  return String(token || "").startsWith("local_access_");
}

export function isLocalRefreshToken(token) {
  return String(token || "").startsWith("local_refresh_");
}

export const localAuthService = createLocalAuthService();
