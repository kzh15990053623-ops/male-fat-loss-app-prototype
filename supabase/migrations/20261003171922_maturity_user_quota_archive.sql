-- Reservations serialize against the same project lock as the original ledger.
alter table public.nutrition_ai_usage add column if not exists user_id uuid;
create index if not exists nutrition_ai_usage_user_month_idx on public.nutrition_ai_usage(user_id, month, created_at);
create or replace function public.nutrition_budget_for_user(
  p_action text, p_request_id uuid default null, p_limit bigint default 100000000,
  p_usage jsonb default null, p_user_id uuid default null,
  p_monthly_limit integer default 20, p_daily_limit integer default 5
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_result jsonb;
  v_month text := to_char(timezone('Asia/Shanghai', now()), 'YYYY-MM');
  v_day date := timezone('Asia/Shanghai', now())::date;
  v_month_count integer;
  v_day_count integer;
  v_quota boolean;
begin
  if p_user_id is null or p_action not in ('status','reserve') or p_monthly_limit not between 1 and 20 or p_daily_limit not between 1 and 5 then
    raise exception 'invalid personal budget operation';
  end if;
  perform pg_advisory_xact_lock(21092026, 100);
  select count(*), count(*) filter (where timezone('Asia/Shanghai', created_at)::date = v_day)
    into v_month_count, v_day_count from public.nutrition_ai_usage where user_id = p_user_id and month = v_month;
  v_quota := v_month_count >= p_monthly_limit or v_day_count >= p_daily_limit;
  v_result := public.nutrition_budget(case when p_action = 'reserve' and not v_quota then 'reserve' else 'status' end, p_request_id, p_limit, p_usage);
  if p_action = 'reserve' and not v_quota and (v_result->>'allowed')::boolean then
    update public.nutrition_ai_usage set user_id = p_user_id where request_id = p_request_id;
    v_month_count := v_month_count + 1; v_day_count := v_day_count + 1;
  end if;
  return v_result || jsonb_build_object(
    'allowed', (v_result->>'allowed')::boolean and (p_action <> 'reserve' or not v_quota),
    'quotaExceeded', v_quota, 'userRequests', v_month_count,
    'userMonthlyLimit', p_monthly_limit, 'userDailyLimit', p_daily_limit,
    'userRemainingRequests', greatest(0, least((v_result->>'remainingRequests')::integer, p_monthly_limit-v_month_count, p_daily_limit-v_day_count)));
end; $$;
revoke all on function public.nutrition_budget_for_user(text,uuid,bigint,jsonb,uuid,integer,integer) from public, anon, authenticated;
grant execute on function public.nutrition_budget_for_user(text,uuid,bigint,jsonb,uuid,integer,integer) to service_role;

-- Permanent archive, separate from the recent working snapshot. Never expires.
create table public.app_daily_records (
  user_id uuid not null references public.app_states(user_id) on delete cascade,
  date date not null, record jsonb not null check (jsonb_typeof(record) = 'object'),
  revision bigint not null default 1, updated_at timestamptz not null default now(),
  primary key (user_id, date)
);
alter table public.app_daily_records enable row level security;
alter table public.app_daily_records force row level security;
revoke all on public.app_daily_records from public, anon, authenticated;
grant select, insert, update, delete on public.app_daily_records to authenticated;
create policy history_own on public.app_daily_records for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create function public.archive_app_days() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.state ? 'clearedAt' then
    delete from public.app_daily_records where user_id = new.user_id;
    return new;
  end if;
  insert into public.app_daily_records(user_id,date,record)
    select new.user_id, key::date, value from jsonb_each(coalesce(new.state->'dailyRecords', '{}'::jsonb))
    where key ~ '^\d{4}-\d{2}-\d{2}$' and jsonb_typeof(value) = 'object'
      and (tg_op = 'INSERT' or value is distinct from old.state->'dailyRecords'->key)
  on conflict (user_id,date) do update set record=excluded.record, revision=app_daily_records.revision+1, updated_at=now()
    where app_daily_records.record is distinct from excluded.record;
  return new;
end; $$;
create trigger app_days_archive after insert or update on public.app_states for each row execute function public.archive_app_days();
insert into public.app_daily_records(user_id,date,record)
  select s.user_id, d.key::date, d.value from public.app_states s cross join lateral jsonb_each(coalesce(s.state->'dailyRecords','{}'::jsonb)) d
  where d.key ~ '^\d{4}-\d{2}-\d{2}$' and jsonb_typeof(d.value)='object' and not (s.state ? 'clearedAt')
on conflict do nothing;
-- Include retained measurement dates even when there is no retained day record.
insert into public.app_daily_records(user_id,date,record)
  select s.user_id, (m.value->>'date')::date, jsonb_build_object('date',m.value->>'date', 'weight',(m.value->>'value')::numeric)
  from public.app_states s cross join lateral jsonb_array_elements(coalesce(s.state->'weightLogs','[]'::jsonb)) m
  where m.value->>'date' ~ '^\d{4}-\d{2}-\d{2}$' and not (s.state ? 'clearedAt')
on conflict (user_id,date) do update set record=app_daily_records.record || excluded.record;

insert into public.app_daily_records(user_id,date,record)
  select s.user_id, (m.value->>'date')::date, jsonb_build_object('date',m.value->>'date', 'waist',(m.value->>'value')::numeric)
  from public.app_states s cross join lateral jsonb_array_elements(coalesce(s.state->'waistLogs','[]'::jsonb)) m
  where m.value->>'date' ~ '^\d{4}-\d{2}-\d{2}$' and not (s.state ? 'clearedAt')
on conflict (user_id,date) do update set record=app_daily_records.record || excluded.record;

revoke all on function public.archive_app_days() from public, anon, authenticated;

-- Historical edits share the main row lock/version, so a stale main snapshot
-- cannot silently overwrite a separately edited day. RLS remains in force.
create function public.write_app_day(p_date date, p_record jsonb, p_revision bigint)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare main public.app_states; day public.app_daily_records; next_state jsonb; field text; logs jsonb;
begin
  select * into main from public.app_states where user_id = auth.uid() for update;
  if not found then raise exception 'Account state required'; end if;
  select * into day from public.app_daily_records where user_id = auth.uid() and date = p_date for update;
  if coalesce(day.revision,0) <> p_revision then
    return jsonb_build_object('conflict',coalesce(to_jsonb(day),jsonb_build_object('date',p_date,'record',null,'revision',0)));
  end if;
  if jsonb_typeof(p_record) <> 'object' or p_record->>'date' <> p_date::text then raise exception 'Invalid day'; end if;
  insert into public.app_daily_records(user_id,date,record,revision) values(auth.uid(),p_date,p_record,p_revision+1)
    on conflict(user_id,date) do update set record=excluded.record, revision=excluded.revision, updated_at=now()
    returning * into day;
  next_state := main.state;
  if next_state->'dailyRecords' ? p_date::text then
    next_state := jsonb_set(next_state,array['dailyRecords',p_date::text],p_record);
  end if;
  foreach field in array array['weight','waist'] loop
    if jsonb_typeof(p_record->field) = 'number' then
      select coalesce(jsonb_agg(item),'[]'::jsonb) into logs from jsonb_array_elements(coalesce(next_state->(field||'Logs'),'[]'::jsonb)) item where item->>'date' <> p_date::text;
      next_state := jsonb_set(next_state,array[field||'Logs'],logs || jsonb_build_array(jsonb_build_object('date',p_date,'value',p_record->field)));
    end if;
  end loop;
  next_state := jsonb_set(next_state,'{syncRevision}',to_jsonb(coalesce((main.state->>'syncRevision')::bigint,0)+1));
  update public.app_states set state=next_state, updated_at=now() where user_id=auth.uid();
  return to_jsonb(day);
end; $$;
revoke all on function public.write_app_day(date,jsonb,bigint) from public,anon;
grant execute on function public.write_app_day(date,jsonb,bigint) to authenticated;
