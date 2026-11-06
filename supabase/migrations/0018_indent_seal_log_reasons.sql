-- Compass 5.0, Indent tree.
-- Window: opens 15:30, due 17:00, one hour of grace, sealed at 18:00 (server enforced).
-- Every change after the first send is recorded. Late and missed indents are recorded with reasons.
-- After sealing, a counter asks Admin to open it. Reasons for "more than usual" and "missed" are Admin lists.

alter table public.indents
  add column if not exists first_submitted_at timestamptz,
  add column if not exists late boolean not null default false,
  add column if not exists outcome text,
  add column if not exists missed_reason text,
  add column if not exists reopen_until timestamptz;

-- Indents that were already sent before this release count as on time.
update public.indents set first_submitted_at = submitted_at, outcome = case when nothing_needed then 'nothing' else 'on_time' end
 where submitted_at is not null and first_submitted_at is null;

-- ── Reasons (Admin lists) ────────────────────────────────────
create table if not exists public.indent_reasons (
  id serial primary key,
  kind text not null check (kind in ('more', 'missed')),
  label text not null,
  active boolean not null default true,
  sort int not null default 0,
  unique (kind, label)
);
insert into public.indent_reasons(kind, label, sort) values
 ('more', 'Party or bulk order', 1), ('more', 'It finished early', 2), ('more', 'Store did not issue when ordered', 3), ('more', 'Menu special or event', 4),
 ('missed', 'Kitchen was very busy', 1), ('missed', 'Was away', 2), ('missed', 'Was unwell', 3), ('missed', 'Forgot', 4), ('missed', 'Other', 5)
on conflict do nothing;
alter table public.indent_reasons enable row level security;
drop policy if exists indent_reasons_read on public.indent_reasons;
create policy indent_reasons_read on public.indent_reasons for select to authenticated using (true);
grant select on public.indent_reasons to authenticated;

create or replace function public.save_indent_reason(p_id int, p_kind text, p_label text, p_active boolean default true) returns int
language plpgsql security definer set search_path = public as $$
declare rid int;
begin
  if not public.has_role('owner') then raise exception 'Only Admin can change these.'; end if;
  if p_kind not in ('more', 'missed') then raise exception 'Unknown list'; end if;
  if coalesce(trim(p_label), '') = '' then raise exception 'Write the reason first'; end if;
  if p_id is null then
    if (select count(*) from indent_reasons where kind = p_kind and active) >= 8 and p_active then raise exception 'Keep this list short, up to 8 reasons'; end if;
    insert into indent_reasons(kind, label, active, sort) values (p_kind, trim(p_label), p_active, coalesce((select max(sort) from indent_reasons where kind = p_kind), 0) + 1)
      on conflict (kind, label) do update set active = excluded.active returning id into rid;
  else
    update indent_reasons set label = trim(p_label), active = p_active where id = p_id returning id into rid;
  end if;
  return rid;
end $$;

-- ── Change log ───────────────────────────────────────────────
create table if not exists public.indent_changes (
  id uuid primary key default gen_random_uuid(),
  indent_id uuid not null references public.indents(id) on delete cascade,
  item_id int references public.items(id),
  old_qty numeric(12,3),
  new_qty numeric(12,3),
  action text not null,   -- added, changed, removed, reopened, resent, store_edit, auto_sent, approved_reopen
  note text,
  by_profile uuid,
  at timestamptz not null default now()
);
create index if not exists indent_changes_indent on public.indent_changes(indent_id, at);
alter table public.indent_changes enable row level security;
drop policy if exists indent_changes_read on public.indent_changes;
create policy indent_changes_read on public.indent_changes for select to authenticated using (
  public.has_role('owner', 'manager', 'store') or exists (select 1 from public.indents i where i.id = indent_id and i.location_id = any(public.my_location_ids()))
);
grant select on public.indent_changes to authenticated;

-- ── Reopen requests ──────────────────────────────────────────
create table if not exists public.indent_reopen_requests (
  id uuid primary key default gen_random_uuid(),
  indent_id uuid not null references public.indents(id) on delete cascade,
  requested_by uuid not null default auth.uid(),
  reason text not null,
  note text not null default '',
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  decided_by uuid,
  decided_at timestamptz,
  decision_note text not null default '',
  created_at timestamptz not null default now()
);
alter table public.indent_reopen_requests enable row level security;
drop policy if exists indent_reopen_read on public.indent_reopen_requests;
create policy indent_reopen_read on public.indent_reopen_requests for select to authenticated using (
  public.has_role('owner', 'manager', 'store') or requested_by = auth.uid()
);
grant select on public.indent_reopen_requests to authenticated;

create table if not exists public.indent_reminders (
  for_date date not null, kind text not null, location_id smallint not null,
  primary key (for_date, kind, location_id)
);
alter table public.indent_reminders enable row level security;

-- ── Times ────────────────────────────────────────────────────
create or replace function public.indent_times(p_for_date date) returns table (open_at timestamptz, due_at timestamptz, seal_at timestamptz)
language sql stable security definer set search_path = public as $$
  with r as (select coalesce((select value from app_settings where key = 'reminders'), '{}'::jsonb) v)
  select ((p_for_date - 1)::timestamp + coalesce(v->>'indent_open', '15:30')::time) at time zone 'Asia/Kolkata',
         ((p_for_date - 1)::timestamp + coalesce(v->>'indent_due', '17:00')::time) at time zone 'Asia/Kolkata',
         ((p_for_date - 1)::timestamp + coalesce(v->>'indent_due', '17:00')::time + make_interval(mins => coalesce((v->>'indent_grace')::int, 60))) at time zone 'Asia/Kolkata'
  from r
$$;

create or replace function public.indent_sealed(i public.indents) returns boolean
language sql stable security definer set search_path = public as $$
  select not (i.reopen_until is not null and now() < i.reopen_until)
     and (i.status = 'locked' or now() >= (select seal_at from public.indent_times(i.for_date)))
$$;

-- ── Lines: sealed check and change log ───────────────────────
create or replace function public.set_indent_line(p_indent_id uuid, p_item_id int, p_qty numeric, p_reason text default null, p_method public.entry_method default 'tap')
returns void language plpgsql security definer set search_path = public as $$
declare i public.indents; oldq numeric;
begin
  select * into i from public.indents where id = p_indent_id;
  if i.id is null then raise exception 'Indent not found'; end if;
  if not (i.location_id = any(public.my_location_ids()) or public.has_role('owner', 'store')) then raise exception 'Not your counter'; end if;
  if i.status <> 'draft' then raise exception 'This indent is already sent'; end if;
  if public.indent_sealed(i) then raise exception 'This indent is closed. Please ask Admin to open it.'; end if;
  if not exists (select 1 from public.item_locations where item_id = p_item_id and location_id = i.location_id) then
    raise exception 'That item is not on this counter';
  end if;
  select qty into oldq from public.indent_lines where indent_id = p_indent_id and item_id = p_item_id;
  if p_qty is null or p_qty <= 0 then
    delete from public.indent_lines where indent_id = p_indent_id and item_id = p_item_id;
    if oldq is not null and i.first_submitted_at is not null then
      insert into public.indent_changes(indent_id, item_id, old_qty, new_qty, action, by_profile) values (p_indent_id, p_item_id, oldq, null, 'removed', auth.uid());
    end if;
  else
    insert into public.indent_lines (indent_id, item_id, qty, reason, entry_method)
    values (p_indent_id, p_item_id, p_qty, nullif(left(trim(coalesce(p_reason, '')), 80), ''), p_method)
    on conflict (indent_id, item_id) do update set qty = excluded.qty, reason = excluded.reason, entry_method = excluded.entry_method;
    if i.first_submitted_at is not null and oldq is distinct from p_qty then
      insert into public.indent_changes(indent_id, item_id, old_qty, new_qty, action, by_profile) values (p_indent_id, p_item_id, oldq, p_qty, case when oldq is null then 'added' else 'changed' end, auth.uid());
    end if;
  end if;
  update public.indents set nothing_needed = false where id = p_indent_id and nothing_needed;
end $$;

create or replace function public.submit_indent(p_indent_id uuid, p_nothing boolean default false)
returns public.indents language plpgsql security definer set search_path = public as $$
declare i public.indents; n int; bad text; was_sent boolean; late_now boolean; lname text;
begin
  select * into i from public.indents where id = p_indent_id for update;
  if i.id is null then raise exception 'Indent not found'; end if;
  if not (i.location_id = any(public.my_location_ids()) or public.has_role('owner', 'store')) then raise exception 'Not your counter'; end if;
  if i.status <> 'draft' then raise exception 'This indent is already sent'; end if;
  if public.indent_sealed(i) then raise exception 'This indent is closed. Please ask Admin to open it.'; end if;
  select count(*) into n from public.indent_lines where indent_id = p_indent_id;
  if n = 0 and not p_nothing then raise exception 'Add at least one item, or say nothing is needed'; end if;
  if p_nothing and n > 0 then raise exception 'Remove the items first'; end if;
  -- More than usual needs a reason, checked here on the server.
  select string_agg(it.name, ', ') into bad
    from public.indent_lines l join public.items it on it.id = l.item_id
    join public.my_usual(i.location_id) u on u.item_id = l.item_id
   where l.indent_id = p_indent_id and u.runs >= 2 and l.qty > u.usual * 1.5
     and l.qty - u.usual >= coalesce((select min(q) from unnest(it.quick_amounts) q where q > 0), 1)
     and coalesce(trim(l.reason), '') = '';
  if bad is not null then raise exception 'Please give a reason for the large quantity of: %', bad; end if;
  was_sent := i.first_submitted_at is not null;
  select (now() > due_at) into late_now from public.indent_times(i.for_date);
  update public.indents set status = 'submitted', submitted_by = auth.uid(), submitted_at = now(), nothing_needed = p_nothing,
      first_submitted_at = coalesce(first_submitted_at, now()),
      late = late or (not was_sent and late_now),
      outcome = case when was_sent then outcome when p_nothing then 'nothing' when late_now then 'late' else 'on_time' end
   where id = p_indent_id returning * into i;
  if was_sent then
    insert into public.indent_changes(indent_id, action, by_profile) values (p_indent_id, 'resent', auth.uid());
    select name into lname from public.locations where id = i.location_id;
    begin perform public.notify(array['store'], null, 'Indent changed', lname || ' changed their indent after sending. Please check it.', '/indents', 'indentchg-' || i.id::text, false);
    exception when others then null; end;
  end if;
  return i;
end $$;

create or replace function public.reopen_indent(p_indent_id uuid)
returns public.indents language plpgsql security definer set search_path = public as $$
declare i public.indents;
begin
  select * into i from public.indents where id = p_indent_id;
  if i.id is null then raise exception 'Indent not found'; end if;
  if not (i.location_id = any(public.my_location_ids()) or public.has_role('owner', 'store')) then raise exception 'Not your counter'; end if;
  if i.status <> 'submitted' then raise exception 'The store has already started on this indent'; end if;
  if public.indent_sealed(i) then raise exception 'This indent is closed. Please ask Admin to open it.'; end if;
  update public.indents set status = 'draft', submitted_by = null, submitted_at = null where id = p_indent_id returning * into i;
  insert into public.indent_changes(indent_id, action, by_profile) values (p_indent_id, 'reopened', auth.uid());
  return i;
end $$;

-- ── Asking to open a closed indent ───────────────────────────
create or replace function public.request_indent_reopen(p_indent_id uuid, p_reason text, p_note text default '') returns uuid
language plpgsql security definer set search_path = public as $$
declare i public.indents; rid uuid; ids uuid[]; lname text;
begin
  select * into i from public.indents where id = p_indent_id;
  if i.id is null then raise exception 'Indent not found'; end if;
  if not (i.location_id = any(public.my_location_ids())) then raise exception 'Not your counter'; end if;
  if not public.indent_sealed(i) then raise exception 'This indent is still open.'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Please choose a reason'; end if;
  if exists (select 1 from public.indent_reopen_requests where indent_id = p_indent_id and status = 'pending') then raise exception 'You have already asked. Admin will answer soon.'; end if;
  insert into public.indent_reopen_requests(indent_id, requested_by, reason, note) values (p_indent_id, auth.uid(), trim(p_reason), left(coalesce(p_note, ''), 200)) returning id into rid;
  if i.outcome = 'missed' and i.missed_reason is null then update public.indents set missed_reason = trim(p_reason) where id = p_indent_id; end if;
  select name into lname from public.locations where id = i.location_id;
  select coalesce(array_agg(id), '{}') into ids from public.profiles where role = 'owner' and active;
  begin perform public.notify(null, ids, 'Open an indent?', lname || ' asks to open their indent. Reason: ' || trim(p_reason), '/indents', 'indentreopen-' || rid::text, false);
  exception when others then null; end;
  return rid;
end $$;

create or replace function public.decide_indent_reopen(p_request_id uuid, p_approve boolean, p_note text default '') returns void
language plpgsql security definer set search_path = public as $$
declare r public.indent_reopen_requests; i public.indents; ids uuid[];
begin
  if not public.has_role('owner') then raise exception 'Only Admin can approve this.'; end if;
  select * into r from public.indent_reopen_requests where id = p_request_id for update;
  if r.id is null or r.status <> 'pending' then raise exception 'This request is already decided.'; end if;
  update public.indent_reopen_requests set status = case when p_approve then 'approved' else 'declined' end, decided_by = auth.uid(), decided_at = now(), decision_note = left(coalesce(p_note, ''), 200) where id = r.id;
  select * into i from public.indents where id = r.indent_id;
  if p_approve then
    update public.indents set status = 'draft', submitted_by = null, submitted_at = null, reopen_until = now() + interval '60 minutes' where id = i.id;
    insert into public.indent_changes(indent_id, action, note, by_profile) values (i.id, 'approved_reopen', r.reason, auth.uid());
  end if;
  select coalesce(array_agg(profile_id), '{}') into ids from public.profile_locations where location_id = i.location_id;
  begin perform public.notify(null, ids, case when p_approve then 'Your indent is open' else 'Indent not opened' end,
    case when p_approve then 'Admin opened your indent for 1 hour. Please make your changes and send.' else 'Admin did not open the indent.' || case when coalesce(p_note, '') <> '' then ' ' || p_note else '' end end,
    '/indent?loc=' || i.location_id, 'indentreopen-' || r.id::text, p_approve);
  exception when others then null; end;
end $$;

-- The store can add to a closed indent for a counter that forgot. It is logged and the counter is told.
create or replace function public.store_edit_indent_line(p_indent_id uuid, p_item_id int, p_qty numeric, p_note text default '') returns void
language plpgsql security definer set search_path = public as $$
declare i public.indents; oldq numeric; ids uuid[];
begin
  if not public.has_role('owner', 'store') then raise exception 'Only the store can do this.'; end if;
  select * into i from public.indents where id = p_indent_id;
  if i.id is null then raise exception 'Indent not found'; end if;
  if not exists (select 1 from public.item_locations where item_id = p_item_id and location_id = i.location_id) then raise exception 'That item is not on this counter'; end if;
  select qty into oldq from public.indent_lines where indent_id = p_indent_id and item_id = p_item_id;
  if p_qty is null or p_qty <= 0 then
    delete from public.indent_lines where indent_id = p_indent_id and item_id = p_item_id;
  else
    insert into public.indent_lines(indent_id, item_id, qty, reason, entry_method) values (p_indent_id, p_item_id, p_qty, 'Added by the store', 'typed')
    on conflict (indent_id, item_id) do update set qty = excluded.qty;
  end if;
  update public.indents set nothing_needed = false where id = p_indent_id and nothing_needed and p_qty > 0;
  insert into public.indent_changes(indent_id, item_id, old_qty, new_qty, action, note, by_profile)
  values (p_indent_id, p_item_id, oldq, nullif(p_qty, 0), 'store_edit', left(coalesce(p_note, ''), 200), auth.uid());
  select coalesce(array_agg(profile_id), '{}') into ids from public.profile_locations where location_id = i.location_id;
  begin perform public.notify(null, ids, 'Store updated your indent', 'The store changed an item on your indent.', '/indent?loc=' || i.location_id, 'indentstore-' || p_indent_id::text, false);
  exception when others then null; end;
end $$;

-- ── Reminders, sealing, and the missed record (runs every 5 minutes) ─
create or replace function public.indent_finalize() returns void
language plpgsql security definer set search_path = public as $$
declare r record; fd date := public.indent_for_date(); owner_id uuid; c record; n int;
begin
  select id into owner_id from public.profiles where role = 'owner' and active limit 1;
  for r in select i.* from public.indents i where i.status in ('draft', 'submitted') and public.indent_sealed(i) loop
    if r.status = 'submitted' or r.for_date < fd then
      -- Older indents are simply closed; they are not scored.
      update public.indents set status = 'locked' where id = r.id;
    else
      select count(*) into n from public.indent_lines where indent_id = r.id;
      if n > 0 then
        update public.indents set status = 'locked', submitted_at = coalesce(submitted_at, now()), first_submitted_at = coalesce(first_submitted_at, now()),
            late = true, outcome = coalesce(outcome, 'late') where id = r.id;
        insert into public.indent_changes(indent_id, action, note) values (r.id, 'auto_sent', 'Sent as it was when the indent closed');
      elsif r.first_submitted_at is not null then
        update public.indents set status = 'locked' where id = r.id;
      else
        update public.indents set status = 'locked', outcome = 'missed' where id = r.id;
      end if;
    end if;
  end loop;
  -- Counters that never opened an indent at all.
  if now() >= (select seal_at from public.indent_times(fd)) and owner_id is not null then
    for c in select l.id from public.locations l where l.kind = 'department' and l.active
               and exists (select 1 from public.profile_locations pl join public.profiles p on p.id = pl.profile_id where pl.location_id = l.id and p.active)
               and not exists (select 1 from public.indents x where x.location_id = l.id and x.for_date = fd) loop
      insert into public.indents(location_id, for_date, status, created_by, outcome) values (c.id, fd, 'locked', owner_id, 'missed') on conflict do nothing;
    end loop;
  end if;
end $$;

create or replace function public.indent_tick() returns void
language plpgsql security definer set search_path = public as $$
declare fd date := public.indent_for_date(); t record; c record; ids uuid[]; sent boolean; missed text := ''; k int := 0;
begin
  perform public.indent_finalize();
  select * into t from public.indent_times(fd);
  for c in select l.id, l.name from public.locations l where l.kind = 'department' and l.active
             and exists (select 1 from public.profile_locations pl join public.profiles p on p.id = pl.profile_id where pl.location_id = l.id and p.active) loop
    select coalesce(array_agg(pl.profile_id), '{}') into ids from public.profile_locations pl join public.profiles p on p.id = pl.profile_id where pl.location_id = c.id and p.active;
    select exists (select 1 from public.indents x where x.location_id = c.id and x.for_date = fd and x.status in ('submitted', 'locked') and coalesce(x.outcome, '') <> 'missed') into sent;
    if not sent and now() >= t.open_at and now() < t.due_at
       and not exists (select 1 from public.indent_reminders where for_date = fd and kind = 'open' and location_id = c.id) then
      insert into public.indent_reminders values (fd, 'open', c.id) on conflict do nothing;
      begin perform public.notify(null, ids, 'Time for your indent', c.name || ': please place tomorrow''s indent. It is due by 5:00 pm.', '/indent?loc=' || c.id, 'indent-open-' || fd::text || '-' || c.id, true);
      exception when others then null; end;
    end if;
    if not sent and now() >= t.due_at and now() < t.seal_at
       and not exists (select 1 from public.indent_reminders where for_date = fd and kind = 'due' and location_id = c.id) then
      insert into public.indent_reminders values (fd, 'due', c.id) on conflict do nothing;
      begin perform public.notify(null, ids, 'Indent is late', c.name || ': the indent is late. You have until 6:00 pm, then it closes.', '/indent?loc=' || c.id, 'indent-due-' || fd::text || '-' || c.id, true);
      exception when others then null; end;
    end if;
    if exists (select 1 from public.indents x where x.location_id = c.id and x.for_date = fd and x.outcome = 'missed')
       and not exists (select 1 from public.indent_reminders where for_date = fd and kind = 'missed' and location_id = c.id) then
      insert into public.indent_reminders values (fd, 'missed', c.id) on conflict do nothing;
      missed := missed || case when missed = '' then '' else ', ' end || c.name; k := k + 1;
      begin perform public.notify(null, ids, 'Indent was missed', c.name || ': the indent closed at 6:00 pm without being sent. Please ask Admin to open it and give a reason.', '/indent?loc=' || c.id, 'indent-missed-' || fd::text || '-' || c.id, true);
      exception when others then null; end;
    end if;
  end loop;
  if k > 0 then
    select coalesce(array_agg(id), '{}') into ids from public.profiles where role = 'owner' and active;
    begin perform public.notify(null, ids, 'Missed indents', missed || ' did not send tomorrow''s indent.', '/indents', 'indent-missed-owner-' || fd::text || '-' || k::text, false);
    exception when others then null; end;
  end if;
end $$;

revoke all on function public.indent_tick(), public.indent_finalize(), public.indent_times(date), public.indent_sealed(public.indents) from public, anon, authenticated;
grant execute on function public.indent_times(date) to authenticated;
revoke all on function public.save_indent_reason(int, text, text, boolean), public.request_indent_reopen(uuid, text, text), public.decide_indent_reopen(uuid, boolean, text), public.store_edit_indent_line(uuid, int, numeric, text) from public, anon;
grant execute on function public.save_indent_reason(int, text, text, boolean), public.request_indent_reopen(uuid, text, text), public.decide_indent_reopen(uuid, boolean, text), public.store_edit_indent_line(uuid, int, numeric, text) to authenticated;

select cron.schedule('indent-tick', '*/5 * * * *', 'select public.indent_tick()');
