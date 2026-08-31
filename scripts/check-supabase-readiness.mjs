import { probeSupabaseAuth } from "../server/supabase.mjs";

const auth = await probeSupabaseAuth({ force: true });
const report = {
  ready: auth.ready,
  signupAllowed: auth.signupAllowed,
  configured: auth.configured,
  reachable: auth.reachable,
  code: auth.code,
  message: auth.message,
  checkedAt: auth.checkedAt,
};

console.log(JSON.stringify(report, null, 2));
if (!auth.ready || !auth.signupAllowed) process.exitCode = 1;
