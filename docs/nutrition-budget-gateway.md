# Hosted AI budget gateway

Hosted DeepSeek requests reserve 0.10 CNY before dispatch in the existing durable
Supabase ledger. The monthly ceiling remains 100 CNY, with no refunds for failed
requests. The personal Supabase user UUID is still required.

When Render cannot receive a Supabase admin key, `nutrition-budget-gateway`
provides only the existing `status`, `reserve`, and `report` operations. Its
platform-injected admin key stays inside Supabase. Account deletion still needs
a separately configured server admin key.

The gateway authenticates a random 32-byte hexadecimal token from the server's
`X-Budget-Token` header by comparing its SHA-256 hash with the singleton row in
`nutrition_budget_gateway_credentials`. Browser roles cannot read or update this
table or invoke the budget RPC. Requests are limited to 4096 bytes and four
explicit RPC arguments; errors never expose upstream responses or credentials.

Deployment:

1. Apply the existing app-state grants and nutrition-budget migrations, followed
   by `202610010001_nutrition_budget_gateway.sql`.
2. Generate a random 32-byte hex token. Insert only its SHA-256 hash in the
   protected credentials table, using an administrative database connection.
3. Deploy `supabase/functions/nutrition-budget-gateway/index.ts` together with
   its relative dependency `server/nutrition-budget-gateway.mjs`. Its own token
   authentication requires `verify_jwt = false`; a publishable key alone grants
   no access. Supabase injects the admin API key through its function environment.
4. Set `NUTRITION_AI_BUDGET_GATEWAY_TOKEN` only on the backend. The endpoint is
   derived from `SUPABASE_URL`; clients cannot choose it. Keep the token out of
   source control and client assets. Set `NUTRITION_AI_ALLOWED_USER_ID` to the
   intended personal account's Auth UUID.
5. Verify missing/wrong credentials return 401 and the correct token returns a
   budget summary. Validate authenticated recognition separately. A budget
   status check does not dispatch a paid AI request.

The gateway is preferred when its token is configured. Without that token,
existing installations continue using the direct service-role RPC. Both paths
fail closed on storage/authentication errors and never use an ephemeral hosted
ledger.

Current Supabase references: [function environment variables](https://supabase.com/docs/guides/functions/secrets)
and [API-key migration](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys).
