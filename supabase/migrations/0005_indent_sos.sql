-- Release 1: indent from every counter, SOS alerts.
-- Run order: after 0004 (groups, counters, vendor channels).

-- ── Groups readable by signed-in users (picture tiles) ───────
alter table public.item_groups enable row level security;
drop policy if exists item_groups_read on public.item_groups;
create policy item_groups_read on public.item_groups for select to authenticated using (true);
grant select on public.item_groups to authenticated;

update public.item_groups set icon = case code
  when 'veg_fruit' then '🥬' when 'dairy_eggs' then '🥛' when 'chicken_fish' then '🍗'
  when 'atta_rice_dal' then '🌾' when 'oil_masala' then '🌶️' when 'dry_fruits' then '🥜'
  when 'sauces' then '🍯' when 'frozen_snacks' then '🍟' when 'made_in_kitchen' then '🍲'
  when 'bread_bakery' then '🍞' when 'drinks' then '🧃' when 'ice_cream' then '🍨'
  when 'packaging' then '📦' when 'cleaning' then '🧽' when 'fuel' then '🔥' else '🧾' end
where icon is null or icon = '';

-- ── Indents: "nothing needed" and the day an indent is for ───
alter table public.indents add column if not exists nothing_needed boolean not null default false;

create or replace function public.indent_for_date() returns date
language sql stable as $$ select public.business_date(now()) + 1 $$;

create or replace function public.indent_window() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(value, '{}'::jsonb) from public.app_settings where key = 'reminders'
$$;

-- Open (or create) tomorrow's indent for one of my counters.
create or replace function public.open_indent(p_location_id smallint) returns public.indents
language plpgsql security definer set search_path = public as $$
declare r public.indents;
begin
  if not (p_location_id = any(public.my_location_ids()) or public.has_role('owner', 'store')) then
    raise exception 'Not your counter';
  end if;
  insert into public.indents (location_id, for_date, status, created_by)
  values (p_location_id, public.indent_for_date(), 'draft', auth.uid())
  on conflict (location_id, for_date) do nothing;
  select * into r from public.indents where location_id = p_location_id and for_date = public.indent_for_date();
  return r;
end $$;

-- Set one line. qty <= 0 removes it. Only while the indent is a draft.
create or replace function public.set_indent_line(p_indent_id uuid, p_item_id int, p_qty numeric, p_reason text default null, p_method public.entry_method default 'tap')
returns void language plpgsql security definer set search_path = public as $$
declare i public.indents;
begin
  select * into i from public.indents where id = p_indent_id;
  if i.id is null then raise exception 'Indent not found'; end if;
  if not (i.location_id = any(public.my_location_ids()) or public.has_role('owner', 'store')) then raise exception 'Not your counter'; end if;
  if i.status <> 'draft' then raise exception 'This indent is already sent'; end if;
  if not exists (select 1 from public.item_locations where item_id = p_item_id and location_id = i.location_id) then
    raise exception 'That item is not on this counter';
  end if;
  if p_qty is null or p_qty <= 0 then
    delete from public.indent_lines where indent_id = p_indent_id and item_id = p_item_id;
  else
    insert into public.indent_lines (indent_id, item_id, qty, reason, entry_method)
    values (p_indent_id, p_item_id, p_qty, nullif(p_reason, ''), p_method)
    on conflict (indent_id, item_id) do update set qty = excluded.qty, reason = excluded.reason, entry_method = excluded.entry_method;
  end if;
  update public.indents set nothing_needed = false where id = p_indent_id and nothing_needed;
end $$;

create or replace function public.submit_indent(p_indent_id uuid, p_nothing boolean default false)
returns public.indents language plpgsql security definer set search_path = public as $$
declare i public.indents; n int;
begin
  select * into i from public.indents where id = p_indent_id;
  if i.id is null then raise exception 'Indent not found'; end if;
  if not (i.location_id = any(public.my_location_ids()) or public.has_role('owner', 'store')) then raise exception 'Not your counter'; end if;
  if i.status <> 'draft' then raise exception 'This indent is already sent'; end if;
  select count(*) into n from public.indent_lines where indent_id = p_indent_id;
  if n = 0 and not p_nothing then raise exception 'Add at least one item, or say nothing is needed'; end if;
  if p_nothing and n > 0 then raise exception 'Remove the items first'; end if;
  update public.indents set status = 'submitted', submitted_by = auth.uid(), submitted_at = now(), nothing_needed = p_nothing
   where id = p_indent_id returning * into i;
  return i;
end $$;

-- Take it back to change it, as long as the store has not locked it.
create or replace function public.reopen_indent(p_indent_id uuid)
returns public.indents language plpgsql security definer set search_path = public as $$
declare i public.indents;
begin
  select * into i from public.indents where id = p_indent_id;
  if i.id is null then raise exception 'Indent not found'; end if;
  if not (i.location_id = any(public.my_location_ids()) or public.has_role('owner', 'store')) then raise exception 'Not your counter'; end if;
  if i.status <> 'submitted' then raise exception 'The store has already started on this indent'; end if;
  update public.indents set status = 'draft', submitted_by = null, submitted_at = null where id = p_indent_id returning * into i;
  return i;
end $$;

-- "My usual": average of the last 5 indents that included the item, plus the last quantity.
create or replace function public.my_usual(p_location_id smallint)
returns table (item_id int, usual numeric, last_qty numeric, runs int)
language sql stable security definer set search_path = public as $$
  with ranked as (
    select l.item_id, l.qty, row_number() over (partition by l.item_id order by i.for_date desc) rn
    from public.indent_lines l join public.indents i on i.id = l.indent_id
    where i.location_id = p_location_id and i.status in ('submitted', 'locked')
      and (p_location_id = any(public.my_location_ids()) or public.has_role('owner', 'manager', 'store'))
  )
  select item_id, round(avg(qty) filter (where rn <= 5), 3), max(qty) filter (where rn = 1), count(*) filter (where rn <= 5)::int
  from ranked group by item_id
$$;

-- ── SOS ──────────────────────────────────────────────────────
create table if not exists public.sos_alerts (
  id uuid primary key default gen_random_uuid(),
  location_id smallint not null references public.locations(id),
  raised_by uuid not null references public.profiles(id) default auth.uid(),
  item_id int references public.items(id),
  note text not null default '',
  created_at timestamptz not null default now(),
  acked_by uuid references public.profiles(id),
  acked_at timestamptz,
  eta_minutes int,
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id)
);
create index if not exists sos_open_idx on public.sos_alerts (created_at desc) where resolved_at is null;
alter table public.sos_alerts enable row level security;
drop policy if exists sos_office_read on public.sos_alerts;
create policy sos_office_read on public.sos_alerts for select to authenticated using (public.has_role('owner', 'manager', 'store'));
drop policy if exists sos_dept_read on public.sos_alerts;
create policy sos_dept_read on public.sos_alerts for select to authenticated using (location_id = any(public.my_location_ids()));
grant select on public.sos_alerts to authenticated;

create or replace function public.raise_sos(p_location_id smallint, p_item_id int default null, p_note text default '')
returns public.sos_alerts language plpgsql security definer set search_path = public as $$
declare r public.sos_alerts;
begin
  if not (p_location_id = any(public.my_location_ids()) or public.has_role('owner', 'manager', 'store')) then raise exception 'Not your counter'; end if;
  insert into public.sos_alerts (location_id, raised_by, item_id, note) values (p_location_id, auth.uid(), p_item_id, coalesce(p_note, ''))
  returning * into r;
  return r;
end $$;

create or replace function public.ack_sos(p_id uuid, p_eta int default null)
returns public.sos_alerts language plpgsql security definer set search_path = public as $$
declare r public.sos_alerts;
begin
  if not public.has_role('owner', 'manager', 'store') then raise exception 'Only the store can answer'; end if;
  update public.sos_alerts set acked_by = coalesce(acked_by, auth.uid()), acked_at = coalesce(acked_at, now()), eta_minutes = coalesce(p_eta, eta_minutes)
   where id = p_id returning * into r;
  return r;
end $$;

create or replace function public.resolve_sos(p_id uuid)
returns public.sos_alerts language plpgsql security definer set search_path = public as $$
declare r public.sos_alerts;
begin
  if not (public.has_role('owner', 'manager', 'store') or exists (select 1 from public.sos_alerts s where s.id = p_id and s.raised_by = auth.uid())) then
    raise exception 'Not allowed';
  end if;
  update public.sos_alerts set resolved_at = coalesce(resolved_at, now()), resolved_by = coalesce(resolved_by, auth.uid()),
         acked_by = coalesce(acked_by, auth.uid()), acked_at = coalesce(acked_at, now())
   where id = p_id returning * into r;
  return r;
end $$;

-- Who to call: store people and the owner, for the tap-to-call buttons.
create or replace function public.sos_contacts()
returns table (full_name text, phone text, role public.app_role)
language sql stable security definer set search_path = public as $$
  select full_name, phone, role from public.profiles
  where active and role in ('store', 'owner', 'manager') and phone is not null
$$;

revoke all on function public.open_indent(smallint), public.set_indent_line(uuid, int, numeric, text, public.entry_method),
  public.submit_indent(uuid, boolean), public.reopen_indent(uuid), public.my_usual(smallint),
  public.raise_sos(smallint, int, text), public.ack_sos(uuid, int), public.resolve_sos(uuid),
  public.sos_contacts(), public.indent_window(), public.indent_for_date() from public, anon;
grant execute on function public.open_indent(smallint), public.set_indent_line(uuid, int, numeric, text, public.entry_method),
  public.submit_indent(uuid, boolean), public.reopen_indent(uuid), public.my_usual(smallint),
  public.raise_sos(smallint, int, text), public.ack_sos(uuid, int), public.resolve_sos(uuid),
  public.sos_contacts(), public.indent_window(), public.indent_for_date() to authenticated;

-- Live updates for the store phone and the owner.
do $$ begin
  begin alter publication supabase_realtime add table public.sos_alerts; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.indents; exception when duplicate_object then null; end;
end $$;
