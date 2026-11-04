-- Core flow: receive goods, issue to counters (counter confirms blind), closing stock counts, flow status.
alter table public.stock_count_lines add column if not exists expected numeric;
alter table public.goods_receipts add column if not exists note text not null default '';
create unique index if not exists stock_count_lines_uq on public.stock_count_lines(count_id, item_id);

create or replace function public.receive_goods(p_po_id uuid, p_vendor_id uuid, p_bill_number text, p_bill_date date, p_bill_amount numeric, p_note text, p_lines jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_vendor uuid; v_id uuid; v_no text; l jsonb; v_done boolean; v_any boolean; r record;
begin
  if not has_role('owner','store') then raise exception 'Only the store can receive goods.'; end if;
  if jsonb_array_length(coalesce(p_lines,'[]'::jsonb)) = 0 then raise exception 'Enter what arrived.'; end if;
  if p_po_id is not null then select vendor_id into v_vendor from purchase_orders where id = p_po_id; if v_vendor is null then raise exception 'Order not found.'; end if;
  else v_vendor := p_vendor_id; end if;
  if v_vendor is null then raise exception 'Choose the vendor.'; end if;
  insert into goods_receipts(po_id, vendor_id, received_by, bill_number, bill_date, bill_amount, status, note)
  values (p_po_id, v_vendor, auth.uid(), nullif(p_bill_number,''), p_bill_date, p_bill_amount, 'locked', coalesce(p_note,''))
  returning id, grn_number into v_id, v_no;
  for l in select * from jsonb_array_elements(p_lines) loop
    if (l->>'qty')::numeric > 0 then
      insert into grn_lines(grn_id, item_id, qty_received) values (v_id, (l->>'item_id')::int, (l->>'qty')::numeric);
      insert into stock_ledger(item_id, qty, to_location_id, movement, doc_type, doc_id, note, created_by)
      values ((l->>'item_id')::int, (l->>'qty')::numeric, 1, 'purchase', 'grn', v_id, v_no, auth.uid());
    end if;
  end loop;
  if p_po_id is not null then
    v_done := true; v_any := false;
    for r in select pl.item_id, pl.qty, coalesce((select sum(gl.qty_received) from grn_lines gl join goods_receipts g on g.id = gl.grn_id where g.po_id = p_po_id and gl.item_id = pl.item_id),0) got
             from po_lines pl where pl.po_id = p_po_id loop
      if r.got > 0 then v_any := true; end if;
      if r.got < r.qty * 0.98 then v_done := false; end if;
    end loop;
    update purchase_orders set status = case when v_done then 'received'::po_status when v_any then 'partly_received'::po_status else status end where id = p_po_id;
  end if;
  return jsonb_build_object('id', v_id, 'grn_number', v_no);
end $$;

create or replace function public.close_po(p_po_id uuid) returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not has_role('owner','store') then raise exception 'Only the store can close an order.'; end if;
  update purchase_orders set status = 'received' where id = p_po_id and status in ('sent','partly_received');
end $$;

create or replace function public.create_issue(p_to smallint, p_lines jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid; v_no text; l jsonb; v_ids uuid[]; v_name text;
begin
  if not has_role('owner','store') then raise exception 'Only the store can issue items.'; end if;
  if jsonb_array_length(coalesce(p_lines,'[]'::jsonb)) = 0 then raise exception 'Choose at least one item.'; end if;
  insert into issues(to_location_id, status, issued_by, issued_at) values (p_to, 'submitted', auth.uid(), now()) returning id, issue_number into v_id, v_no;
  for l in select * from jsonb_array_elements(p_lines) loop
    if (l->>'qty')::numeric > 0 then
      insert into issue_lines(issue_id, item_id, qty_issued) values (v_id, (l->>'item_id')::int, (l->>'qty')::numeric);
      insert into stock_ledger(item_id, qty, from_location_id, to_location_id, movement, doc_type, doc_id, note, created_by)
      values ((l->>'item_id')::int, (l->>'qty')::numeric, 1, p_to, 'issue', 'issue', v_id, v_no, auth.uid());
    end if;
  end loop;
  select name into v_name from locations where id = p_to;
  select coalesce(array_agg(profile_id),'{}') into v_ids from profile_locations where location_id = p_to;
  begin perform notify(null, v_ids, 'Items from the store', 'Please check and confirm what you received for ' || v_name, '/', 'issue-' || v_id::text, false);
  exception when others then null; end;
  return jsonb_build_object('id', v_id, 'issue_number', v_no);
end $$;

create or replace function public.pending_issues(p_location_id smallint)
returns table(id uuid, issue_number text, issued_at timestamptz) language sql stable security definer set search_path to 'public' as $$
  select s.id, s.issue_number, s.issued_at from issues s
  where s.status = 'submitted' and s.to_location_id = p_location_id
    and (p_location_id = any(my_location_ids()) or has_role('owner','store'))
  order by s.issued_at
$$;

create or replace function public.confirm_issue(p_issue_id uuid, p_lines jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare s record; l jsonb; diff int := 0; v_name text; r record; v_q numeric;
begin
  select * into s from issues where id = p_issue_id;
  if s.id is null or s.status <> 'submitted' then raise exception 'This delivery is already confirmed.'; end if;
  if not (s.to_location_id = any(my_location_ids()) or has_role('owner','store')) then raise exception 'Not your counter.'; end if;
  for r in select item_id, qty_issued from issue_lines where issue_id = p_issue_id loop
    select (x->>'qty')::numeric into v_q from jsonb_array_elements(p_lines) x where (x->>'item_id')::int = r.item_id limit 1;
    v_q := coalesce(v_q, 0);
    update issue_lines set qty_received = v_q where issue_id = p_issue_id and item_id = r.item_id;
    if abs(v_q - r.qty_issued) > greatest(0.001, r.qty_issued * 0.02) then diff := diff + 1; end if;
  end loop;
  update issues set status = 'locked', confirmed_by = auth.uid(), confirmed_at = now() where id = p_issue_id;
  if diff > 0 then
    select name into v_name from locations where id = s.to_location_id;
    perform raise_alert('today', v_name || ': received does not match issued', diff || ' item(s) differ between what the store issued and what the counter counted. See Issue and receive.', array['owner','manager','store'], s.to_location_id, 'issue');
  end if;
  return jsonb_build_object('differences', diff);
end $$;

create or replace function public.open_count(p_location_id smallint, p_freq count_frequency default 'daily')
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid; v_d date := business_date(now());
begin
  if not (p_location_id = any(my_location_ids()) or has_role('owner','store')) then raise exception 'Not your counter.'; end if;
  select id into v_id from stock_counts where location_id = p_location_id and business_date = v_d and frequency = p_freq;
  if v_id is null then insert into stock_counts(location_id, business_date, frequency, status) values (p_location_id, v_d, p_freq, 'draft') returning id into v_id; end if;
  return v_id;
end $$;

create or replace function public.save_count_line(p_count_id uuid, p_item_id integer, p_qty numeric)
returns void language plpgsql security definer set search_path to 'public' as $$
declare c record;
begin
  select * into c from stock_counts where id = p_count_id;
  if c.id is null or c.status <> 'draft' then raise exception 'This count is already sent.'; end if;
  if not (c.location_id = any(my_location_ids()) or has_role('owner','store')) then raise exception 'Not your counter.'; end if;
  if p_qty is null or p_qty < 0 then raise exception 'Enter zero or more.'; end if;
  insert into stock_count_lines(count_id, item_id, qty) values (p_count_id, p_item_id, p_qty)
  on conflict (count_id, item_id) do update set qty = excluded.qty;
end $$;

create or replace function public.submit_count(p_count_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare c record; r record; sys numeric; d numeric; flagged int := 0; n int := 0; v_name text; tol numeric;
begin
  select * into c from stock_counts where id = p_count_id;
  if c.id is null or c.status <> 'draft' then raise exception 'This count is already sent.'; end if;
  if not (c.location_id = any(my_location_ids()) or has_role('owner','store')) then raise exception 'Not your counter.'; end if;
  for r in select cl.id, cl.item_id, cl.qty, i.tolerance_pct from stock_count_lines cl join items i on i.id = cl.item_id where cl.count_id = p_count_id loop
    select coalesce(sum(qty),0) into sys from stock_on_hand where location_id = c.location_id and item_id = r.item_id;
    d := r.qty - sys;
    update stock_count_lines set expected = sys where id = r.id;
    n := n + 1;
    if d < -0.0005 then
      insert into stock_ledger(item_id, qty, from_location_id, movement, doc_type, doc_id, note, created_by) values (r.item_id, -d, c.location_id, 'consumption', 'count', p_count_id, 'Closing count', auth.uid());
    elsif d > 0.0005 then
      insert into stock_ledger(item_id, qty, to_location_id, movement, doc_type, doc_id, note, created_by) values (r.item_id, d, c.location_id, 'adjustment', 'count', p_count_id, 'Closing count', auth.uid());
    end if;
    tol := coalesce(r.tolerance_pct, 10);
    if sys > 0 and abs(d) / sys * 100 > greatest(tol, 10) and d > 0 then flagged := flagged + 1; end if;
  end loop;
  update stock_counts set status = 'submitted', submitted_by = auth.uid(), submitted_at = now() where id = p_count_id;
  if flagged > 0 then
    select name into v_name from locations where id = c.location_id;
    perform raise_alert('today', v_name || ': count is higher than the books', flagged || ' item(s) were counted above what the system expected. Check issues and receipts.', array['owner','manager','store'], c.location_id, 'count');
  end if;
  return jsonb_build_object('items', n, 'flagged', flagged);
end $$;

create or replace function public.flow_status() returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_d date := business_date(now());
begin
  if not has_role('owner','manager','store') then raise exception 'No access'; end if;
  return jsonb_build_object(
    'pos_waiting', (select count(*) from purchase_orders where status in ('sent','partly_received')),
    'issues_unconfirmed', (select count(*) from issues where status = 'submitted'),
    'counts_done', (select count(*) from stock_counts where business_date = v_d and status = 'submitted' and frequency = 'daily'),
    'counters', (select count(*) from locations where kind = 'department' and active));
end $$;

revoke all on function public.receive_goods(uuid,uuid,text,date,numeric,text,jsonb), public.close_po(uuid), public.create_issue(smallint,jsonb), public.pending_issues(smallint), public.confirm_issue(uuid,jsonb), public.open_count(smallint,count_frequency), public.save_count_line(uuid,integer,numeric), public.submit_count(uuid), public.flow_status() from public, anon;
grant execute on function public.receive_goods(uuid,uuid,text,date,numeric,text,jsonb), public.close_po(uuid), public.create_issue(smallint,jsonb), public.pending_issues(smallint), public.confirm_issue(uuid,jsonb), public.open_count(smallint,count_frequency), public.save_count_line(uuid,integer,numeric), public.submit_count(uuid), public.flow_status() to authenticated;
