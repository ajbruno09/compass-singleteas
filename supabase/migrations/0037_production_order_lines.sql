-- 0037 production orders get their own ingredient lines (v5.121)
-- Ingredients of a production order no longer go into the counter's indent. The store decides per ingredient:
-- give from store, or buy outside (shows in Buying tagged with the order). Issue is done against the order.
create table if not exists prod_order_lines (
  order_id integer not null references prod_orders(id) on delete cascade,
  item_id integer not null references items(id),
  need numeric not null,
  mode text check (mode in ('store','buy')),
  issued numeric not null default 0,
  decided_at timestamptz,
  primary key (order_id, item_id)
);
alter table prod_order_lines enable row level security;

create or replace function public.prod_sync(p_for date) returns void language plpgsql security definer set search_path to 'public' as $f$
begin
  update prod_order_lines l set need = 0 from prod_orders o where o.id = l.order_id and o.for_date = p_for;
  insert into prod_order_lines(order_id, item_id, need)
  select o.id, pl.ingredient_id,
         case when bool_or(pl.in_content and coalesce(ii.content_qty,0) > 0)
           then ceil(round(sum(pl.qty_per_base / (case when pl.in_content and coalesce(ii.content_qty,0) > 0 then ii.content_qty else 1 end) * o.qty / rr.base_qty),3) - 0.0005)
           else round(sum(pl.qty_per_base * o.qty / rr.base_qty),3) end
  from prod_orders o join prod_recipes rr on rr.item_id = o.item_id join prod_recipe_lines pl on pl.recipe_item_id = o.item_id join items ii on ii.id = pl.ingredient_id
  where o.for_date = p_for and o.status <> 'cancelled' and pl.unit_ok
    and coalesce((o.ask_over->>(pl.ingredient_id::text))::boolean, pl.ask_default)
  group by o.id, pl.ingredient_id
  on conflict (order_id, item_id) do update set need = excluded.need;
  delete from prod_order_lines l using prod_orders o where o.id = l.order_id and o.for_date = p_for and l.need = 0 and l.issued = 0;
end $f$;

create or replace function public.prod_orders_open() returns jsonb language plpgsql stable security definer set search_path to 'public' as $f$
begin
  if not has_role('owner','manager','store') then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'item_id', o.item_id, 'name', i.name, 'unit', i.unit, 'qty', o.qty, 'for_date', o.for_date, 'urgent', o.urgent,
      'by', coalesce(p.full_name,''), 'loc', rr.loc,
      'lines', (select coalesce(jsonb_agg(jsonb_build_object('item_id', l.item_id, 'name', ii.name, 'unit', ii.unit, 'need', l.need, 'issued', l.issued, 'mode', l.mode,
                  'have', greatest(coalesce((select h.qty from stock_on_hand h where h.location_id = 1 and h.item_id = l.item_id),0),0)) order by ii.name),'[]'::jsonb)
                from prod_order_lines l join items ii on ii.id = l.item_id where l.order_id = o.id)) order by o.for_date, o.id), '[]'::jsonb)
    from prod_orders o join items i on i.id = o.item_id join prod_recipes rr on rr.item_id = o.item_id left join profiles p on p.id = o.requested_by
    where o.status = 'requested');
end $f$;

create or replace function public.prod_buy_lines(p_date date) returns jsonb language plpgsql stable security definer set search_path to 'public' as $f$
begin
  if not has_role('owner','manager','store') then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('item_id', l.item_id, 'qty', l.need - l.issued, 'label', 'Production: ' || i.name || ' ' || trim_scale(o.qty)::text, 'order_id', o.id))
    from prod_order_lines l join prod_orders o on o.id = l.order_id join items i on i.id = o.item_id
    where o.status = 'requested' and o.for_date <= p_date and l.mode = 'buy' and l.need - l.issued > 0.0005), '[]'::jsonb);
end $f$;

create or replace function public.prod_decide(p_order integer, p_modes jsonb) returns void language plpgsql security definer set search_path to 'public' as $f$
declare k text; v text; l prod_order_lines; have numeric;
begin
  if not has_role('owner','store') then raise exception 'Only the store can decide this.'; end if;
  if not exists (select 1 from prod_orders where id = p_order and status = 'requested') then raise exception 'This order is already being made.'; end if;
  for k, v in select * from jsonb_each_text(p_modes) loop
    if v not in ('store','buy') then continue; end if;
    select * into l from prod_order_lines where order_id = p_order and item_id = k::int;
    if not found then continue; end if;
    if v = 'store' then
      select coalesce(qty,0) into have from stock_on_hand where location_id = 1 and item_id = l.item_id;
      if coalesce(have,0) + 0.0005 < l.need - l.issued then raise exception 'The store does not have enough of %. Choose Buy outside.', (select name from items where id = l.item_id); end if;
    end if;
    update prod_order_lines set mode = v, decided_at = now() where order_id = p_order and item_id = l.item_id;
  end loop;
end $f$;

create or replace function public.prod_issue(p_order integer, p_lines jsonb) returns void language plpgsql security definer set search_path to 'public' as $f$
declare o prod_orders; loc smallint; x jsonb; l prod_order_lines; q numeric; have numeric; nm text;
begin
  if not has_role('owner','store') then raise exception 'Only the store can issue items.'; end if;
  select * into o from prod_orders where id = p_order for update;
  if not found or o.status <> 'requested' then raise exception 'This order is already being made.'; end if;
  select rr.loc into loc from prod_recipes rr where rr.item_id = o.item_id;
  for x in select * from jsonb_array_elements(p_lines) loop
    q := (x->>'qty')::numeric; if q is null or q <= 0 then continue; end if;
    select * into l from prod_order_lines where order_id = p_order and item_id = (x->>'item_id')::int for update;
    if not found then raise exception 'That item is not part of this order.'; end if;
    select name into nm from items where id = l.item_id;
    if q > l.need - l.issued + 0.0005 then raise exception 'More than needed for %.', nm; end if;
    select coalesce(qty,0) into have from stock_on_hand where location_id = 1 and item_id = l.item_id;
    if coalesce(have,0) + 0.0005 < q then raise exception 'Not enough % in the store.', nm; end if;
    insert into stock_ledger(item_id, qty, from_location_id, to_location_id, movement, doc_type, note, created_by)
    values (l.item_id, q, 1, loc, 'issue', 'production', 'Production order #' || p_order, auth.uid());
    update prod_order_lines set issued = issued + q, mode = coalesce(mode, 'store') where order_id = p_order and item_id = l.item_id;
  end loop;
end $f$;

create or replace function public.prod_lines(p_ids integer[]) returns jsonb language sql stable security definer set search_path to 'public' as $f$
  select coalesce(jsonb_agg(jsonb_build_object('order_id', o.id,
      'waiting', (select coalesce(jsonb_agg(ii.name order by ii.name),'[]'::jsonb) from prod_order_lines l join items ii on ii.id = l.item_id where l.order_id = o.id and (l.mode is null or l.issued < l.need - 0.0005)),
      'undecided', (select count(*) from prod_order_lines l where l.order_id = o.id and l.mode is null))), '[]'::jsonb)
  from prod_orders o where o.id = any(p_ids) and auth.uid() is not null;
$f$;

-- the kitchen can start cooking only after the store issued every ingredient (the owner can always start)
do $$ declare f text; begin
  f := pg_get_functiondef('public.prod_set_status(integer,text,numeric,jsonb)'::regprocedure);
  f := replace(f, E'  if p_status=''cooking'' and o.status=''requested'' and can then',
    E'  if p_status=''cooking'' and o.status=''requested'' and not has_role(''owner'') and exists (select 1 from prod_order_lines l where l.order_id = p_id and (l.mode is null or l.issued < l.need - 0.0005)) then\n    raise exception ''The store has not issued all the ingredients yet.'';\n  end if;\n  if p_status=''cooking'' and o.status=''requested'' and can then');
  execute f;
  f := pg_get_functiondef('public.prod_order(integer,numeric,boolean,text,date,jsonb)'::regprocedure);
  f := replace(f, 'Asked items are on the indent.', 'The store decides on the ingredients in Buying.');
  f := replace(f, E'''/production'', ''prod-''', E'''/buying'', ''prod-''');
  execute f;
end $$;

-- take production ingredients out of counter indents for today and later (they now live on the order)
do $$ declare a record; begin
  for a in select pa.indent_id, pa.item_id, pa.qty from prod_indent_alloc pa join indents i on i.id = pa.indent_id where i.for_date >= date '2026-11-14' loop
    update indent_lines set qty = qty - a.qty where indent_id = a.indent_id and item_id = a.item_id;
    delete from indent_lines where indent_id = a.indent_id and item_id = a.item_id and qty <= 0.000001;
    delete from prod_indent_alloc where indent_id = a.indent_id and item_id = a.item_id;
  end loop;
end $$;

-- lines for orders that exist now; orders already past the requested step count as done
do $$ declare d date; begin
  for d in select distinct for_date from prod_orders where status <> 'cancelled' loop perform prod_sync(d); end loop;
  update prod_order_lines l set mode = 'store', issued = l.need from prod_orders o where o.id = l.order_id and o.status <> 'requested';
end $$;
