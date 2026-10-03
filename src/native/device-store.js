import { CapacitorSQLite, SQLiteConnection } from "@capacitor-community/sqlite";

const sqlite = new SQLiteConnection(CapacitorSQLite);
let database;
let pendingWrite = Promise.resolve();
let lastPayload = null;

export async function openDeviceStore() {
  // WebView 重载会清空 JS 连接表，但原生插件可能仍持有连接；先让两端恢复一致。
  await sqlite.checkConnectionsConsistency();
  database = (await sqlite.isConnection("wenjian", false)).result
    ? await sqlite.retrieveConnection("wenjian", false)
    : await sqlite.createConnection("wenjian", false, "no-encryption", 1, false);
  if (!(await database.isDBOpen()).result) await database.open();
  await database.execute(
    "CREATE TABLE IF NOT EXISTS app_snapshot (id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL, updated_at TEXT NOT NULL);",
  );
  await database.execute("CREATE TABLE IF NOT EXISTS device_metadata (key TEXT PRIMARY KEY, payload TEXT NOT NULL);");
  const result = await database.query("SELECT payload FROM app_snapshot WHERE id = 1;");
  const raw = result.values?.[0]?.payload;
  lastPayload = raw ? JSON.parse(raw) : null;
  return lastPayload;
}

export function latestDevicePayload() {
  return lastPayload;
}

export function saveDevicePayload(payload, { clearRecovery = false } = {}) {
  if (!database) return Promise.reject(new Error("手机数据库尚未就绪"));
  const serialized = JSON.stringify(payload);
  pendingWrite = pendingWrite
    .catch(() => {})
    .then(async () => {
      const statement =
        "INSERT INTO app_snapshot (id, payload, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at;";
      const values = [serialized, new Date().toISOString()];
      if (clearRecovery)
        await database.executeSet(
          [
            { statement, values },
            { statement: "DELETE FROM device_metadata WHERE key = ?;", values: ["cloud-recovery"] },
          ],
          true,
        );
      else await database.run(statement, values);
      lastPayload = payload;
    });
  return pendingWrite;
}

export function flushDeviceStore() {
  return pendingWrite;
}

export async function readCloudConfig() {
  const result = await database.query("SELECT payload FROM device_metadata WHERE key = ?;", ["cloud"]);
  return result.values?.[0]?.payload ? JSON.parse(result.values[0].payload) : null;
}

export async function writeCloudConfig(config) {
  await database.run("INSERT OR REPLACE INTO device_metadata(key, payload) VALUES (?, ?);", ["cloud", JSON.stringify(config)]);
}

export async function saveCloudRecovery(payload) {
  await database.run("INSERT OR REPLACE INTO device_metadata(key, payload) VALUES (?, ?);", ["cloud-recovery", JSON.stringify(payload)]);
}

export async function readCloudRecovery() {
  const result = await database.query("SELECT payload FROM device_metadata WHERE key = ?;", ["cloud-recovery"]);
  return result.values?.[0]?.payload ? JSON.parse(result.values[0].payload) : null;
}
