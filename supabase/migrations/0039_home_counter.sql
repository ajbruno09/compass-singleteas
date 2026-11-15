-- Home: a personal counter. Kept out of Buying, food costing and closing. Its own purchases and spend.
alter table public.locations add column if not exists personal boolean not null default false;
update public.locations set personal = true where id = 22 and name = 'Home';
alter table public.purchase_orders add column if not exists home boolean not null default false;
alter table public.issue_lines add column if not exists unit_cost numeric;

create or replace function public.issue_line_cost() returns trigger language plpgsql as $$
begin
  if new.unit_cost is null then select last_cost into new.unit_cost from public.items where id = new.item_id; end if;
  return new;
end $$;
drop trigger if exists issue_line_cost on public.issue_lines;
create trigger issue_line_cost before insert on public.issue_lines for each row execute function public.issue_line_cost();

create table if not exists public.home_buys (
  id uuid primary key default gen_random_uuid(),
  item_id integer not null references public.items(id),
  qty numeric not null check (qty > 0),
  ordered_qty numeric not null default 0,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
alter table public.home_buys enable row level security;
drop policy if exists home_buys_read on public.home_buys;
create policy home_buys_read on public.home_buys for select to authenticated using (public.has_role('owner','store'));

create or replace function public.home_buy_add(p_item integer, p_qty numeric) returns void language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  if not has_role('owner','store') then raise exception 'Only the store can do this.'; end if;
  if coalesce(p_qty,0) <= 0 then raise exception 'Enter a quantity.'; end if;
  select id into rid from home_buys where item_id = p_item and ordered_qty < qty order by created_at limit 1;
  if rid is null then insert into home_buys(item_id, qty) values (p_item, p_qty); else update home_buys set qty = qty + p_qty where id = rid; end if;
end $$;

create or replace function public.home_buy_remove(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if not has_role('owner','store') then raise exception 'Only the store can do this.'; end if;
  delete from home_buys where id = p_id and ordered_qty = 0;
end $$;

create or replace function public.home_create_po(p_vendor_id uuid, p_for_date date, p_required_date date, p_required_time text, p_delivery boolean, p_notes text, p_channel text, p_lines jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_no text; l jsonb; left_q numeric; r record; take numeric;
begin
  if not has_role('owner','store') then raise exception 'Only the store can place orders.'; end if;
  if jsonb_array_length(coalesce(p_lines,'[]'::jsonb)) = 0 then raise exception 'There are no items on this order.'; end if;
  insert into purchase_orders(vendor_id,status,notes,sent_at,sent_by,for_date,required_date,required_time,delivery,channel,deliver_by,home)
    values (p_vendor_id,'sent',coalesce(p_notes,''),now(),auth.uid(),p_for_date,p_required_date,p_required_time,coalesce(p_delivery,true),coalesce(p_channel,'whatsapp_group'),null,true)
    returning id,po_number into v_id,v_no;
  for l in select * from jsonb_array_elements(p_lines) loop
    insert into po_lines(po_id,item_id,qty,unit_rate,asked_qty,in_store_qty)
      values (v_id,(l->>'item_id')::int,(l->>'qty')::numeric,nullif(l->>'unit_rate','')::numeric,nullif(l->>'asked','')::numeric,null);
    left_q := (l->>'qty')::numeric;
    for r in select id, qty, ordered_qty from home_buys where item_id = (l->>'item_id')::int and ordered_qty < qty order by created_at loop
      exit when left_q <= 0;
      take := least(left_q, r.qty - r.ordered_qty);
      update home_buys set ordered_qty = ordered_qty + take where id = r.id;
      left_q := left_q - take;
    end loop;
  end loop;
  return jsonb_build_object('id',v_id,'po_number',v_no);
end $$;

create or replace function public.home_spend() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare bd date := business_date(now()); m0 date := date_trunc('month', business_date(now()))::date; res jsonb;
begin
  if not has_role('owner') then raise exception 'Only the owner can see this.'; end if;
  with x as (
    select business_date(s.issued_at) d, i.name, i.unit, l.qty_issued q, l.qty_issued * coalesce(l.unit_cost, i.last_cost, 0) amt
    from issues s join issue_lines l on l.issue_id = s.id join items i on i.id = l.item_id
    join locations lo on lo.id = s.to_location_id and lo.personal
    where business_date(s.issued_at) >= (m0 - interval '1 month')::date)
  select jsonb_build_object(
    'month', coalesce((select sum(amt) from x where d >= m0), 0),
    'last_month', coalesce((select sum(amt) from x where d < m0), 0),
    'today_items', (select count(*) from x where d = bd),
    'days', coalesce((select jsonb_agg(jsonb_build_object('d', d, 'amt', a) order by d) from (select d, sum(amt) a from x where d >= m0 group by d) z), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'unit', unit, 'qty', q, 'amt', a) order by a desc) from (select name, unit, sum(q) q, sum(amt) a from x where d >= m0 group by name, unit) z), '[]'::jsonb)) into res;
  return res;
end $$;

create or replace function public.buy_placed_total(p_date date) returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(l.qty * coalesce(l.unit_rate,0)),0)
  from purchase_orders p join po_lines l on l.po_id = p.id
  where p.for_date = p_date and coalesce(p.party,false) = false and coalesce(p.home,false) = false and p.status <> 'cancelled'
$$;

do $$
declare d text; nd text;
begin
  d := pg_get_functiondef('public.create_issue'::regproc);
  nd := replace(d, E'  select name into v_name from locations where id = p_to;', E'  if (select personal from locations where id = p_to) then\n    update issues set status = ''locked'', confirmed_by = auth.uid(), confirmed_at = now() where id = v_id;\n    update issue_lines set qty_received = qty_issued where issue_id = v_id;\n  end if;\n  select name into v_name from locations where id = p_to;');
  if nd = d then raise exception 'create_issue patch did not apply'; end if;
  execute nd;
  d := pg_get_functiondef('public.closing_missing_last_night'::regproc);
  nd := replace(d, 'and l.code <> ''party_order''', 'and l.code <> ''party_order'' and not l.personal');
  if nd = d then raise exception 'closing patch did not apply'; end if;
  execute nd;
  d := pg_get_functiondef('public.flow_status'::regproc);
  nd := replace(d, 'from locations where kind = ''department'' and active)', 'from locations where kind = ''department'' and active and not personal)');
  if nd = d then raise exception 'flow_status patch did not apply'; end if;
  execute nd;
end $$;

-- Reads go through functions (the app role has no direct table grant on the new tables).
create or replace function public.home_buys_open() returns table(id uuid, item_id integer, qty numeric, ordered_qty numeric) language sql stable security definer set search_path = public as $$
  select h.id, h.item_id, h.qty, h.ordered_qty from home_buys h where has_role('owner','store') and h.ordered_qty < h.qty order by h.created_at $$;
create or replace function public.counter_shelves_list() returns table(location_id smallint, group_id smallint) language sql stable security definer set search_path = public as $$
  select c.location_id, c.group_id from counter_shelves c where has_role('owner') $$;
