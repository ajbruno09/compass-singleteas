-- Compass 5.0: only counters that have items and people are expected to indent; and tonight's transition is not scored.
update public.indents set outcome = null, late = false, missed_reason = null
 where for_date = '2026-11-07' and (outcome = 'missed' or (outcome = 'late' and late));
delete from public.indent_reminders where for_date = '2026-11-07';

create or replace function public.indent_expected_counters() returns table (id smallint, name text)
language sql stable security definer set search_path = public as $$
  select l.id, l.name from public.locations l
   where l.kind = 'department' and l.active
     and exists (select 1 from public.item_locations il where il.location_id = l.id)
     and exists (select 1 from public.profile_locations pl join public.profiles p on p.id = pl.profile_id where pl.location_id = l.id and p.active)
$$;
revoke all on function public.indent_expected_counters() from public, anon, authenticated;

create or replace function public.indent_finalize() returns void
language plpgsql security definer set search_path = public as $$
declare r record; fd date := public.indent_for_date(); owner_id uuid; c record; n int;
begin
  select id into owner_id from public.profiles where role = 'owner' and active limit 1;
  for r in select i.* from public.indents i where i.status in ('draft', 'submitted') and public.indent_sealed(i) loop
    if r.status = 'submitted' or r.for_date < fd then
      update public.indents set status = 'locked' where id = r.id;
    else
      select count(*) into n from public.indent_lines where indent_id = r.id;
      if n > 0 then
        update public.indents set status = 'locked', submitted_at = coalesce(submitted_at, now()), first_submitted_at = coalesce(first_submitted_at, now()),
            late = true, outcome = coalesce(outcome, 'late') where id = r.id;
        insert into public.indent_changes(indent_id, action, note) values (r.id, 'auto_sent', 'Sent as it was when the indent closed');
      elsif r.first_submitted_at is not null then
        update public.indents set status = 'locked' where id = r.id;
      elsif exists (select 1 from public.indent_expected_counters() e where e.id = r.location_id) then
        update public.indents set status = 'locked', outcome = 'missed' where id = r.id;
      else
        update public.indents set status = 'locked' where id = r.id;
      end if;
    end if;
  end loop;
  if now() >= (select seal_at from public.indent_times(fd)) and owner_id is not null then
    for c in select e.id from public.indent_expected_counters() e
              where not exists (select 1 from public.indents x where x.location_id = e.id and x.for_date = fd) loop
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
  for c in select e.id, e.name from public.indent_expected_counters() e loop
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
revoke all on function public.indent_tick(), public.indent_finalize() from public, anon, authenticated;
