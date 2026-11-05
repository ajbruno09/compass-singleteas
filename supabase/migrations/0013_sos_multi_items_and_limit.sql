-- SOS: up to 3 items per alert, and a daily limit (rule sos_daily_limit, default 3, never above 4)
-- per person and per counter. Owner, manager and store are not limited.
alter table public.sos_alerts add column if not exists item_ids int[] not null default '{}';
update public.sos_alerts set item_ids = array[item_id] where item_id is not null and item_ids = '{}';

insert into rules(key,label,description,group_name,kind,unit,value,wired,money,sort,why) values
('sos_daily_limit','SOS allowed each day','How many SOS a counter, and each person, can send in one day. The highest allowed is 4.','Urgent requests','number','per day','3',true,false,19,'')
on conflict (key) do nothing;

create or replace function public.sos_left(p_location_id smallint) returns int
language plpgsql stable security definer set search_path = public as $$
declare lim int; bd date := business_date(now()); used_me int; used_loc int;
begin
  lim := least(greatest(coalesce((rule_value('sos_daily_limit'))::text::numeric, 3)::int, 1), 4);
  select count(*) into used_me from sos_alerts where raised_by = auth.uid() and business_date(created_at) = bd;
  select count(*) into used_loc from sos_alerts where location_id = p_location_id and business_date(created_at) = bd;
  return greatest(0, least(lim - used_me, lim - used_loc));
end $$;
grant execute on function public.sos_left(smallint) to authenticated;

create or replace function public.raise_sos(p_location_id smallint, p_item_ids int[], p_note text default '')
returns public.sos_alerts language plpgsql security definer set search_path = public as $$
declare r public.sos_alerts; ids int[];
begin
  if not (p_location_id = any(public.my_location_ids()) or public.has_role('owner', 'manager', 'store')) then raise exception 'Not your counter'; end if;
  if not public.has_role('owner', 'manager', 'store') and public.sos_left(p_location_id) <= 0 then
    raise exception 'You have used all your SOS for today. Please call the store or Admin.';
  end if;
  select coalesce(array_agg(distinct x), '{}') into ids from unnest(coalesce(p_item_ids, '{}')) x;
  if coalesce(array_length(ids, 1), 0) > 3 then raise exception 'Please choose up to 3 items'; end if;
  insert into public.sos_alerts (location_id, raised_by, item_id, item_ids, note)
  values (p_location_id, auth.uid(), case when array_length(ids, 1) > 0 then ids[1] end, ids, coalesce(p_note, ''))
  returning * into r;
  return r;
end $$;
revoke all on function public.raise_sos(smallint, int[], text) from public, anon;
grant execute on function public.raise_sos(smallint, int[], text) to authenticated;
