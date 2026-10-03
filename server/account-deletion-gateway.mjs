import { supabaseApiHeaders } from "./supabase-headers.mjs";

export function createAccountDeletionGateway({ url, apiKey, fetchImpl = fetch }) {
  return async (request) => {
    const json = (code, status) => Response.json({ code }, { status, headers: { "Cache-Control": "no-store" } });
    if (request.method !== "DELETE") return json("METHOD_NOT_ALLOWED", 405);
    const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
    if (!token || !url || !apiKey) return json("UNAUTHORIZED", 401);
    try {
      // Derive identity from the validated user JWT; never accept a caller's id.
      const identity = await fetchImpl(`${url}/auth/v1/user`, {
        headers: supabaseApiHeaders(apiKey, token),
        signal: AbortSignal.timeout(5000),
      });
      if (!identity.ok) return json("UNAUTHORIZED", 401);
      const user = await identity.json();
      if (!/^[0-9a-f-]{36}$/i.test(user.id || "")) return json("UNAUTHORIZED", 401);
      const deleted = await fetchImpl(`${url}/auth/v1/admin/users/${user.id}`, {
        method: "DELETE",
        headers: supabaseApiHeaders(apiKey),
        signal: AbortSignal.timeout(10000),
      });
      if (!deleted.ok) return json("ACCOUNT_DELETION_FAILED", 503);
      return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    } catch {
      return json("ACCOUNT_DELETION_FAILED", 503);
    }
  };
}
