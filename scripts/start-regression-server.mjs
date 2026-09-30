import { once } from "node:events";
import { startServer } from "../server.mjs";
import { registerGracefulShutdown } from "../server/shutdown.mjs";
import { startFetchSafeHttpServer } from "./test-http-server.mjs";

const started = await startFetchSafeHttpServer(() => startServer(0), {
  bind: async (server) => {
    if (!server.address()) await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Regression server did not expose a TCP port");
    return address.port;
  },
});

registerGracefulShutdown({ server: started.server });
console.log(`REGRESSION_SERVER_READY ${started.origin}`);
