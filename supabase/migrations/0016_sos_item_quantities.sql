-- SOS carries a quantity for each item.
alter table public.sos_alerts add column if not exists item_qtys jsonb not null default '{}'::jsonb;

drop function if exists public.raise_sos(smallint, int[], text);
create or replace function public.raise_sos(p_location_id smallint, p_item_ids int[], p_note text default '', p_qtys jsonb default '{}'::jsonb)
returns public.sos_alerts language plpgsql security definer set search_path = public as $$
declare r public.sos_alerts; ids int[]; q jsonb := '{}'::jsonb; x int; v numeric;
begin
  if not (p_location_id = any(public.my_location_ids()) or public.has_role('owner', 'manager', 'store')) then raise exception 'Not your counter'; end if;
  if not public.has_role('owner', 'manager', 'store') and public.sos_left(p_location_id) <= 0 then
    raise exception 'You have used all your SOS for today. Please call the store or Admin.';
  end if;
  select coalesce(array_agg(distinct i), '{}') into ids from unnest(coalesce(p_item_ids, '{}')) i;
  if coalesce(array_length(ids, 1), 0) > 3 then raise exception 'Please choose up to 3 items'; end if;
  foreach x in array ids loop
    v := nullif(p_qtys ->> x::text, '')::numeric;
    if v is not null and v > 0 and v <= 100000 then q := q || jsonb_build_object(x::text, v); end if;
  end loop;
  insert into public.sos_alerts (location_id, raised_by, item_id, item_ids, item_qtys, note)
  values (p_location_id, auth.uid(), case when array_length(ids, 1) > 0 then ids[1] end, ids, q, coalesce(p_note, ''))
  returning * into r;
  return r;
end $$;
revoke all on function public.raise_sos(smallint, int[], text, jsonb) from public, anon;
grant execute on function public.raise_sos(smallint, int[], text, jsonb) to authenticated;
