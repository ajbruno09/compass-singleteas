-- Petty cash management (Devid, store). The POS closing cash is handed to Devid at night. In the morning he counts and accepts it,
-- then issues the Rs 2,000 float to an Opening staff person, who accepts it in the app. Cash only comes in by receiving the closing
-- cash or by exchange for change. Everything is a signed movement of notes and coins, so cash in hand is just the sum.
-- Opening staff = duty_people duty 'opening_staff' (ticked in People). Bank slip photos use the existing bill-photos bucket under petty/.

create table if not exists public.petty_moves (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  business_date date not null,
  kind text not null check (kind in ('receive','issue','exchange','bank','owner')),
  status text not null default 'done' check (status in ('done','waiting','accepted','received')),
  delta jsonb not null,            -- signed notes and coins: + into Devid's hand, - out of it
  amount numeric not null,         -- size of the movement, always positive
  expected jsonb,                  -- receive only: what the closing said
  diff numeric not null default 0, -- receive only: counted minus expected
  reason text,
  ref text,                        -- bank slip number
  photo text,                      -- bank slip photo path (bill-photos bucket)
  to_profile uuid references public.profiles(id),
  closing_id uuid references public.daily_closings(id),
  by uuid references public.profiles(id) default auth.uid(),
  decided_at timestamptz
);
create unique index if not exists petty_one_receive on public.petty_moves (closing_id) where kind = 'receive';
create unique index if not exists petty_one_issue on public.petty_moves (business_date) where kind = 'issue';
alter table public.petty_moves enable row level security;
drop policy if exists petty_read on public.petty_moves;
create policy petty_read on public.petty_moves for select to authenticated using (public.has_role('owner','manager','store','accounts'));

-- helpers
create or replace function public.petty_total(p jsonb) returns numeric
language sql immutable as $$
  select coalesce(sum(k::numeric * v::numeric), 0) from jsonb_each_text(coalesce(p,'{}'::jsonb)) e(k, v);
$$;

create or replace function public.petty_hand() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(k, s), '{}'::jsonb)
  from (select e.key k, sum(e.value::int) s from public.petty_moves m, jsonb_each_text(m.delta) e group by e.key) t;
$$;

-- Notes and coins as a clean object: only real denominations, whole positive numbers.
create or replace function public.petty_clean(p jsonb) returns jsonb
language plpgsql immutable as $$
declare r jsonb := '{}'::jsonb; k text; v text;
begin
  for k, v in select * from jsonb_each_text(coalesce(p,'{}'::jsonb)) loop
    if k not in ('500','200','100','50','20','10','5','2','1') then raise exception 'Unknown note or coin %', k; end if;
    if v is null or v = '' or v = '0' then continue; end if;
    if v !~ '^[0-9]{1,6}$' then raise exception 'Counts must be whole numbers'; end if;
    r := r || jsonb_build_object(k, v::int);
  end loop;
  return r;
end $$;

create or replace function public.petty_check_hand(p jsonb) returns void
language plpgsql stable security definer set search_path = public as $$
declare h jsonb := public.petty_hand(); k text; v text;
begin
  for k, v in select * from jsonb_each_text(p) loop
    if v::int > coalesce((h->>k)::int, 0) then raise exception 'You do not have that many Rs %', k; end if;
  end loop;
end $$;

create or replace function public.petty_can() returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_role('owner','manager','store');
$$;

create or replace function public.petty_negate(p jsonb) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_object_agg(key, -(value)::int), '{}'::jsonb) from jsonb_each_text(coalesce(p,'{}'::jsonb));
$$;

-- Everything Devid's screen and the owner's screen need, in one call.
create or replace function public.petty_state() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_bd date := public.business_date(now());
  v_target date := public.business_date(now()) - 1;
  v_hr int := extract(hour from (now() at time zone 'Asia/Kolkata'));
  cl public.daily_closings; rcv public.petty_moves; iss public.petty_moves;
  v_closed boolean; v_late boolean := false; v_phase text;
begin
  if not public.petty_can() then raise exception 'Not allowed'; end if;
  select * into cl from public.daily_closings where business_date = v_target;
  v_closed := cl.id is not null and cl.status <> 'draft';
  if v_closed then
    v_late := cl.submitted_at is not null and cl.submitted_at > (((v_target + 1)::timestamp + interval '2 hours') at time zone 'Asia/Kolkata');
    v_phase := 'closed';
  else
    v_phase := case when v_hr >= 11 then 'overdue' else 'notyet' end;
  end if;
  select * into rcv from public.petty_moves where kind = 'receive' and closing_id = cl.id;
  select * into iss from public.petty_moves where kind = 'issue' and business_date = v_bd;
  return jsonb_build_object(
    'hand', public.petty_hand(), 'total', public.petty_total(public.petty_hand()), 'float', 2000,
    'business_date', v_bd, 'target', v_target, 'phase', v_phase, 'late', v_late,
    'closing', case when not v_closed then null else jsonb_build_object(
      'id', cl.id, 'submitted_at', cl.submitted_at,
      'by', (select full_name from public.profiles where id = cl.submitted_by),
      'expected', public.petty_clean(cl.data->'n'), 'total', public.petty_total(public.petty_clean(cl.data->'n'))) end,
    'received', case when rcv.id is null then null else jsonb_build_object('at', rcv.created_at, 'diff', rcv.diff, 'reason', rcv.reason) end,
    'issued', case when iss.id is null then null else jsonb_build_object('id', iss.id, 'to', (select full_name from public.profiles where id = iss.to_profile), 'status', iss.status, 'at', iss.created_at, 'den', public.petty_negate(iss.delta)) end,
    'opening', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name) order by p.full_name), '[]'::jsonb)
                from public.duty_people d join public.profiles p on p.id = d.profile_id where d.duty = 'opening_staff' and p.active),
    'ledger', (select coalesce(jsonb_agg(x order by x->>'at' desc), '[]'::jsonb) from (
       select jsonb_build_object('id', m.id, 'at', m.created_at, 'kind', m.kind, 'status', m.status, 'amount', m.amount, 'diff', m.diff, 'reason', m.reason, 'ref', m.ref,
         'photo', m.photo, 'to', (select full_name from public.profiles where id = m.to_profile), 'delta', m.delta) x
       from public.petty_moves m order by m.created_at desc limit 40) q)
  );
end $$;

-- Morning: Devid counts the closing cash and accepts it.
create or replace function public.petty_receive(p_counted jsonb, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_target date := public.business_date(now()) - 1; cl public.daily_closings; c jsonb := public.petty_clean(p_counted);
  e jsonb; v_diff numeric; v_match boolean; v_name text;
begin
  if not public.petty_can() then raise exception 'Not allowed'; end if;
  select * into cl from public.daily_closings where business_date = v_target;
  if cl.id is null or cl.status = 'draft' then raise exception 'The POS closing has not been submitted yet'; end if;
  if exists (select 1 from public.petty_moves where kind = 'receive' and closing_id = cl.id) then raise exception 'Already accepted'; end if;
  e := public.petty_clean(cl.data->'n');
  v_diff := public.petty_total(c) - public.petty_total(e);
  v_match := c = e;
  if not v_match and nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'Add a reason for the difference'; end if;
  insert into public.petty_moves (business_date, kind, status, delta, amount, expected, diff, reason, closing_id)
    values (public.business_date(now()), 'receive', 'done', c, public.petty_total(c), e, v_diff, nullif(trim(coalesce(p_reason,'')),''), cl.id);
  if not v_match then
    select full_name into v_name from public.profiles where id = auth.uid();
    perform public.raise_alert('urgent', 'Petty cash: closing cash does not match',
      coalesce(v_name,'Devid') || ' counted ' || public.petty_total(c) || ' for the ' || to_char(v_target,'DD Mon') || ' closing, which said ' || public.petty_total(e) || '. Reason: ' || trim(p_reason), array['owner'], null, 'petty');
  end if;
  return jsonb_build_object('ok', true, 'diff', v_diff);
end $$;

-- Morning: Devid issues the Rs 2,000 float to an Opening staff person.
create or replace function public.petty_issue(p_to uuid, p_den jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_bd date := public.business_date(now()); v_target date := public.business_date(now()) - 1; cl public.daily_closings;
  d jsonb := public.petty_clean(p_den); v_id uuid;
begin
  if not public.petty_can() then raise exception 'Not allowed'; end if;
  select * into cl from public.daily_closings where business_date = v_target;
  if cl.id is null or cl.status = 'draft' then raise exception 'The POS closing is not done yet. The float can be issued only after it'; end if;
  if not exists (select 1 from public.petty_moves where kind = 'receive' and closing_id = cl.id) then raise exception 'Accept the POS closing cash first'; end if;
  if exists (select 1 from public.petty_moves where kind = 'issue' and business_date = v_bd) then raise exception 'Today''s float is already issued'; end if;
  if not exists (select 1 from public.duty_people dp join public.profiles p on p.id = dp.profile_id where dp.duty = 'opening_staff' and dp.profile_id = p_to and p.active) then raise exception 'That person is not opening staff'; end if;
  if coalesce((d->>'500')::int,0) > 0 then raise exception 'Rs 500 notes are not issued to the counter'; end if;
  if public.petty_total(d) <> 2000 then raise exception 'The float must be exactly Rs 2,000'; end if;
  perform public.petty_check_hand(d);
  insert into public.petty_moves (business_date, kind, status, delta, amount, to_profile)
    values (v_bd, 'issue', 'waiting', public.petty_negate(d), 2000, p_to) returning id into v_id;
  insert into public.notices (title, body, pinned, profile_ids, expires_at)
    values ('Petty cash waiting for you', 'Devid has issued Rs 2,000 for the counter. Count it and tap Accepted in Petty cash received.', true, array[p_to], now() + interval '1 day');
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- Opening staff: what was issued to me today, and accepting it.
create or replace function public.petty_mine() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_bd date := public.business_date(now()); iss public.petty_moves;
begin
  if not exists (select 1 from public.duty_people where duty = 'opening_staff' and profile_id = auth.uid()) then raise exception 'Not allowed'; end if;
  select * into iss from public.petty_moves where kind = 'issue' and business_date = v_bd and to_profile = auth.uid();
  return jsonb_build_object('business_date', v_bd,
    'today', case when iss.id is null then null else jsonb_build_object('id', iss.id, 'status', iss.status, 'amount', iss.amount, 'den', public.petty_negate(iss.delta), 'at', iss.created_at, 'accepted_at', iss.decided_at) end,
    'history', (select coalesce(jsonb_agg(jsonb_build_object('date', m.business_date, 'amount', m.amount, 'status', m.status) order by m.business_date desc), '[]'::jsonb)
                from (select * from public.petty_moves where kind = 'issue' and to_profile = auth.uid() order by business_date desc limit 7) m));
end $$;

create or replace function public.petty_accept_float(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m public.petty_moves;
begin
  select * into m from public.petty_moves where id = p_id and kind = 'issue' for update;
  if m.id is null or m.to_profile <> auth.uid() then raise exception 'Not allowed'; end if;
  if m.status <> 'waiting' then raise exception 'Already accepted'; end if;
  update public.petty_moves set status = 'accepted', decided_at = now() where id = m.id;
  return jsonb_build_object('ok', true);
end $$;

-- The float for the day, to fill question 9 (opening cash) in the POS closing.
create or replace function public.petty_float_today() returns numeric
language sql stable security definer set search_path = public as $$
  select m.amount from public.petty_moves m
  where m.kind = 'issue' and m.status = 'accepted' and m.business_date = public.business_date(now()) and public.closing_can_do();
$$;

-- Exchange: give notes, get smaller notes. Totals must be equal.
create or replace function public.petty_exchange(p_give jsonb, p_get jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g jsonb := public.petty_clean(p_give); t jsonb := public.petty_clean(p_get); dl jsonb := '{}'::jsonb; k text;
begin
  if not public.petty_can() then raise exception 'Not allowed'; end if;
  if public.petty_total(g) <= 0 or public.petty_total(g) <> public.petty_total(t) then raise exception 'What you give and what you get must be equal'; end if;
  perform public.petty_check_hand(g);
  for k in select distinct key from (select key from jsonb_each(g) union select key from jsonb_each(t)) u loop
    dl := dl || jsonb_build_object(k, coalesce((t->>k)::int,0) - coalesce((g->>k)::int,0));
  end loop;
  insert into public.petty_moves (business_date, kind, delta, amount) values (public.business_date(now()), 'exchange', dl, public.petty_total(g));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.petty_bank(p_den jsonb, p_slip text, p_photo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d jsonb := public.petty_clean(p_den);
begin
  if not public.petty_can() then raise exception 'Not allowed'; end if;
  if public.petty_total(d) <= 0 then raise exception 'Enter the notes and coins'; end if;
  if nullif(trim(coalesce(p_slip,'')),'') is null then raise exception 'Add the bank slip number'; end if;
  if nullif(trim(coalesce(p_photo,'')),'') is null then raise exception 'Add a photo of the deposit slip'; end if;
  perform public.petty_check_hand(d);
  insert into public.petty_moves (business_date, kind, delta, amount, ref, photo)
    values (public.business_date(now()), 'bank', public.petty_negate(d), public.petty_total(d), trim(p_slip), p_photo);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.petty_handover(p_den jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d jsonb := public.petty_clean(p_den); v_name text;
begin
  if not public.petty_can() then raise exception 'Not allowed'; end if;
  if public.petty_total(d) <= 0 then raise exception 'Enter the notes and coins'; end if;
  perform public.petty_check_hand(d);
  insert into public.petty_moves (business_date, kind, status, delta, amount)
    values (public.business_date(now()), 'owner', 'waiting', public.petty_negate(d), public.petty_total(d));
  select full_name into v_name from public.profiles where id = auth.uid();
  perform public.raise_alert('today', 'Petty cash handed to you', coalesce(v_name,'Devid') || ' handed over ' || public.petty_total(d) || '. Count it and tap Received in Petty cash.', array['owner'], null, 'petty');
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.petty_owner_confirm(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role('owner','manager') then raise exception 'Not allowed'; end if;
  update public.petty_moves set status = 'received', decided_at = now() where id = p_id and kind = 'owner' and status = 'waiting';
  if not found then raise exception 'Nothing to confirm'; end if;
  return jsonb_build_object('ok', true);
end $$;

-- 2:00 AM and 11:00 AM IST: if last night's POS closing is not submitted, tell the owner and the store.
create or replace function public.petty_pos_alert(p_level int) returns void
language plpgsql security definer set search_path = public as $$
declare v_target date := (now() at time zone 'Asia/Kolkata')::date - 1;
begin
  if exists (select 1 from public.daily_closings where business_date = v_target and status <> 'draft') then return; end if;
  if p_level = 1 then
    perform public.raise_alert('urgent', 'POS closing not done', 'The POS closing for ' || to_char(v_target,'DD Mon') || ' was not done by 2:00 AM. Please inform the manager to get it closed. It must be done before 11:00 AM.', array['owner','store'], null, 'pos-closing');
  else
    perform public.raise_alert('urgent', 'POS closing still not done', 'It is past 11:00 AM and the POS closing for ' || to_char(v_target,'DD Mon') || ' is still not done. The float cannot be issued until it is closed.', array['owner','store'], null, 'pos-closing');
  end if;
end $$;
