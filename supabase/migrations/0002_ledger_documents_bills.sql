-- Compass: the stock ledger, the documents that move stock, vendor bills and the audit trail.

-- ── Business date (after-midnight work counts for the previous day) ──
create or replace function public.business_date(p_at timestamptz default now()) returns date
language sql stable security definer set search_path = public as $$
  select ((p_at at time zone coalesce(s.value->>'timezone', 'Asia/Kolkata'))
          - make_interval(hours => coalesce((s.value->>'hour')::int, 3), mins => coalesce((s.value->>'minute')::int, 0)))::date
  from public.app_settings s where s.key = 'business_day_cutoff'
$$;

-- ── One stock ledger ─────────────────────────────────────────
create type public.movement_type as enum (
  'opening', 'purchase', 'issue', 'transfer', 'consumption', 'wastage', 'leftover',
  'staff_meal', 'vendor_return', 'adjustment');

create table public.stock_ledger (
  id bigserial primary key,
  business_date date not null default public.business_date(),
  occurred_at timestamptz not null default now(),
  item_id int not null references public.items(id),
  qty numeric(12,3) not null check (qty > 0),
  from_location_id smallint references public.locations(id),
  to_location_id smallint references public.locations(id),
  movement public.movement_type not null,
  doc_type text,
  doc_id uuid,
  unit_cost numeric(12,2),
  note text not null default '',
  created_by uuid references public.profiles(id) default auth.uid(),
  check (from_location_id is not null or to_location_id is not null),
  check (from_location_id is distinct from to_location_id)
);
create index stock_ledger_item_idx on public.stock_ledger (item_id, business_date);
create index stock_ledger_doc_idx on public.stock_ledger (doc_type, doc_id);

create or replace function public.ledger_is_append_only() returns trigger
language plpgsql set search_path = public as $$
begin
  raise exception 'The stock ledger cannot be changed or deleted. Post a correcting entry instead.';
end $$;
create trigger stock_ledger_no_update before update or delete on public.stock_ledger
  for each statement execute function public.ledger_is_append_only();

alter table public.stock_ledger enable row level security;
create policy ledger_read on public.stock_ledger for select to authenticated
  using (public.has_role('owner', 'manager', 'store', 'accounts'));
-- No insert policy: entries are written only by the posting functions below.

create view public.stock_on_hand with (security_invoker = true) as
  select location_id, item_id, sum(delta)::numeric(12,3) as qty
  from (
    select to_location_id as location_id, item_id, qty as delta from public.stock_ledger where to_location_id is not null
    union all
    select from_location_id, item_id, -qty from public.stock_ledger where from_location_id is not null
  ) m
  group by location_id, item_id;

-- Opening stock, entered once per item and location when Compass starts.
create or replace function public.post_opening_stock(p_location_id smallint, p_item_id int, p_qty numeric, p_note text default '')
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if not public.has_role('owner', 'store') then raise exception 'Only the owner or store can enter opening stock'; end if;
  if p_qty <= 0 then raise exception 'Opening quantity must be more than zero'; end if;
  if exists (select 1 from public.stock_ledger where movement = 'opening' and item_id = p_item_id and to_location_id = p_location_id) then
    raise exception 'Opening stock for this item and location is already entered. Use an adjustment instead.';
  end if;
  insert into public.stock_ledger (item_id, qty, to_location_id, movement, doc_type, note)
  values (p_item_id, p_qty, p_location_id, 'opening', 'opening', coalesce(p_note, ''))
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.post_opening_stock(smallint, int, numeric, text) from public, anon;
grant execute on function public.post_opening_stock(smallint, int, numeric, text) to authenticated;

-- ── Indents ──────────────────────────────────────────────────
create type public.doc_status as enum ('draft', 'submitted', 'locked', 'cancelled');
create type public.entry_method as enum ('tap', 'voice', 'typed');

create table public.indents (
  id uuid primary key default gen_random_uuid(),
  location_id smallint not null references public.locations(id),
  for_date date not null,
  status public.doc_status not null default 'draft',
  created_by uuid not null references public.profiles(id) default auth.uid(),
  submitted_by uuid references public.profiles(id),
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (location_id, for_date)
);
create table public.indent_lines (
  id uuid primary key default gen_random_uuid(),
  indent_id uuid not null references public.indents(id) on delete cascade,
  item_id int not null references public.items(id),
  qty numeric(12,3) not null check (qty > 0),
  reason text,
  entry_method public.entry_method not null default 'tap',
  unique (indent_id, item_id)
);

-- ── Purchase orders ──────────────────────────────────────────
create type public.po_status as enum ('draft', 'sent', 'partly_received', 'received', 'cancelled');
create sequence public.po_number_seq start 1001;

create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  po_number text not null unique default ('PO-' || nextval('public.po_number_seq')),
  vendor_id uuid not null references public.vendors(id),
  status public.po_status not null default 'draft',
  deliver_by timestamptz,
  notes text not null default '',
  sent_at timestamptz,
  sent_by uuid references public.profiles(id),
  created_by uuid not null references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create table public.po_lines (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references public.purchase_orders(id) on delete cascade,
  item_id int not null references public.items(id),
  qty numeric(12,3) not null check (qty > 0),
  unit_rate numeric(12,2),
  unique (po_id, item_id)
);

-- ── Goods receipts (store receives from vendor) ──────────────
create sequence public.grn_number_seq start 1001;
create table public.goods_receipts (
  id uuid primary key default gen_random_uuid(),
  grn_number text not null unique default ('GRN-' || nextval('public.grn_number_seq')),
  po_id uuid references public.purchase_orders(id),
  vendor_id uuid not null references public.vendors(id),
  received_at timestamptz not null default now(),
  received_by uuid not null references public.profiles(id) default auth.uid(),
  bill_number text,
  bill_date date,
  bill_amount numeric(12,2),
  bill_photo_path text,
  status public.doc_status not null default 'draft'
);
create table public.grn_lines (
  id uuid primary key default gen_random_uuid(),
  grn_id uuid not null references public.goods_receipts(id) on delete cascade,
  item_id int not null references public.items(id),
  qty_received numeric(12,3) not null check (qty_received >= 0),
  qty_billed numeric(12,3),
  rate_billed numeric(12,2),
  unique (grn_id, item_id)
);

-- ── Issues (store to department) with blind confirmation ─────
create sequence public.issue_number_seq start 1001;
create table public.issues (
  id uuid primary key default gen_random_uuid(),
  issue_number text not null unique default ('ISS-' || nextval('public.issue_number_seq')),
  to_location_id smallint not null references public.locations(id),
  status public.doc_status not null default 'draft',
  issued_by uuid not null references public.profiles(id) default auth.uid(),
  issued_at timestamptz,
  confirmed_by uuid references public.profiles(id),
  confirmed_at timestamptz
);
create table public.issue_lines (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.issues(id) on delete cascade,
  item_id int not null references public.items(id),
  qty_issued numeric(12,3) not null check (qty_issued > 0),
  qty_received numeric(12,3) check (qty_received is null or qty_received >= 0),
  unique (issue_id, item_id)
);

-- ── Stock counts ─────────────────────────────────────────────
create table public.stock_counts (
  id uuid primary key default gen_random_uuid(),
  location_id smallint not null references public.locations(id),
  business_date date not null,
  frequency public.count_frequency not null,
  status public.doc_status not null default 'draft',
  submitted_by uuid references public.profiles(id),
  submitted_at timestamptz,
  unique (location_id, business_date, frequency)
);
create table public.stock_count_lines (
  id uuid primary key default gen_random_uuid(),
  count_id uuid not null references public.stock_counts(id) on delete cascade,
  item_id int not null references public.items(id),
  qty numeric(12,3) not null check (qty >= 0),
  photo_path text,
  unique (count_id, item_id)
);

-- ── Vendor bills and payments ────────────────────────────────
create type public.bill_status as enum ('confirmed', 'cancelled');
create type public.payment_mode as enum ('UPI', 'Cash', 'Card', 'Bank transfer', 'Cheque', 'Not recorded');

create table public.vendor_bills (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id),
  grn_id uuid references public.goods_receipts(id),
  bill_number text,
  order_date date,
  received_date date,
  amount numeric(12,2) not null check (amount >= 0),
  status public.bill_status not null default 'confirmed',
  remarks text not null default '',
  photo_path text,
  source text not null default 'compass',
  legacy_id text unique,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index vendor_bills_vendor_idx on public.vendor_bills (vendor_id, received_date);

create table public.bill_payments (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.vendor_bills(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  mode public.payment_mode not null,
  reference text not null default '',
  paid_on date,
  source text not null default 'compass',
  legacy_id text unique,
  recorded_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);

create view public.vendor_bill_balances with (security_invoker = true) as
  select b.id, b.vendor_id, v.name as vendor_name, b.bill_number, b.order_date, b.received_date, b.amount, b.status,
         coalesce(p.paid, 0)::numeric(12,2) as paid,
         case when b.status = 'cancelled' then 0 else (b.amount - coalesce(p.paid, 0)) end::numeric(12,2) as balance,
         case when b.status = 'cancelled' then 'Cancelled'
              when coalesce(p.paid, 0) >= b.amount then 'Paid'
              when coalesce(p.paid, 0) > 0 then 'Part paid'
              else 'Pending' end as payment_status,
         case when v.credit_days is not null and b.received_date is not null
              then b.received_date + v.credit_days end as due_date
  from public.vendor_bills b
  join public.vendors v on v.id = b.vendor_id
  left join (select bill_id, sum(amount) as paid from public.bill_payments group by bill_id) p on p.bill_id = b.id;

-- ── RLS for documents ────────────────────────────────────────
alter table public.indents enable row level security;
alter table public.indent_lines enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.po_lines enable row level security;
alter table public.goods_receipts enable row level security;
alter table public.grn_lines enable row level security;
alter table public.issues enable row level security;
alter table public.issue_lines enable row level security;
alter table public.stock_counts enable row level security;
alter table public.stock_count_lines enable row level security;
alter table public.vendor_bills enable row level security;
alter table public.bill_payments enable row level security;

-- Indents: a department works on its own drafts; the office reads everything.
create policy indents_office_read on public.indents for select to authenticated using (public.has_role('owner', 'manager', 'store'));
create policy indents_dept_read on public.indents for select to authenticated using (location_id = any(public.my_location_ids()));
create policy indents_dept_insert on public.indents for insert to authenticated
  with check (location_id = any(public.my_location_ids()) and status = 'draft');
create policy indents_dept_update on public.indents for update to authenticated
  using (location_id = any(public.my_location_ids()) and status = 'draft')
  with check (location_id = any(public.my_location_ids()) and status in ('draft', 'submitted'));
create policy indent_lines_office_read on public.indent_lines for select to authenticated using (public.has_role('owner', 'manager', 'store'));
create policy indent_lines_dept on public.indent_lines for all to authenticated
  using (exists (select 1 from public.indents i where i.id = indent_id and i.location_id = any(public.my_location_ids()) and i.status = 'draft'))
  with check (exists (select 1 from public.indents i where i.id = indent_id and i.location_id = any(public.my_location_ids()) and i.status = 'draft'));

-- Purchase orders and goods receipts: store and owner work them; accounts and manager read.
create policy po_read on public.purchase_orders for select to authenticated using (public.has_role('owner', 'manager', 'store', 'accounts'));
create policy po_write on public.purchase_orders for all to authenticated using (public.has_role('owner', 'store')) with check (public.has_role('owner', 'store'));
create policy po_lines_read on public.po_lines for select to authenticated using (public.has_role('owner', 'manager', 'store', 'accounts'));
create policy po_lines_write on public.po_lines for all to authenticated using (public.has_role('owner', 'store')) with check (public.has_role('owner', 'store'));
create policy grn_read on public.goods_receipts for select to authenticated using (public.has_role('owner', 'manager', 'store', 'accounts'));
create policy grn_write on public.goods_receipts for all to authenticated using (public.has_role('owner', 'store') and status = 'draft') with check (public.has_role('owner', 'store'));
create policy grn_lines_read on public.grn_lines for select to authenticated using (public.has_role('owner', 'manager', 'store', 'accounts'));
create policy grn_lines_write on public.grn_lines for all to authenticated
  using (public.has_role('owner', 'store') and exists (select 1 from public.goods_receipts g where g.id = grn_id and g.status = 'draft'))
  with check (public.has_role('owner', 'store'));

-- Issues: the department never reads issued quantities (blind receiving); it sees items through issue_items_to_confirm().
create policy issues_office on public.issues for all to authenticated using (public.has_role('owner', 'store')) with check (public.has_role('owner', 'store'));
create policy issues_read_mgr on public.issues for select to authenticated using (public.has_role('manager', 'accounts'));
create policy issues_dept_read on public.issues for select to authenticated using (to_location_id = any(public.my_location_ids()) and status <> 'draft');
create policy issue_lines_office on public.issue_lines for all to authenticated using (public.has_role('owner', 'store')) with check (public.has_role('owner', 'store'));
create policy issue_lines_read_mgr on public.issue_lines for select to authenticated using (public.has_role('manager', 'accounts'));

create or replace function public.issue_items_to_confirm(p_issue_id uuid)
returns table (item_id int, name text, local_names jsonb, unit text, photo_path text, quick_amounts numeric[])
language sql stable security definer set search_path = public as $$
  select i.id, i.name, i.local_names, i.unit, i.photo_path, i.quick_amounts
  from public.issue_lines l join public.items i on i.id = l.item_id
  join public.issues s on s.id = l.issue_id
  where l.issue_id = p_issue_id and s.status = 'submitted'
    and (s.to_location_id = any(public.my_location_ids()) or public.has_role('owner'))
  order by i.name
$$;
revoke all on function public.issue_items_to_confirm(uuid) from public, anon;
grant execute on function public.issue_items_to_confirm(uuid) to authenticated;

-- Stock counts: a department enters its own; the office reads.
create policy counts_office_read on public.stock_counts for select to authenticated using (public.has_role('owner', 'manager', 'store'));
create policy counts_dept on public.stock_counts for all to authenticated
  using (location_id = any(public.my_location_ids()) and status = 'draft')
  with check (location_id = any(public.my_location_ids()) and status in ('draft', 'submitted'));
create policy counts_dept_read on public.stock_counts for select to authenticated using (location_id = any(public.my_location_ids()));
create policy count_lines_office_read on public.stock_count_lines for select to authenticated using (public.has_role('owner', 'manager', 'store'));
create policy count_lines_dept on public.stock_count_lines for all to authenticated
  using (exists (select 1 from public.stock_counts c where c.id = count_id and c.location_id = any(public.my_location_ids()) and c.status = 'draft'))
  with check (exists (select 1 from public.stock_counts c where c.id = count_id and c.location_id = any(public.my_location_ids()) and c.status = 'draft'));

-- Bills and payments: accounts and owner manage; store records bills from receipts; manager reads.
create policy bills_read on public.vendor_bills for select to authenticated using (public.has_role('owner', 'manager', 'accounts', 'store'));
create policy bills_insert on public.vendor_bills for insert to authenticated with check (public.has_role('owner', 'accounts', 'store'));
create policy bills_update on public.vendor_bills for update to authenticated using (public.has_role('owner', 'accounts')) with check (public.has_role('owner', 'accounts'));
create policy payments_read on public.bill_payments for select to authenticated using (public.has_role('owner', 'manager', 'accounts'));
create policy payments_insert on public.bill_payments for insert to authenticated with check (public.has_role('owner', 'accounts'));

-- ── Audit trail ──────────────────────────────────────────────
create table public.audit_log (
  id bigserial primary key,
  table_name text not null,
  row_id text not null,
  action text not null,
  old_row jsonb,
  new_row jsonb,
  changed_by uuid default auth.uid(),
  changed_at timestamptz not null default now()
);
alter table public.audit_log enable row level security;
create policy audit_read on public.audit_log for select to authenticated using (public.has_role('owner'));

create or replace function public.write_audit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_log (table_name, row_id, action, old_row, new_row)
  values (tg_table_name,
          coalesce((case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end)->>'id', ''),
          tg_op,
          case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end);
  return coalesce(new, old);
end $$;
revoke all on function public.write_audit() from public, anon, authenticated;

create trigger audit_profiles after insert or update or delete on public.profiles for each row execute function public.write_audit();
create trigger audit_items after insert or update or delete on public.items for each row execute function public.write_audit();
create trigger audit_vendors after insert or update or delete on public.vendors for each row execute function public.write_audit();
create trigger audit_vendor_bills after insert or update or delete on public.vendor_bills for each row execute function public.write_audit();
create trigger audit_bill_payments after insert or update or delete on public.bill_payments for each row execute function public.write_audit();
create trigger audit_purchase_orders after insert or update or delete on public.purchase_orders for each row execute function public.write_audit();
create trigger audit_goods_receipts after insert or update or delete on public.goods_receipts for each row execute function public.write_audit();
create trigger audit_issues after insert or update or delete on public.issues for each row execute function public.write_audit();
create trigger audit_indents after insert or update or delete on public.indents for each row execute function public.write_audit();
create trigger audit_stock_counts after insert or update or delete on public.stock_counts for each row execute function public.write_audit();

-- ── Item photos (private bucket) ─────────────────────────────
insert into storage.buckets (id, name, public) values ('item-photos', 'item-photos', false)
  on conflict (id) do nothing;
create policy item_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'item-photos' and public.my_role() is not null);
create policy item_photos_write on storage.objects for insert to authenticated
  with check (bucket_id = 'item-photos' and public.has_role('owner', 'manager', 'store'));
create policy item_photos_update on storage.objects for update to authenticated
  using (bucket_id = 'item-photos' and public.has_role('owner', 'manager', 'store'));
