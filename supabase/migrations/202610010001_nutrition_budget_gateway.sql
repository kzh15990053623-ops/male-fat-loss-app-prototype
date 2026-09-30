-- Store only the SHA-256 hash of Render's random 256-bit budget credential.
-- Only Supabase's service-role function can read it. No client policies exist.
create table if not exists public.nutrition_budget_gateway_credentials (
  singleton boolean primary key default true check (singleton),
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$')
);
alter table public.nutrition_budget_gateway_credentials enable row level security;
alter table public.nutrition_budget_gateway_credentials force row level security;
revoke all on public.nutrition_budget_gateway_credentials from public, anon, authenticated;
grant select on public.nutrition_budget_gateway_credentials to service_role;
