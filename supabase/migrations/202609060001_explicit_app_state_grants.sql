-- Table privileges and row policies are separate checks. Do not depend on
-- a Supabase project's default grants when creating or upgrading this table.
begin;

-- Signed-out clients have no table access. Signed-in users receive only
-- row operations; the existing forced RLS policies still enforce ownership.
revoke all privileges on table public.app_states from public, anon, authenticated;
grant select, insert, update, delete on table public.app_states to authenticated;

-- Server-only inspection (including verification of account-delete cleanup)
-- needs SELECT even though service_role bypasses row-level policies.
grant select on table public.app_states to service_role;

commit;
