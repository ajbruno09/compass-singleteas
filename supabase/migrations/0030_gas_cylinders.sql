-- Compass 5.13: LPG cylinder register, receive/issue/return, nightly weigh as an assignable duty.
update public.item_groups set name = 'Fuel' where code = 'fuel';
update public.items set unit = 'kg', purchase_unit = 'cyl', purchase_factor = 19, show_as = 'cyl' where id = 658;

insert into public.locations (name, code, kind, sort, active)
select 'Gas Bank', 'gas_bank', 'department', coalesce(max(sort),0)+1, true from public.locations
where not exists (select 1 from public.locations where code = 'gas_bank');

alter table public.cylinders
  add column if not exists location_id smallint references public.locations(id),
  add column if not exists received_at timestamptz,
  add column if not exists received_gross_g numeric,
  add column if not exists shortfall_g numeric not null default 0,
  add column if not exists issued_at timestamptz,
  add column if not exists last_weigh_date date;

create table if not exists public.cylinder_events (
  id bigserial primary key,
  code text not null references public.cylinders(code),
  kind text not null check (kind in ('received','issued','weighed','returned','collected','override')),
  at timestamptz not null default now(),
  by_user uuid default auth.uid(),
  location_id smallint,
  gross_g numeric,
  photo_path text,
  reason text,
  note text,
  flagged boolean not null default false
);
alter table public.cylinder_events enable row level security;
drop policy if exists cyl_events_read on public.cylinder_events;
create policy cyl_events_read on public.cylinder_events for select to authenticated using (public.has_role('owner','manager','store','accounts'));

create table if not exists public.duty_people (
  duty text not null, profile_id uuid not null references public.profiles(id) on delete cascade,
  primary key (duty, profile_id)
);
alter table public.duty_people enable row level security;
drop policy if exists duty_read on public.duty_people;
create policy duty_read on public.duty_people for select to authenticated using (true);
drop policy if exists duty_write on public.duty_people;
create policy duty_write on public.duty_people for all to authenticated using (public.has_role('owner','manager')) with check (public.has_role('owner','manager'));

create or replace function public.has_duty(p_duty text) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.duty_people where duty = p_duty and profile_id = auth.uid())
$$;
grant execute on function public.has_duty(text) to authenticated;

insert into storage.buckets (id, name, public) values ('cylinder-photos', 'cylinder-photos', false) on conflict do nothing;
drop policy if exists cylphoto_ins on storage.objects;
create policy cylphoto_ins on storage.objects for insert to authenticated with check (bucket_id = 'cylinder-photos');
drop policy if exists cylphoto_sel on storage.objects;
create policy cylphoto_sel on storage.objects for select to authenticated using (bucket_id = 'cylinder-photos' and (public.has_role('owner','manager','store') or owner = auth.uid()));

-- Receive a full cylinder into the store.
create or replace function public.gas_receive(p_code text, p_tare_g numeric, p_gross_g numeric, p_supplier text, p_photo text)
returns numeric language plpgsql security definer set search_path = public as $$
declare v_short numeric; v_code text := upper(trim(p_code)); v_net numeric;
begin
  if not public.has_role('owner','manager','store') then raise exception 'Only the store can receive cylinders'; end if;
  if v_code = '' then raise exception 'Enter the cylinder number'; end if;
  if coalesce(p_tare_g,0) <= 0 or coalesce(p_gross_g,0) <= 0 then raise exception 'Enter the stamped empty weight and the weight on the scale'; end if;
  if coalesce(p_photo,'') = '' then raise exception 'Take a photo of the scale first'; end if;
  if p_gross_g <= p_tare_g then raise exception 'The scale weight must be more than the stamped empty weight'; end if;
  if exists (select 1 from public.cylinders where code = v_code and status in ('Full in store','In use')) then raise exception 'Cylinder % is already in the store or in use', v_code; end if;
  v_short := greatest(0, p_tare_g + 19000 - p_gross_g);
  v_net := p_gross_g - p_tare_g;
  insert into public.cylinders (code, tare_g, status, supplier, last_gross_g, received_at, received_gross_g, shortfall_g, location_id, issued_at, last_weigh_date)
    values (v_code, p_tare_g, 'Full in store', nullif(trim(p_supplier),''), p_gross_g, now(), p_gross_g, v_short, 1, null, null)
  on conflict (code) do update set tare_g = excluded.tare_g, status = 'Full in store', supplier = excluded.supplier, last_gross_g = excluded.last_gross_g,
    received_at = now(), received_gross_g = excluded.received_gross_g, shortfall_g = excluded.shortfall_g, location_id = 1, issued_at = null, last_weigh_date = null;
  insert into public.cylinder_events (code, kind, location_id, gross_g, photo_path, flagged, note) values (v_code, 'received', 1, p_gross_g, p_photo, v_short > 300, case when v_short > 0 then 'Short by '||round(v_short)||' g' end);
  insert into public.stock_ledger (item_id, qty, to_location_id, movement, doc_type, note, created_by) values (658, round(v_net/1000.0, 3), 1, 'purchase', 'cylinder', v_code, auth.uid());
  return v_short;
end $$;

-- Issue a full cylinder to a counter, closing the old one first (or giving a reason).
create or replace function public.gas_issue(p_code text, p_location smallint, p_close_code text, p_close_gross_g numeric, p_close_photo text, p_reason text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare c public.cylinders; o public.cylinders; v_max int; v_in int; v_loc text; v_net numeric; v_res numeric; v_used numeric; v_overr boolean := false;
begin
  if not public.has_role('owner','manager','store') then raise exception 'Only the store can issue cylinders'; end if;
  select * into c from public.cylinders where code = upper(trim(p_code)) for update;
  if not found or c.status <> 'Full in store' then raise exception 'That cylinder is not a full cylinder in the store'; end if;
  select name into v_loc from public.locations where id = p_location;
  select count(*) into v_in from public.cylinders where status = 'In use' and location_id = p_location;
  v_max := case when (select code from public.locations where id = p_location) = 'gas_bank' then 2 else 1 end;
  if coalesce(p_close_code,'') <> '' then
    select * into o from public.cylinders where code = upper(trim(p_close_code)) and status = 'In use' and location_id = p_location for update;
    if not found then raise exception 'The cylinder you are closing is not in use at %', v_loc; end if;
    if coalesce(p_close_photo,'') = '' or coalesce(p_close_gross_g,0) <= 0 then raise exception 'Weigh the old cylinder and take a photo of the scale'; end if;
    v_res := greatest(0, p_close_gross_g - o.tare_g);
    v_used := greatest(0, coalesce(o.last_gross_g,p_close_gross_g) - p_close_gross_g);
    if v_used > 0 then insert into public.stock_ledger (item_id, qty, from_location_id, movement, doc_type, note, created_by) values (658, round(v_used/1000.0,3), p_location, 'consumption', 'cylinder', o.code, auth.uid()); end if;
    if v_res > 0 then insert into public.stock_ledger (item_id, qty, from_location_id, movement, doc_type, note, created_by) values (658, round(v_res/1000.0,3), p_location, 'consumption', 'cylinder', o.code||' returned with gas left', auth.uid()); end if;
    update public.cylinders set status = 'Empty', last_gross_g = p_close_gross_g, last_weigh_date = public.business_date(now()) where code = o.code;
    insert into public.cylinder_events (code, kind, location_id, gross_g, photo_path, flagged, note) values (o.code, 'returned', p_location, p_close_gross_g, p_close_photo, v_res > 1500, case when v_res > 1500 then 'Returned with '||round(v_res/1000.0,1)||' kg gas still inside' else p_note end);
    if v_res > 1500 then perform public.raise_alert('today', 'Cylinder '||o.code||' returned with gas left', round(v_res/1000.0,1)||' kg of gas was still inside when it left '||v_loc||'.', '{owner,manager}', p_location, 'gas'); end if;
  elsif v_in >= v_max then
    if coalesce(trim(p_reason),'') = '' then raise exception '% already has % cylinder(s). Close the old one, or give a reason for the extra cylinder.', v_loc, v_in; end if;
    v_overr := true;
  end if;
  v_net := greatest(0, coalesce(c.last_gross_g,0) - c.tare_g);
  update public.cylinders set status = 'In use', location_id = p_location, issued_at = now(), last_weigh_date = null where code = c.code;
  insert into public.stock_ledger (item_id, qty, from_location_id, to_location_id, movement, doc_type, note, created_by) values (658, round(v_net/1000.0,3), 1, p_location, 'issue', 'cylinder', c.code, auth.uid());
  insert into public.cylinder_events (code, kind, location_id, reason, note, flagged) values (c.code, case when v_overr then 'override' else 'issued' end, p_location, nullif(trim(p_reason),''), p_note, v_overr);
  if v_overr then perform public.raise_alert('today', 'Extra cylinder issued to '||v_loc, 'Cylinder '||c.code||' was issued without closing an old one. Reason: '||trim(p_reason), '{owner,manager}', p_location, 'gas'); end if;
end $$;

-- Cylinders the caller should weigh tonight.
create or replace function public.gas_to_weigh() returns table (code text, location_id smallint, location_name text, tare_g numeric, last_gross_g numeric, weighed_today boolean)
language sql stable security definer set search_path = public as $$
  select c.code, c.location_id, l.name, c.tare_g, c.last_gross_g, coalesce(c.last_weigh_date = public.business_date(now()), false)
    from public.cylinders c join public.locations l on l.id = c.location_id
   where c.status = 'In use'
     and (public.has_role('owner','manager','store') or (public.has_duty('gas_weigh') and c.location_id = any(public.my_location_ids())))
   order by l.sort, c.code
$$;
grant execute on function public.gas_to_weigh() to authenticated;

create or replace function public.gas_weigh(p_code text, p_gross_g numeric, p_photo text, p_correction boolean, p_note text) returns numeric
language plpgsql security definer set search_path = public as $$
declare c public.cylinders; v_used numeric; v_today date := public.business_date(now()); v_flag boolean := false; v_loc text;
begin
  select * into c from public.cylinders where code = upper(trim(p_code)) and status = 'In use' for update;
  if not found then raise exception 'That cylinder is not in use'; end if;
  if not (public.has_role('owner','manager','store') or (public.has_duty('gas_weigh') and c.location_id = any(public.my_location_ids()))) then raise exception 'This cylinder is not yours to weigh'; end if;
  if coalesce(p_photo,'') = '' then raise exception 'Take a photo of the scale first'; end if;
  if coalesce(p_gross_g,0) <= c.tare_g then raise exception 'The weight must be more than the empty weight (% g)', c.tare_g; end if;
  if c.last_weigh_date = v_today and not coalesce(p_correction,false) then raise exception 'This cylinder is already weighed tonight. Use correction if the number was wrong.'; end if;
  v_used := c.last_gross_g - p_gross_g;
  if v_used < -150 then v_flag := true; end if;
  select name into v_loc from public.locations where id = c.location_id;
  if v_used > 0 and coalesce(c.last_weigh_date, date '1900-01-01') <> v_today then
    insert into public.stock_ledger (item_id, qty, from_location_id, movement, doc_type, note, created_by) values (658, round(v_used/1000.0,3), c.location_id, 'consumption', 'cylinder', c.code, auth.uid());
  end if;
  update public.cylinders set last_gross_g = p_gross_g, last_weigh_date = v_today where code = c.code;
  insert into public.cylinder_events (code, kind, location_id, gross_g, photo_path, note, flagged) values (c.code, 'weighed', c.location_id, p_gross_g, p_photo, case when coalesce(p_correction,false) then 'Corrected reading. '||coalesce(p_note,'') else p_note end, v_flag or coalesce(p_correction,false));
  if v_flag then perform public.raise_alert('today', 'Cylinder '||c.code||' weighs more than last night', 'At '||v_loc||' the reading went up by '||round(-v_used)||' g. Please check the scale photo.', '{owner,manager}', c.location_id, 'gas'); end if;
  return greatest(0, v_used);
end $$;

create or replace function public.gas_collected(p_code text) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role('owner','manager','store') then raise exception 'Only the store can do this'; end if;
  update public.cylinders set status = 'With supplier', location_id = null where code = upper(trim(p_code)) and status = 'Empty';
  if not found then raise exception 'That cylinder is not an empty one in the store'; end if;
  insert into public.cylinder_events (code, kind) values (upper(trim(p_code)), 'collected');
end $$;
grant execute on function public.gas_receive(text,numeric,numeric,text,text), public.gas_issue(text,smallint,text,numeric,text,text,text), public.gas_weigh(text,numeric,text,boolean,text), public.gas_collected(text) to authenticated;
