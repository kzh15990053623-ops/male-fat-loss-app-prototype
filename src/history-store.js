// Permanent, account-scoped IndexedDB archive. Each day can be read separately.
import { normalizeMealList } from "./app-data.js";
import { state, runtime } from "./app-state.js";
import { apiFetch, nativeRuntime } from "./native-runtime.js";
let queue = Promise.resolve();
let database;
function openArchive() {
  if (!globalThis.indexedDB) return Promise.resolve(null);
  database ||= new Promise((resolve, reject) => {
    const request = indexedDB.open("wenjian-history-v1", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("days", { keyPath: "key" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      database = null;
      reject(request.error);
    };
  });
  return database;
}
async function transaction(mode, fn) {
  const db = await openArchive();
  if (!db) return null;
  return new Promise((resolve, reject) => {
    const tx = db.transaction("days", mode);
    let result;
    fn(tx.objectStore("days"), (value) => {
      result = value;
    });
    tx.oncomplete = () => resolve(result);
    tx.onerror = tx.onabort = () => reject(tx.error || new Error("历史归档未保存"));
  });
}
function enqueue(fn) {
  const pending = queue.then(fn);
  queue = pending.catch(() => {});
  return pending;
}
const recoveryKey = (userId) => "wenjian-history-recovery:" + userId;
function recoveryRows(userId) {
  try {
    return JSON.parse(localStorage.getItem(recoveryKey(userId)) || "{}");
  } catch {
    return {};
  }
}
const keyFor = (userId, date) => `${userId}:${date}`;
export async function readLocalHistory(userId = runtime.authUserId, { before = "\uffff", limit = Infinity } = {}) {
  await queue;
  const archived =
    (await transaction("readonly", (store, done) => {
      const rows = [];
      const request = store.openCursor(IDBKeyRange.bound(`${userId}:`, `${userId}:${before}`, false, true), "prev");
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor && rows.length < limit) {
          rows.push(cursor.value);
          cursor.continue();
        } else done(rows);
      };
    }).catch(() => [])) || [];
  const combined = new Map(archived.map((row) => [row.date, row]));
  for (const row of Object.values(recoveryRows(userId))) {
    const existing = combined.get(row.date);
    combined.set(
      row.date,
      existing?.pending && sameRecord(existing.record, row.record)
        ? { ...existing, ...row, base: existing.base, revision: existing.revision }
        : row,
    );
  }
  return [...combined.values()]
    .filter((row) => row.date < before)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit);
}
export function archiveSnapshot(payload, userId = runtime.authUserId) {
  if (nativeRuntime() || !userId) return Promise.resolve();
  const records = structuredClone(payload?.state?.dailyRecords || {});
  for (const field of ["weight", "waist"])
    for (const item of payload?.state?.[`${field}Logs`] || []) {
      if (!records[item.date]) records[item.date] = { date: item.date, intakeStatus: "unknown" };
      records[item.date][field] = item.value;
    }
  if (!Object.keys(records).length) return Promise.resolve();
  const recovery = {
    ...recoveryRows(userId),
    ...Object.fromEntries(
      Object.entries(records).map(([date, record]) => [
        date,
        recoveryRows(userId)[date]?.pending ? recoveryRows(userId)[date] : { key: keyFor(userId, date), date, record },
      ]),
    ),
  };
  let savedFallback = false;
  try {
    localStorage.setItem(recoveryKey(userId), JSON.stringify(recovery));
    savedFallback = true;
  } catch {
    /* IndexedDB may still be available. */
  }
  if (!globalThis.indexedDB) return savedFallback ? Promise.resolve() : Promise.reject(new Error("历史归档未保存"));
  return enqueue(async () => {
    try {
      await transaction("readwrite", (store) => {
        for (const [date, row] of Object.entries(recovery)) {
          const key = keyFor(userId, date);
          const request = store.get(key);
          request.onsuccess = () => {
            if (row.pending || !request.result?.pending)
              store.put({
                ...request.result,
                ...row,
                key,
                date,
                base: request.result?.base || row.base,
                revision: request.result?.revision || row.revision,
              });
          };
        }
      });
      if (JSON.stringify(recoveryRows(userId)) === JSON.stringify(recovery)) localStorage.removeItem(recoveryKey(userId));
    } catch (error) {
      if (!savedFallback) throw error;
    }
  });
}
export function saveHistoryEdit(date, record, userId = runtime.authUserId) {
  if (nativeRuntime()) return Promise.resolve();
  const copy = structuredClone(record);
  const recovery = recoveryRows(userId);
  const previous = recovery[date];
  recovery[date] = {
    ...previous,
    key: keyFor(userId, date),
    date,
    record: copy,
    base: previous?.base || previous?.record || null,
    pending: true,
    revision: previous?.revision || 0,
  };
  let savedFallback = false;
  try {
    localStorage.setItem(recoveryKey(userId), JSON.stringify(recovery));
    savedFallback = true;
  } catch {
    /* Try IndexedDB. */
  }
  if (!globalThis.indexedDB && !savedFallback) return Promise.reject(new Error("历史修改未保存，请导出当前记录并检查浏览器存储"));
  return enqueue(() =>
    transaction("readwrite", (store) => {
      const key = keyFor(userId, date);
      const get = store.get(key);
      get.onsuccess = () =>
        store.put({
          ...get.result,
          key,
          date,
          record: copy,
          base: get.result?.base || get.result?.record || null,
          pending: true,
          revision: get.result?.revision || 0,
        });
    }),
  ).catch((error) => {
    if (!savedFallback) throw error;
  });
}
async function persistHistoryRow(userId, row) {
  let savedFallback = false;
  try {
    const recovery = recoveryRows(userId);
    recovery[row.date] = row;
    localStorage.setItem(recoveryKey(userId), JSON.stringify(recovery));
    savedFallback = true;
  } catch {
    /* The main archive may still be available. */
  }
  if (!globalThis.indexedDB && !savedFallback) throw new Error("历史修改未保存，请检查浏览器存储");
  try {
    await enqueue(() => transaction("readwrite", (store) => store.put(row)));
  } catch (error) {
    if (!savedFallback) throw error;
  }
}
export function clearHistory(userId = runtime.authUserId) {
  if (userId === runtime.authUserId) {
    runtime.historyRows = [];
    runtime.historyConflicts = [];
    runtime.historyBefore = "";
    runtime.historyPage = 0;
  }
  try {
    localStorage.removeItem(recoveryKey(userId));
  } catch {
    /* Clear continues in IndexedDB. */
  }
  if (!globalThis.indexedDB) return Promise.resolve();
  return enqueue(() =>
    transaction("readwrite", (store) => {
      const cursor = store.openKeyCursor(IDBKeyRange.bound(`${userId}:`, `${userId}:\uffff`));
      cursor.onsuccess = () => {
        if (cursor.result) {
          store.delete(cursor.result.key);
          cursor.result.continue();
        }
      };
    }),
  );
}
async function cacheRemote(rows, userId) {
  if (!globalThis.indexedDB) {
    const cached = recoveryRows(userId);
    for (const row of rows) if (!cached[row.date]?.pending) cached[row.date] = { ...row, key: keyFor(userId, row.date), pending: false };
    localStorage.setItem(recoveryKey(userId), JSON.stringify(cached));
    return;
  }
  return enqueue(() =>
    transaction("readwrite", (store) => {
      for (const row of rows) {
        const key = keyFor(userId, row.date);
        const get = store.get(key);
        get.onsuccess = () => {
          if (!get.result?.pending) store.put({ ...row, key, pending: false });
        };
      }
    }),
  );
}
function headers() {
  return { "Content-Type": "application/json", Authorization: `Bearer ${runtime.accessToken}` };
}
export async function loadHistoryPage({ all = false } = {}) {
  const userId = runtime.authUserId;
  const generation = runtime.authSessionGeneration;
  const guard = () => userId === runtime.authUserId && generation === runtime.authSessionGeneration;
  const requestHeaders = headers();
  let before = all ? "" : runtime.historyBefore || "";
  const localBefore = before || "\uffff";
  if (runtime.accessToken && navigator.onLine !== false && !nativeRuntime()) {
    do {
      const response = await apiFetch(`/api/history?limit=30${before ? `&before=${before}` : ""}`, { headers: requestHeaders });
      if (!response.ok) throw new Error("历史云端读取失败，本机记录保留");
      const data = await response.json();
      if (!guard()) return [];
      await cacheRemote(data.rows, userId);
      if (!guard()) return [];
      before = data.next;
    } while (all && before);
    if (guard() && !all) runtime.historyBefore = before || "";
  }
  const local = await readLocalHistory(userId, { before: localBefore, limit: all ? Infinity : 30 });
  if (!guard()) return [];
  for (const row of local) {
    if (row.record && row.date !== state.currentDate && state.dailyRecords[row.date] && (!state.syncPending || row.pending))
      state.dailyRecords[row.date] = row.record;
  }
  runtime.historyRows = all ? local : [...new Map([...(runtime.historyRows || []), ...local].map((row) => [row.date, row])).values()];
  runtime.historyConflicts = local.filter((row) => row.conflict);
  return local;
}
function sameRecord(left, right) {
  const canonical = (value) =>
    Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, canonical(value[key])]),
          )
        : value;
  const normalized = (value) =>
    value
      ? {
          ...value,
          customActivities: value.customActivities || [],
          taskOverrides: value.taskOverrides || {},
          workoutDone: Boolean(value.workoutDone),
          ...(Array.isArray(value.meals) ? { meals: normalizeMealList(value.meals) } : {}),
        }
      : value;
  return JSON.stringify(canonical(normalized(left))) === JSON.stringify(canonical(normalized(right)));
}
export async function flushHistoryEdits() {
  const userId = runtime.authUserId;
  const generation = runtime.authSessionGeneration;
  let written = 0;
  const requestHeaders = headers();
  const guard = () => {
    if (userId !== runtime.authUserId || generation !== runtime.authSessionGeneration)
      throw Object.assign(new Error("账号已切换"), { kind: "stale-session" });
  };
  for (const row of await readLocalHistory(userId)) {
    guard();
    if (!row.pending) continue;
    if (!row.revision) {
      const lookup = await apiFetch(`/api/history?date=${row.date}`, { headers: requestHeaders });
      if (!lookup.ok) throw new Error("历史基线暂不可读，已保留修改");
      const remote = (await lookup.json()).rows[0];
      guard();
      if (remote && (sameRecord(remote.record, row.record) || sameRecord(remote.record, row.base))) row.revision = remote.revision;
    }
    const response = await apiFetch("/api/history", {
      method: "PUT",
      headers: requestHeaders,
      body: JSON.stringify({ date: row.date, record: row.record, revision: row.revision || 0 }),
    });
    const data = await response.json();
    if (userId !== runtime.authUserId || generation !== runtime.authSessionGeneration)
      throw Object.assign(new Error("账号已切换"), { kind: "stale-session" });
    if (response.status === 409) {
      await persistHistoryRow(userId, { ...row, conflict: data.conflict });
      runtime.historyConflicts = (await readLocalHistory()).filter((item) => item.conflict);
      throw new Error("历史记录发生冲突，双方内容已保留，请在历史页处理");
    }
    if (!response.ok) throw new Error("历史修改暂未同步，已保留在本机");
    written++;
    const fallback = recoveryRows(userId);
    if (JSON.stringify(fallback[row.date]?.record) === JSON.stringify(row.record)) {
      fallback[row.date] = { ...data, key: row.key, pending: false };
      try {
        localStorage.setItem(recoveryKey(userId), JSON.stringify(fallback));
      } catch {
        /* Main archive retry still retains the day. */
      }
    }
    if (!globalThis.indexedDB) continue;
    await enqueue(() =>
      transaction("readwrite", (store) => {
        const get = store.get(row.key);
        get.onsuccess = () => {
          if (JSON.stringify(get.result?.record) === JSON.stringify(row.record)) store.put({ ...data, key: row.key, pending: false });
          else store.put({ ...get.result, revision: data.revision });
        };
      }),
    );
  }
  return written;
}
export async function resolveHistoryConflict(date, choice) {
  const userId = runtime.authUserId;
  const generation = runtime.authSessionGeneration;
  const row = (await readLocalHistory(userId)).find((item) => item.date === date && item.conflict);
  if (!row || userId !== runtime.authUserId || generation !== runtime.authSessionGeneration) return;
  const record = choice === "remote" ? row.conflict.record : row.record;
  await persistHistoryRow(userId, {
    key: row.key,
    date,
    record,
    base: row.conflict.record,
    revision: row.conflict.revision,
    pending: choice !== "remote",
  });
  if (userId !== runtime.authUserId || generation !== runtime.authSessionGeneration) return;
  if (record) state.dailyRecords[date] = record;
  await loadHistoryPage();
}
