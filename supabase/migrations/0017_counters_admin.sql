-- Admin can add, rename, reorder and hide counters. Hiding keeps all history.
create or replace function public.save_counter(p_id smallint, p_name text, p_sort smallint, p_active boolean) returns smallint
language plpgsql security definer set search_path = public as $$
declare nm text := trim(coalesce(p_name, '')); cd text; n int := 0; rid smallint;
begin
  if not public.has_role('owner') then raise exception 'Only Admin can change counters.'; end if;
  if nm = '' then raise exception 'Please type a name.'; end if;
  if exists (select 1 from public.locations where lower(name) = lower(nm) and id is distinct from p_id) then raise exception 'There is already a counter with this name.'; end if;
  if p_id is null then
    cd := regexp_replace(lower(nm), '[^a-z]+', '_', 'g'); cd := trim(both '_' from cd); if cd = '' then cd := 'counter'; end if;
    while exists (select 1 from public.locations where code = cd || case when n = 0 then '' else '_' || repeat('x', n) end) loop n := n + 1; end loop;
    cd := cd || case when n = 0 then '' else '_' || repeat('x', n) end;
    insert into public.locations(code, name, kind, sort, active) values (cd, nm, 'department', coalesce(p_sort, 100), coalesce(p_active, true)) returning id into rid;
    return rid;
  end if;
  if (select kind from public.locations where id = p_id) = 'store' and not coalesce(p_active, true) then raise exception 'The Store cannot be hidden.'; end if;
  update public.locations set name = nm, sort = coalesce(p_sort, sort), active = coalesce(p_active, active) where id = p_id;
  return p_id;
end $$;
revoke all on function public.save_counter(smallint, text, smallint, boolean) from public, anon;
grant execute on function public.save_counter(smallint, text, smallint, boolean) to authenticated;
