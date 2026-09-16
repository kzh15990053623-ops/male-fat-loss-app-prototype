import { once } from "node:events";

// WHATWG Fetch blocks these ports before a request reaches the local server.
// Windows can allocate from a low dynamic range, so server.listen(0) can
// occasionally choose one of them and make otherwise-correct tests flaky.
const FETCH_FORBIDDEN_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117,
  119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636,
  989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697, 10080,
]);

export function isFetchForbiddenPort(value) {
  const port = Number(value);
  return Number.isInteger(port) && FETCH_FORBIDDEN_PORTS.has(port);
}

export async function bindEphemeralHttpServer(server, { host = "127.0.0.1" } = {}) {
  server.listen(0, host);
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string" || !Number.isInteger(address.port)) {
    throw new Error("Local test server did not expose a TCP port");
  }
  return address.port;
}

export async function closeHttpServer(server) {
  if (!server?.listening) return;
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

export async function startFetchSafeHttpServer(
  createServer,
  { host = "127.0.0.1", maxAttempts = 20, bind = bindEphemeralHttpServer, close = closeHttpServer } = {},
) {
  if (typeof createServer !== "function") throw new TypeError("createServer must be a function");

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const server = await createServer();
    let port;
    try {
      port = Number(await bind(server, { host, attempt }));
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`Local test server returned an invalid port: ${port}`);
      }
      if (isFetchForbiddenPort(port)) {
        await close(server);
        continue;
      }
      return { server, port, origin: `http://${host}:${port}` };
    } catch (error) {
      await close(server).catch(() => {});
      throw error;
    }
  }

  throw new Error(`Unable to allocate a Fetch-safe local HTTP port after ${maxAttempts} attempts`);
}
