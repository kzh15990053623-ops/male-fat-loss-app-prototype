import { describe, expect, it } from "vitest";
import { isFetchForbiddenPort, startFetchSafeHttpServer } from "../../scripts/test-http-server.mjs";

describe("Fetch-safe local HTTP test server", () => {
  it("recognizes Fetch-forbidden ports without rejecting normal local ports", () => {
    expect(isFetchForbiddenPort(6000)).toBe(true);
    expect(isFetchForbiddenPort("6667")).toBe(true);
    expect(isFetchForbiddenPort(4173)).toBe(false);
  });

  it("closes a forbidden allocation and deterministically retries the injected next port", async () => {
    const servers = [
      { id: "blocked", listening: true },
      { id: "safe", listening: true },
    ];
    const ports = [6000, 4173];
    const closed = [];

    const result = await startFetchSafeHttpServer(() => servers.shift(), {
      bind: async () => ports.shift(),
      close: async (server) => {
        server.listening = false;
        closed.push(server.id);
      },
    });

    expect(result).toMatchObject({ server: { id: "safe" }, port: 4173, origin: "http://127.0.0.1:4173" });
    expect(closed).toEqual(["blocked"]);
  });
});
