-- Outstanding bills register, receipts, and the POS dashboard. Owner (J) uses these three screens; the data fills itself from each submitted closing.
-- Imported once from the old Daily Closing app on 27 Nov 2026 (32 bills, 2 unmatched receipts).

create table if not exists public.outstanding_bills (
  id uuid primary key default gen_random_uuid(),
  old_ref text,
  bill_no text,
  bill_date date not null,
  category text not null check (category in ('Customer Due','Proximus Room')),
  customer text, phone text, reason text,
  original numeric not null default 0,
  verified boolean not null default false, verified_at timestamptz, verified_by uuid references public.profiles(id),
  closed boolean not null default false, closed_at timestamptz,
  closing_id uuid references public.daily_closings(id) on delete set null,
  src text, idx int,
  created_at timestamptz not null default now()
);
create unique index if not exists outstanding_bills_row on public.outstanding_bills (closing_id, src, idx) where closing_id is not null;
create table if not exists public.bill_receipts (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid references public.outstanding_bills(id) on delete cascade,
  closing_id uuid references public.daily_closings(id) on delete set null,
  idx int,
  receipt_date date not null,
  amount numeric not null,
  method text,
  by_name text,
  allocated_at timestamptz, allocated_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create unique index if not exists bill_receipts_row on public.bill_receipts (closing_id, idx) where closing_id is not null;
alter table public.outstanding_bills enable row level security;
alter table public.bill_receipts enable row level security;
drop policy if exists bills_read on public.outstanding_bills;
create policy bills_read on public.outstanding_bills for select to authenticated using (public.has_role('owner','manager','accounts'));
drop policy if exists receipts_read on public.bill_receipts;
create policy receipts_read on public.bill_receipts for select to authenticated using (public.has_role('owner','manager','accounts'));

-- Fill the register from a submitted closing: room charges and customer dues become bills; older bill payments become receipts.
create or replace function public.bills_sync(p_closing uuid, p_data jsonb, p_bd date) returns void
language plpgsql security definer set search_path = public as $$
declare r record; v_name text; v_bill uuid;
begin
  select p.full_name into v_name from public.daily_closings c left join public.profiles p on p.id = c.submitted_by where c.id = p_closing;
  -- bills entered tonight
  delete from public.outstanding_bills b where b.closing_id = p_closing and b.src = 'dues'
    and not exists (select 1 from public.bill_receipts x where x.bill_id = b.id)
    and b.idx >= coalesce(jsonb_array_length(case when coalesce((p_data->>'dueYes')::boolean,false) then p_data->'dues' else '[]'::jsonb end), 0);
  delete from public.outstanding_bills b where b.closing_id = p_closing and b.src = 'rooms'
    and not exists (select 1 from public.bill_receipts x where x.bill_id = b.id)
    and b.idx >= coalesce(jsonb_array_length(case when coalesce((p_data->>'roomYes')::boolean,false) then p_data->'rooms' else '[]'::jsonb end), 0);
  if coalesce((p_data->>'dueYes')::boolean,false) then
    for r in select e.value v, (e.ord - 1)::int i from jsonb_array_elements(coalesce(p_data->'dues','[]'::jsonb)) with ordinality e(value, ord) loop
      insert into public.outstanding_bills (bill_no, bill_date, category, customer, phone, reason, original, closing_id, src, idx)
      values (nullif(r.v->>'bill',''), p_bd, 'Customer Due', nullif(r.v->>'name',''), nullif(r.v->>'phone',''), nullif(r.v->>'why',''), coalesce(nullif(r.v->>'amt','')::numeric,0), p_closing, 'dues', r.i)
      on conflict (closing_id, src, idx) where closing_id is not null do update
        set bill_no = excluded.bill_no, customer = excluded.customer, phone = excluded.phone, reason = excluded.reason, original = excluded.original;
    end loop;
  end if;
  if coalesce((p_data->>'roomYes')::boolean,false) then
    for r in select e.value v, (e.ord - 1)::int i from jsonb_array_elements(coalesce(p_data->'rooms','[]'::jsonb)) with ordinality e(value, ord) loop
      insert into public.outstanding_bills (bill_no, bill_date, category, customer, original, closing_id, src, idx)
      values (nullif(r.v->>'bill',''), p_bd, 'Proximus Room', case when nullif(r.v->>'room','') is null then null else 'Room ' || (r.v->>'room') end, coalesce(nullif(r.v->>'amt','')::numeric,0), p_closing, 'rooms', r.i)
      on conflict (closing_id, src, idx) where closing_id is not null do update
        set bill_no = excluded.bill_no, customer = excluded.customer, original = excluded.original;
    end loop;
  end if;
  -- payments on older bills
  delete from public.bill_receipts x where x.closing_id = p_closing
    and x.idx >= coalesce(jsonb_array_length(case when coalesce((p_data->>'oldYes')::boolean,false) then p_data->'olds' else '[]'::jsonb end), 0);
  if coalesce((p_data->>'oldYes')::boolean,false) then
    for r in select e.value v, (e.ord - 1)::int i from jsonb_array_elements(coalesce(p_data->'olds','[]'::jsonb)) with ordinality e(value, ord) loop
      v_bill := null;
      if nullif(r.v->>'bid','') is not null then select id into v_bill from public.outstanding_bills where id = (r.v->>'bid')::uuid; end if;
      insert into public.bill_receipts (bill_id, closing_id, idx, receipt_date, amount, method, by_name, allocated_at)
      values (v_bill, p_closing, r.i, p_bd, coalesce(nullif(r.v->>'amt','')::numeric,0), nullif(r.v->>'method',''), v_name, case when v_bill is null then null else now() end)
      on conflict (closing_id, idx) where closing_id is not null do update
        set amount = excluded.amount, method = excluded.method,
            bill_id = coalesce(excluded.bill_id, public.bill_receipts.bill_id),
            allocated_at = case when coalesce(excluded.bill_id, public.bill_receipts.bill_id) is null then null else coalesce(public.bill_receipts.allocated_at, now()) end;
    end loop;
  end if;
end $$;

-- closing_submit from 0040, plus the register fill.
create or replace function public.closing_submit(p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_bd date := public.business_date(now()); r public.daily_closings; c jsonb; v_name text;
begin
  if not public.closing_can_do() then raise exception 'Not allowed'; end if;
  c := public.closing_calc(p_data);
  select full_name into v_name from public.profiles where id = auth.uid();
  select * into r from public.daily_closings where business_date = v_bd for update;
  if r.id is not null and r.status not in ('draft','reopened') then raise exception 'This report is already submitted'; end if;
  if r.id is null then
    insert into public.daily_closings (business_date, created_by) values (v_bd, auth.uid()) returning * into r;
  end if;
  update public.daily_closings set
    data = p_data, status = 'submitted', submitted_by = auth.uid(), submitted_at = now(),
    pos_total = coalesce(nullif(p_data->>'pos','')::numeric,0),
    digital_var = (c->>'digital')::numeric, cash_var = (c->>'cash')::numeric, combined_var = (c->>'combined')::numeric, closing_cash = (c->>'closing')::numeric,
    reopen_reason = null, updated_at = now(),
    events = events || jsonb_build_array(jsonb_build_object('at', now(), 'by', v_name, 'what', case when r.status = 'reopened' then 'Resubmitted' else 'Submitted' end))
  where id = r.id;
  perform public.bills_sync(r.id, p_data, v_bd);
  return jsonb_build_object('ok', true, 'digital', c->'digital', 'cash', c->'cash', 'combined', c->'combined');
end $$;

create or replace function public.bill_status(p_orig numeric, p_col numeric, p_ver boolean, p_closed boolean) returns text
language sql immutable as $$
  select case when p_closed then 'Closed' when p_ver then 'Verified' when p_orig = 0 then 'Open' when p_col >= p_orig then 'Fully Paid' when p_col > 0 then 'Partial' else 'Open' end;
$$;

create or replace function public.bills_list() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_role('owner','manager','accounts') then raise exception 'Not allowed'; end if;
  return jsonb_build_object(
    'bills', (select coalesce(jsonb_agg(x order by x->>'date' desc, x->>'no' desc), '[]'::jsonb) from (
      select jsonb_build_object('id', b.id, 'ref', coalesce(b.old_ref, upper(left(b.id::text, 8))), 'no', b.bill_no, 'date', b.bill_date, 'cat', b.category, 'who', b.customer, 'phone', b.phone,
        'orig', b.original, 'col', coalesce(c.s,0), 'bal', b.original - coalesce(c.s,0),
        'status', public.bill_status(b.original, coalesce(c.s,0), b.verified, b.closed)) x
      from public.outstanding_bills b
      left join (select bill_id, sum(amount) s from public.bill_receipts where bill_id is not null group by bill_id) c on c.bill_id = b.id) q),
    'unmatched', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'date', r.receipt_date, 'by', r.by_name, 'amount', r.amount, 'method', r.method) order by r.receipt_date desc), '[]'::jsonb)
      from public.bill_receipts r where r.bill_id is null));
end $$;

create or replace function public.bills_open() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.closing_can_do() or public.has_role('owner','manager','accounts')) then raise exception 'Not allowed'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'no', b.bill_no, 'who', b.customer, 'date', b.bill_date, 'bal', b.original - coalesce(c.s,0)) order by b.bill_date desc), '[]'::jsonb)
    from public.outstanding_bills b
    left join (select bill_id, sum(amount) s from public.bill_receipts where bill_id is not null group by bill_id) c on c.bill_id = b.id
    where not b.closed and not b.verified and b.original - coalesce(c.s,0) > 0);
end $$;

create or replace function public.bills_verify(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b public.outstanding_bills; v_col numeric;
begin
  if not public.has_role('owner','manager','accounts') then raise exception 'Not allowed'; end if;
  select * into b from public.outstanding_bills where id = p_id for update;
  select coalesce(sum(amount),0) into v_col from public.bill_receipts where bill_id = p_id;
  if b.id is null or b.verified or b.closed or b.original = 0 or v_col < b.original then raise exception 'Only a fully paid bill can be verified'; end if;
  update public.outstanding_bills set verified = true, verified_at = now(), verified_by = auth.uid() where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.bills_close(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role('owner','manager','accounts') then raise exception 'Not allowed'; end if;
  update public.outstanding_bills set closed = true, closed_at = now() where id = p_id and verified and not closed;
  if not found then raise exception 'Only a verified bill can be closed'; end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.bills_allocate(p_receipt uuid, p_bill uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.bill_receipts; b public.outstanding_bills; v_col numeric;
begin
  if not public.has_role('owner','manager','accounts') then raise exception 'Not allowed'; end if;
  select * into r from public.bill_receipts where id = p_receipt for update;
  if r.id is null or r.bill_id is not null then raise exception 'This receipt is already allocated'; end if;
  select * into b from public.outstanding_bills where id = p_bill for update;
  if b.id is null or b.closed or b.verified then raise exception 'Choose an open bill'; end if;
  select coalesce(sum(amount),0) into v_col from public.bill_receipts where bill_id = p_bill;
  if r.amount > b.original - v_col then raise exception 'That bill owes less than this receipt'; end if;
  update public.bill_receipts set bill_id = p_bill, allocated_at = now(), allocated_by = auth.uid() where id = p_receipt;
  return jsonb_build_object('ok', true);
end $$;

-- POS Dashboard: today, last 7 closings, recent reports, this month's pipeline.
create or replace function public.pos_dashboard() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_bd date := public.business_date(now()); t public.daily_closings; v_m date := date_trunc('month', public.business_date(now()))::date;
begin
  if not public.has_role('owner','manager','accounts') then raise exception 'Not allowed'; end if;
  select * into t from public.daily_closings where business_date = v_bd and status <> 'draft';
  return jsonb_build_object(
    'business_date', v_bd,
    'today', case when t.id is null then null else jsonb_build_object('total', t.pos_total,
      'cash', coalesce(nullif(t.data->>'cash','')::numeric,0),
      'digital', coalesce(nullif(t.data->>'card','')::numeric,0) + coalesce(nullif(t.data->>'upi','')::numeric,0) + coalesce(nullif(t.data->>'qr','')::numeric,0),
      'online', coalesce(nullif(t.data->>'online','')::numeric,0), 'cash_var', t.cash_var, 'digital_var', t.digital_var, 'combined', t.combined_var) end,
    'flagged', (select count(*) from public.daily_closings where status = 'flagged'),
    'trend', (select coalesce(jsonb_agg(x order by x->>'date'), '[]'::jsonb) from (
      select jsonb_build_object('date', d.business_date, 'total', d.pos_total, 'combined', d.combined_var,
        'cash', coalesce(nullif(d.data->>'cash','')::numeric,0),
        'digital', coalesce(nullif(d.data->>'card','')::numeric,0) + coalesce(nullif(d.data->>'upi','')::numeric,0) + coalesce(nullif(d.data->>'qr','')::numeric,0),
        'online', coalesce(nullif(d.data->>'online','')::numeric,0)) x
      from public.daily_closings d where d.status <> 'draft' and d.business_date < v_bd order by d.business_date desc limit 7) q),
    'recent', (select coalesce(jsonb_agg(x order by x->>'date' desc), '[]'::jsonb) from (
      select jsonb_build_object('id', d.id, 'date', d.business_date, 'by', (select full_name from public.profiles where id = d.submitted_by), 'at', d.submitted_at,
        'total', d.pos_total, 'cash_var', d.cash_var, 'digital_var', d.digital_var, 'combined', d.combined_var, 'status', d.status,
        'late', d.submitted_at > (((d.business_date + 1)::timestamp + interval '2 hours') at time zone 'Asia/Kolkata')) x
      from public.daily_closings d where d.status <> 'draft' order by d.business_date desc limit 8) q),
    'pipeline', jsonb_build_object(
      'verified', (select count(*) from public.daily_closings where business_date >= v_m and status = 'verified'),
      'review', (select count(*) from public.daily_closings where business_date >= v_m and status in ('submitted','reopen_requested','reopened')),
      'flagged', (select count(*) from public.daily_closings where business_date >= v_m and status = 'flagged'),
      'draft', (select count(*) from public.daily_closings where business_date >= v_m and status = 'draft'),
      'total', (select count(*) from public.daily_closings where business_date >= v_m)));
end $$;

-- One-time import from the old app (27 Nov 2026).
insert into public.outstanding_bills (old_ref, bill_no, bill_date, category, customer, phone, original)
select v.* from (values
 ('1900A785','35451','2026-11-26'::date,'Customer Due','Manjunath','9844544447',50),
 ('DD3D96DE',null,'2026-11-26','Customer Due',null,null,0),
 ('06F9A0B7','35121','2026-11-24','Customer Due','Mr,Manjunath','9844544447',135),
 ('403E6456','35071','2026-11-24','Customer Due','arthi','9560297130',256),
 ('AA7A40C3','35071','2026-11-24','Proximus Room','Room 103',null,256),
 ('14A4A291','34636','2026-11-21','Customer Due','Ms Maria','9739066698',150),
 ('687946E8','3450','2026-11-21','Customer Due','MD','7022598485',230),
 ('FD22C21F','34357','2026-11-20','Customer Due','Manjunath','9844544447',64),
 ('D101B43A','34484','2026-11-20','Customer Due','Mr Kumar','8277127570',130),
 ('ECE08244','3413','2026-11-19','Customer Due','Manjunath','9844544447',105),
 ('A2EE2A3A','34155','2026-11-18','Customer Due','Ms Mariya','7022908485',639),
 ('BC903499','33354','2026-11-16','Customer Due','Manjunath','9844544447',368),
 ('423FE43B','33569','2026-11-14','Customer Due','Ms Mariya','9739066698',469),
 ('973C325A','33354','2026-11-13','Customer Due','Manjunath','8844083743',254),
 ('89B3D73B','33429','2026-11-13','Customer Due','Ms Maria','9739066899',593),
 ('2B2EA201','33319','2026-11-12','Customer Due','Ms Maria','7022908485',112),
 ('52965243','33004','2026-11-11','Customer Due','MD','7022598485',619),
 ('E0E8462F','33017','2026-11-11','Customer Due','Apollo hopital REncy','9632236975',267),
 ('B5A9D0F1','32694','2026-11-07','Customer Due','Media Room','9739066698',394),
 ('CCA977BD','32704','2026-11-07','Customer Due','Mr Prejth','9535810084',32),
 ('0AB55B33','32166','2026-10-31','Customer Due','MD','7022598485',684),
 ('1C1FCB54','32293','2026-10-31','Customer Due','media room','9739066698',204),
 ('05927D31','32145','2026-10-30','Customer Due','MEDIA ROOM','7022908485',258),
 ('D49B608D','31900','2026-10-29','Customer Due','rency apollo','9632236975',205),
 ('DC5B297D','32018','2026-10-29','Customer Due','manjunat','9844083743',130),
 ('07BC00A0',null,'2026-10-27','Customer Due',null,null,0),
 ('E023EE21','31550','2026-10-26','Customer Due','Media room',null,162),
 ('B2DEC53A','31433','2026-10-25','Customer Due','Mr Mohith','9353809990',160),
 ('62B1B108','30768','2026-10-21','Customer Due','MD','9742518032',765),
 ('EA22761B','30651','2026-10-19','Customer Due',null,null,65),
 ('6633CB3E','30617','2026-10-19','Customer Due','Mediaroom','9739066698',427),
 ('3B609352','30480','2026-10-18','Proximus Room','Room 205',null,73)
) as v(old_ref, bill_no, bill_date, category, customer, phone, original)
where not exists (select 1 from public.outstanding_bills);

insert into public.bill_receipts (bill_id, receipt_date, amount, method, by_name, allocated_at)
select b.id, b.bill_date, b.original, 'Old app', 'Imported', now()
from public.outstanding_bills b
where b.old_ref in ('06F9A0B7','AA7A40C3','FD22C21F','D101B43A','ECE08244','BC903499','423FE43B','973C325A','DC5B297D','B2DEC53A')
  and not exists (select 1 from public.bill_receipts);

insert into public.bill_receipts (bill_id, receipt_date, amount, method, by_name)
select null, v.d, v.a, 'UPI', 'Reji Varghese' from (values ('2026-10-22'::date, 80), ('2026-10-19'::date, 73)) v(d, a)
where not exists (select 1 from public.bill_receipts where bill_id is null);
