-- Old archived writes must pass through the main clear/version merge before recreating history.
create or replace function public.write_app_day(p_date date, p_record jsonb, p_revision bigint)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare main public.app_states; day public.app_daily_records; next_state jsonb; field text; logs jsonb;
begin
  select * into main from public.app_states where user_id = auth.uid() for update;
  if not found then raise exception 'Account state required'; end if;
  if main.state ? 'clearedAt' then
    return jsonb_build_object('cleared',true,'state',main.state,'meals',main.meals,'revision',coalesce((main.state->>'syncRevision')::bigint,0),'updatedAt',main.updated_at);
  end if;
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
