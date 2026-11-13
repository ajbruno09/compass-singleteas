-- Compass 5.118: finish today's ordering, store scorecard, team usage time.
create table if not exists public.buy_day_state (for_date date primary key, undecided integer not null default 0, updated_at timestamptz not null default now(), updated_by uuid);
create table if not exists public.buy_day_close (for_date date primary key, closed_by uuid, closed_at timestamptz not null default now());
alter table public.buy_day_state enable row level security;
alter table public.buy_day_close enable row level security;

create or replace function public.buy_report_undecided(p_date date, p_n integer) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_role('owner','manager','store') then raise exception 'Not allowed.'; end if;
  insert into buy_day_state(for_date, undecided, updated_by) values (p_date, greatest(coalesce(p_n,0),0), auth.uid())
    on conflict (for_date) do update set undecided = excluded.undecided, updated_at = now(), updated_by = auth.uid();
  if coalesce(p_n,0) > 0 then delete from buy_day_close where for_date = p_date; end if;
end $$;

create or replace function public.buy_finish_day(p_date date) returns void
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not has_role('owner','manager','store') then raise exception 'Not allowed.'; end if;
  select undecided into n from buy_day_state where for_date = p_date;
  if coalesce(n,0) > 0 then raise exception '% items still need a decision.', n; end if;
  insert into buy_day_close(for_date, closed_by) values (p_date, auth.uid()) on conflict (for_date) do nothing;
end $$;

create table if not exists public.usage_minutes (user_id uuid not null, day date not null, minute smallint not null, primary key (user_id, day, minute));
alter table public.usage_minutes enable row level security;

create or replace function public.usage_ping() returns void
language plpgsql security definer set search_path = public as $$
declare t timestamp := now() at time zone 'Asia/Kolkata';
begin
  if auth.uid() is null then return; end if;
  insert into usage_minutes(user_id, day, minute) values (auth.uid(), t::date, (extract(hour from t)*60 + extract(minute from t))::smallint) on conflict do nothing;
end $$;

create or replace function public.usage_summary(p_days integer) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare bd date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if not has_role('owner') then raise exception 'Only the owner can see this.'; end if;
  return coalesce((select jsonb_agg(x order by (x->>'minutes')::int desc) from (
    select jsonb_build_object('id', p.id, 'name', p.full_name, 'role', p.role,
      'minutes', coalesce(u.m,0), 'days', coalesce(u.d,0), 'last', u.last) x
    from profiles p
    left join lateral (select count(*) m, count(distinct day) d, (max(day::timestamp + minute * interval '1 minute')) at time zone 'Asia/Kolkata' last
                       from usage_minutes um where um.user_id = p.id and um.day > bd - greatest(p_days,1)) u on true
    where p.active) q), '[]'::jsonb);
end $$;

-- One day of the store scorecard. Dots: y done, n missed, p still open today, h nothing to measure.
create or replace function public._sc_day(d date, fd date, start_d date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  n_sent int; n_issued int; lines int; l_ok int; l_short int; l_over int;
  po_tot int; po_wait int; rc_tot int; rc_miss int;
  s_served text; s_right text; s_del text; s_dec text; s_cnt text; s_bill text;
begin
  if d < start_d then
    return jsonb_build_object('d', d, 'served','h','right','h','deliveries','h','decided','h','counted','h','bills','h','lines',0,'ok',0,'short',0,'over',0);
  end if;
  with sent as (
    select i.location_id loc from indents i
    where i.for_date = d and i.status in ('submitted','locked') and not coalesce(i.nothing_needed,false)
      and exists (select 1 from indent_lines l where l.indent_id = i.id and l.qty > 0) group by 1)
  select count(*), count(*) filter (where exists (select 1 from issues s where s.to_location_id = sent.loc and s.status in ('submitted','locked') and coalesce(s.for_date, (s.issued_at at time zone 'Asia/Kolkata')::date) = d))
    into n_sent, n_issued from sent;
  s_served := case when n_sent = 0 then 'h' when n_issued = n_sent then 'y' when d >= fd then 'p' else 'n' end;

  with asked as (
    select i.location_id loc, l.item_id, sum(l.qty) q from indents i join indent_lines l on l.indent_id = i.id
    where i.for_date = d and i.status in ('submitted','locked') and not coalesce(i.nothing_needed,false) group by 1,2),
  given as (
    select s.to_location_id loc, il.item_id, sum(il.qty_issued) q from issues s join issue_lines il on il.issue_id = s.id
    where s.status in ('submitted','locked') and coalesce(s.for_date, (s.issued_at at time zone 'Asia/Kolkata')::date) = d group by 1,2),
  j as (
    select coalesce(a.loc, g.loc) loc, coalesce(a.item_id, g.item_id) item, coalesce(a.q,0) asked, coalesce(g.q,0) given
    from asked a full join given g on a.loc = g.loc and a.item_id = g.item_id),
  k as (
    select case when asked = 0 and given > 0 then 'over' when asked > 0 and given < asked*0.9 - 1e-9 then 'short' when given > asked*1.1 + 1e-9 then 'over' else 'ok' end kind
    from j where (asked > 0 or given > 0) and exists (select 1 from given gg where gg.loc = j.loc))
  select count(*), count(*) filter (where kind='ok'), count(*) filter (where kind='short'), count(*) filter (where kind='over') into lines, l_ok, l_short, l_over from k;
  s_right := case when lines = 0 then 'h' when l_ok::numeric / lines >= 0.9 then 'y' else 'n' end;

  select count(*), count(*) filter (where status in ('sent','partly_received')) into po_tot, po_wait from purchase_orders
    where not coalesce(party,false) and status <> 'cancelled' and coalesce(for_date, required_date, order_date) = d;
  s_del := case when po_tot = 0 then 'h' when po_wait = 0 then 'y' when d >= fd then 'p' else 'n' end;

  s_dec := case when exists (select 1 from buy_day_close c where c.for_date = d) then 'y' when d >= fd then 'p' else 'n' end;
  s_cnt := case when exists (select 1 from stock_counts c where c.location_id = 1 and c.business_date = d and c.status in ('submitted','locked')) then 'y' when d >= fd then 'p' else 'n' end;

  select count(*), count(*) filter (where coalesce(g.bill_later,false) or (g.bill_number is null and g.bill_photo_path is null and g.bill_paths is null)) into rc_tot, rc_miss
    from goods_receipts g where (g.received_at at time zone 'Asia/Kolkata')::date = d;
  s_bill := case when rc_tot = 0 then 'h' when rc_miss = 0 then 'y' when d >= fd then 'p' else 'n' end;

  return jsonb_build_object('d', d, 'served', s_served, 'right', s_right, 'deliveries', s_del, 'decided', s_dec, 'counted', s_cnt, 'bills', s_bill, 'lines', lines, 'ok', l_ok, 'short', l_short, 'over', l_over);
end $$;

create or replace function public.store_scorecard() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  bd date := business_date(now()); fd date; start_d date := date '2026-11-14';
  days jsonb := '[]'::jsonb; x jsonb; d date; job text; y int := 0; n int := 0; lost jsonb := '[]'::jsonb; jn int;
  jobs text[] := array['served','right','deliveries','decided','counted','bills'];
  items jsonb; st jsonb; undec int; closed boolean; streak int := 0; cur boolean := true;
begin
  if not has_role('owner','manager','store') then raise exception 'No access'; end if;
  begin fd := indent_for_date(); exception when others then fd := bd; end;
  if fd is null then fd := bd; end if;
  for d in select (fd - i) from generate_series(6, 0, -1) i loop
    days := days || _sc_day(d, fd, start_d);
  end loop;
  for x in select e from jsonb_array_elements(days) e loop
    foreach job in array jobs loop
      if x->>job = 'y' then y := y + 1; elsif x->>job = 'n' then n := n + 1; end if;
    end loop;
  end loop;
  if y + n > 0 then
    foreach job in array jobs loop
      select count(*) into jn from jsonb_array_elements(days) e where e->>job = 'n';
      if jn > 0 then lost := lost || jsonb_build_object('job', job, 'times', jn, 'points', round(jn * 100.0 / (y + n))); end if;
    end loop;
  end if;
  -- days in a row (ending yesterday or today) that the counters were served
  for x in select e from jsonb_array_elements(days) e order by e->>'d' desc loop
    if x->>'served' = 'y' and cur then streak := streak + 1;
    elsif x->>'served' = 'p' or x->>'served' = 'h' then null;
    else cur := false; end if;
  end loop;
  -- today's line by line detail
  select coalesce(jsonb_agg(z order by (z->>'kind') <> 'ok', z->>'item'), '[]'::jsonb) into items from (
    with asked as (
      select i.location_id loc, l.item_id, sum(l.qty) q from indents i join indent_lines l on l.indent_id = i.id
      where i.for_date = fd and i.status in ('submitted','locked') and not coalesce(i.nothing_needed,false) group by 1,2),
    given as (
      select s.to_location_id loc, il.item_id, sum(il.qty_issued) q from issues s join issue_lines il on il.issue_id = s.id
      where s.status in ('submitted','locked') and coalesce(s.for_date, (s.issued_at at time zone 'Asia/Kolkata')::date) = fd group by 1,2),
    j as (select coalesce(a.loc, g.loc) loc, coalesce(a.item_id, g.item_id) item_id, coalesce(a.q,0) asked, coalesce(g.q,0) given
          from asked a full join given g on a.loc = g.loc and a.item_id = g.item_id)
    select jsonb_build_object('item', it.name, 'unit', it.unit, 'counter', lo.name, 'asked', j.asked, 'given', j.given,
      'kind', case when j.asked = 0 and j.given > 0 then 'over' when j.asked > 0 and j.given < j.asked*0.9 - 1e-9 then 'short' when j.given > j.asked*1.1 + 1e-9 then 'over' else 'ok' end) z
    from j join items it on it.id = j.item_id join locations lo on lo.id = j.loc
    where (j.asked > 0 or j.given > 0) and exists (select 1 from given gg where gg.loc = j.loc) limit 80) q;
  select undecided into undec from buy_day_state where for_date = fd;
  closed := exists (select 1 from buy_day_close where for_date = fd);
  return jsonb_build_object('start', start_d, 'for_date', fd, 'days', days, 'score', case when y + n > 0 then round(y * 100.0 / (y + n)) else null end, 'lost', lost, 'streak', streak,
    'undecided', undec, 'closed', closed, 'items', items);
end $$;

-- NOTE: the revoke and grant lines for these functions are waiting for the owner's yes, so they are not applied yet.
