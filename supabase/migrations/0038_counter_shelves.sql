-- Assign whole shelves (item groups) to counters. A shelf tick adds every active item on it to the counter (item_locations).
create table if not exists public.counter_shelves (
  location_id smallint not null references public.locations(id),
  group_id smallint not null references public.item_groups(id),
  primary key (location_id, group_id)
);
alter table public.counter_shelves enable row level security;
drop policy if exists counter_shelves_read on public.counter_shelves;
create policy counter_shelves_read on public.counter_shelves for select to authenticated using (true);

create or replace function public.set_counter_shelves(p_loc smallint, p_groups smallint[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare added int := 0; removed int := 0; g smallint; n int;
begin
  if not public.has_role('owner') then raise exception 'Only Admin can assign shelves.'; end if;
  if not exists (select 1 from public.locations where id = p_loc) then raise exception 'Counter not found.'; end if;
  for g in select group_id from public.counter_shelves where location_id = p_loc and not (group_id = any(coalesce(p_groups, '{}'))) loop
    delete from public.item_locations il using public.items i where il.item_id = i.id and i.group_id = g and il.location_id = p_loc;
    get diagnostics n = row_count; removed := removed + n;
    delete from public.counter_shelves where location_id = p_loc and group_id = g;
  end loop;
  foreach g in array coalesce(p_groups, '{}') loop
    insert into public.counter_shelves(location_id, group_id) values (p_loc, g) on conflict do nothing;
    insert into public.item_locations(item_id, location_id) select i.id, p_loc from public.items i where i.group_id = g and i.active on conflict do nothing;
    get diagnostics n = row_count; added := added + n;
  end loop;
  return jsonb_build_object('added', added, 'removed', removed);
end $$;

-- A new item on a ticked shelf (or an item moved onto it) shows up at those counters by itself.
create or replace function public.items_follow_shelves() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.group_id is not null and new.active then
    insert into public.item_locations(item_id, location_id) select new.id, cs.location_id from public.counter_shelves cs where cs.group_id = new.group_id on conflict do nothing;
  end if;
  return new;
end $$;
drop trigger if exists items_follow_shelves on public.items;
create trigger items_follow_shelves after insert or update of group_id, active on public.items for each row execute function public.items_follow_shelves();
