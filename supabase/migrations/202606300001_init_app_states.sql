-- Minimal multi-user storage for the fitness app.
-- Each authenticated user owns exactly one app state row.

create table if not exists public.app_states (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb,
  meals jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists app_states_updated_at_idx
  on public.app_states (updated_at desc);

alter table public.app_states enable row level security;
alter table public.app_states force row level security;

drop policy if exists app_states_select_own on public.app_states;
create policy app_states_select_own
  on public.app_states
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists app_states_insert_own on public.app_states;
create policy app_states_insert_own
  on public.app_states
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists app_states_update_own on public.app_states;
create policy app_states_update_own
  on public.app_states
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists app_states_delete_own on public.app_states;
create policy app_states_delete_own
  on public.app_states
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);
