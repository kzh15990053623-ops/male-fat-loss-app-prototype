import { createAccountDeletionGateway } from "../../../server/account-deletion-gateway.mjs";
function serverKey() {
  try { return JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}").default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""; }
  catch { return ""; }
}
Deno.serve(createAccountDeletionGateway({url:Deno.env.get("SUPABASE_URL") || "",apiKey:serverKey()}));
