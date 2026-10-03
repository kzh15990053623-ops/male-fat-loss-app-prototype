import { it, expect, vi } from "vitest";
import { createAccountDeletionGateway } from "../../server/account-deletion-gateway.mjs";
const id = "c09e48d0-792e-4bc3-8b24-d1702b39676d";
it("deletes only the JWT identity, ignores attacker ids, and keeps the admin key inside the function", async () => {
  const fetchImpl = vi.fn().mockResolvedValueOnce(Response.json({ id })).mockResolvedValueOnce(Response.json({}));
  const handler = createAccountDeletionGateway({ url: "https://db.test", apiKey: "sb_secret_internal", fetchImpl });
  const response = await handler(
    new Request("https://function.test/?userId=someone-else", { method: "DELETE", headers: { Authorization: "Bearer user-jwt" } }),
  );
  expect(await response.json()).toEqual({ ok: true });
  expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe("Bearer user-jwt");
  expect(fetchImpl.mock.calls[1][0]).toBe("https://db.test/auth/v1/admin/users/" + id);
  expect(fetchImpl.mock.calls[1][1].headers.Authorization).toBeUndefined();
});
it("does not delete when identity validation fails or the method is wrong", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(Response.json({}, { status: 401 }));
  const handler = createAccountDeletionGateway({ url: "https://db.test", apiKey: "internal", fetchImpl });
  expect(
    (await handler(new Request("https://function.test/", { method: "DELETE", headers: { Authorization: "Bearer expired" } }))).status,
  ).toBe(401);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect((await handler(new Request("https://function.test/"))).status).toBe(405);
});
