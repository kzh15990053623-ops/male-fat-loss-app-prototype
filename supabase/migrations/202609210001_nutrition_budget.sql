-- A service-wide, durable budget, inaccessible to browser/anonymous clients.
-- No photos, food descriptions, credentials or user health data are stored here.
create table if not exists public.nutrition_ai_usage (
  request_id uuid primary key,
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  estimated_micros bigint check (estimated_micros >= 0),
  input_tokens integer,
  output_tokens integer,
  created_at timestamptz not null default now()
);
create index if not exists nutrition_ai_usage_month_idx on public.nutrition_ai_usage(month);
alter table public.nutrition_ai_usage enable row level security;
revoke all on public.nutrition_ai_usage from public, anon, authenticated;

create or replace function public.nutrition_budget(
  p_action text,
  p_request_id uuid default null,
  p_limit bigint default 100000000,
  p_usage jsonb default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_month text := to_char(timezone('Asia/Shanghai', now()), 'YYYY-MM');
  v_limit bigint := least(100000000, greatest(0, p_limit));
  v_count bigint;
  v_estimated bigint;
  v_unreported bigint;
  v_alarm boolean;
  v_allowed boolean := true;
begin
  if p_action not in ('status', 'reserve', 'report') or p_limit is null then
    raise exception 'invalid budget operation';
  end if;
  -- Serializes reservations across ALL instances and accounts. A restart or
  -- a retry must not free an already dispatched request's 0.10 CNY allocation.
  perform pg_advisory_xact_lock(21092026, 100);
  select count(*), coalesce(bool_or(estimated_micros > 100000), false)
    into v_count, v_alarm from public.nutrition_ai_usage where month = v_month;
  if p_action = 'reserve' then
    if v_alarm or (v_count + 1) * 100000 > v_limit then
      v_allowed := false;
    else
      insert into public.nutrition_ai_usage(request_id, month) values (p_request_id, v_month);
    end if;
  elsif p_action = 'report' then
    if p_usage is null or not (p_usage ?& array['inputTokens', 'outputTokens', 'estimatedMicros'])
      or (p_usage->>'inputTokens')::bigint not between 0 and 1000000
      or (p_usage->>'outputTokens')::bigint not between 0 and 1000000
      or (p_usage->>'estimatedMicros')::bigint <> (p_usage->>'inputTokens')::bigint * 2 + (p_usage->>'outputTokens')::bigint * 8 then
      raise exception 'invalid usage';
    end if;
    update public.nutrition_ai_usage set
      estimated_micros = (p_usage->>'estimatedMicros')::bigint,
      input_tokens = (p_usage->>'inputTokens')::integer,
      output_tokens = (p_usage->>'outputTokens')::integer
    where request_id = p_request_id and estimated_micros is null;
    -- Reports settle their original row, even across a month boundary.
    if not exists (select 1 from public.nutrition_ai_usage where request_id = p_request_id) then
      raise exception 'unknown reservation';
    end if;
  end if;
  select count(*), coalesce(sum(estimated_micros), 0), count(*) filter (where estimated_micros is null),
    coalesce(bool_or(estimated_micros > 100000), false)
    into v_count, v_estimated, v_unreported, v_alarm
    from public.nutrition_ai_usage where month = v_month;
  return jsonb_build_object('month', v_month, 'allowed', v_allowed,
    'limitCny', v_limit / 1000000.0, 'reservedCny', v_count / 10.0,
    'estimatedCny', v_estimated / 1000000.0, 'requests', v_count,
    'unreportedRequests', v_unreported,
    'remainingRequests', case when v_alarm then 0 else greatest(0, (v_limit - v_count * 100000) / 100000) end);
end;
$$;
revoke all on function public.nutrition_budget(text, uuid, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.nutrition_budget(text, uuid, bigint, jsonb) to service_role;
