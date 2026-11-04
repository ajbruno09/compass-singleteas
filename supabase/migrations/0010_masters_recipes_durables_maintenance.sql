-- Vendor QR, bulk imports (items, opening stock, menu, recipes), durables inventory, maintenance.
alter table public.vendors add column if not exists qr_path text;
insert into storage.buckets(id, name, public) values ('vendor-qr','vendor-qr', false) on conflict (id) do nothing;
drop policy if exists vendor_qr_read on storage.objects; drop policy if exists vendor_qr_write on storage.objects; drop policy if exists vendor_qr_update on storage.objects;
create policy vendor_qr_read on storage.objects for select using (bucket_id = 'vendor-qr' and has_role('owner','manager','accounts','store'));
create policy vendor_qr_write on storage.objects for insert with check (bucket_id = 'vendor-qr' and has_role('owner','accounts'));
create policy vendor_qr_update on storage.objects for update using (bucket_id = 'vendor-qr' and has_role('owner','accounts'));

create or replace function public.import_items(p jsonb) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare r jsonb; v_id int; na int := 0; nu int := 0; q numeric[];
begin
  if not has_role('owner','manager','store') then raise exception 'Not allowed'; end if;
  for r in select * from jsonb_array_elements(p) loop
    q := case when r ? 'quick' and jsonb_typeof(r->'quick') = 'array' and jsonb_array_length(r->'quick') > 0 then (select array_agg(x::numeric) from jsonb_array_elements_text(r->'quick') x) else null end;
    select id into v_id from items where lower(name) = lower(trim(r->>'name')) limit 1;
    if v_id is null then
      insert into items(name, category_id, unit, purchase_unit, purchase_factor, quick_amounts, count_frequency, tolerance_pct, last_cost, group_id, default_vendor_id, pack_name, pack_size, pieces_per_pack, slices_per_pack, weight_per_pack_g, wastage_pct, base_unit, brand, pack_note, source)
      values (trim(r->>'name'), (r->>'category_id')::smallint, r->>'unit', nullif(r->>'purchase_unit',''), nullif(r->>'purchase_factor','')::numeric, coalesce(q, array[1]::numeric[]), coalesce(nullif(r->>'freq',''),'weekly')::count_frequency, coalesce(nullif(r->>'tol','')::numeric, 5), nullif(r->>'cost','')::numeric, nullif(r->>'group_id','')::smallint, nullif(r->>'vendor_id','')::uuid, nullif(r->>'pack_name',''), nullif(r->>'pack_size','')::numeric, nullif(r->>'pieces','')::numeric, nullif(r->>'slices','')::numeric, nullif(r->>'pack_g','')::numeric, nullif(r->>'waste','')::numeric, nullif(r->>'base_unit',''), coalesce(r->>'brand',''), coalesce(r->>'pack_note',''), 'bought')
      returning id into v_id;
      na := na + 1;
    else
      update items set category_id = coalesce(nullif(r->>'category_id','')::smallint, category_id), unit = coalesce(nullif(r->>'unit',''), unit),
        purchase_unit = coalesce(nullif(r->>'purchase_unit',''), purchase_unit), purchase_factor = coalesce(nullif(r->>'purchase_factor','')::numeric, purchase_factor),
        quick_amounts = coalesce(q, quick_amounts), count_frequency = coalesce(nullif(r->>'freq','')::count_frequency, count_frequency), tolerance_pct = coalesce(nullif(r->>'tol','')::numeric, tolerance_pct),
        last_cost = coalesce(nullif(r->>'cost','')::numeric, last_cost), group_id = coalesce(nullif(r->>'group_id','')::smallint, group_id), default_vendor_id = coalesce(nullif(r->>'vendor_id','')::uuid, default_vendor_id),
        pack_name = coalesce(nullif(r->>'pack_name',''), pack_name), pack_size = coalesce(nullif(r->>'pack_size','')::numeric, pack_size), pieces_per_pack = coalesce(nullif(r->>'pieces','')::numeric, pieces_per_pack),
        slices_per_pack = coalesce(nullif(r->>'slices','')::numeric, slices_per_pack), weight_per_pack_g = coalesce(nullif(r->>'pack_g','')::numeric, weight_per_pack_g), wastage_pct = coalesce(nullif(r->>'waste','')::numeric, wastage_pct),
        base_unit = coalesce(nullif(r->>'base_unit',''), base_unit), updated_at = now()
      where id = v_id;
      nu := nu + 1;
    end if;
    if r ? 'locs' and jsonb_typeof(r->'locs') = 'array' and jsonb_array_length(r->'locs') > 0 then
      delete from item_locations where item_id = v_id;
      insert into item_locations(item_id, location_id) select v_id, x::smallint from jsonb_array_elements_text(r->'locs') x on conflict do nothing;
    end if;
    if nullif(r->>'vendor_id','') is not null then
      insert into vendor_items(vendor_id, item_id) values ((r->>'vendor_id')::uuid, v_id) on conflict do nothing;
    end if;
  end loop;
  return jsonb_build_object('added', na, 'updated', nu);
end $$;

create or replace function public.import_opening(p jsonb) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare r jsonb; v_id int; ok int := 0; skipped int := 0; missing jsonb := '[]'::jsonb;
begin
  if not has_role('owner','store') then raise exception 'Only the owner or store can enter opening stock.'; end if;
  for r in select * from jsonb_array_elements(p) loop
    select id into v_id from items where lower(name) = lower(trim(r->>'name')) limit 1;
    if v_id is null then missing := missing || to_jsonb(r->>'name'); continue; end if;
    if (r->>'qty')::numeric <= 0 then continue; end if;
    if exists (select 1 from stock_ledger where movement = 'opening' and item_id = v_id and to_location_id = (r->>'location_id')::smallint) then skipped := skipped + 1; continue; end if;
    insert into stock_ledger(item_id, qty, to_location_id, movement, doc_type, note, created_by) values (v_id, (r->>'qty')::numeric, (r->>'location_id')::smallint, 'opening', 'opening', 'bulk upload', auth.uid());
    ok := ok + 1;
  end loop;
  return jsonb_build_object('saved', ok, 'skipped', skipped, 'unknown_items', missing);
end $$;

create or replace function public.import_menu_rows(p jsonb) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare r jsonb; v_id int; na int := 0; nu int := 0;
begin
  if not has_role('owner','manager') then raise exception 'Not allowed'; end if;
  for r in select * from jsonb_array_elements(p) loop
    select id into v_id from menu_items where lower(name) = lower(trim(r->>'name')) limit 1;
    if v_id is null then
      insert into menu_items(name, pos_name, price, menu_page, menu_group, location_id, status, needs_check, note)
      values (trim(r->>'name'), nullif(r->>'pos_name',''), nullif(r->>'price','')::numeric, nullif(r->>'menu_page',''), nullif(r->>'menu_group',''), nullif(r->>'location_id','')::smallint, coalesce(nullif(r->>'status',''),'active'), false, coalesce(r->>'note',''));
      na := na + 1;
    else
      update menu_items set pos_name = coalesce(nullif(r->>'pos_name',''), pos_name), price = coalesce(nullif(r->>'price','')::numeric, price), menu_page = coalesce(nullif(r->>'menu_page',''), menu_page),
        menu_group = coalesce(nullif(r->>'menu_group',''), menu_group), location_id = coalesce(nullif(r->>'location_id','')::smallint, location_id), status = coalesce(nullif(r->>'status',''), status), updated_at = now() where id = v_id;
      nu := nu + 1;
    end if;
  end loop;
  return jsonb_build_object('added', na, 'updated', nu);
end $$;

-- Recipes
create table if not exists public.recipes (
  id serial primary key, menu_item_id int not null unique references public.menu_items(id) on delete cascade,
  portion_size text not null default '', portions numeric not null default 1, note text not null default '',
  updated_at timestamptz not null default now(), updated_by uuid
);
create table if not exists public.recipe_lines (
  id serial primary key, recipe_id int not null references public.recipes(id) on delete cascade, item_id int not null references public.items(id),
  qty numeric not null check (qty > 0), wastage_pct numeric, note text not null default '', sort int not null default 0
);
alter table public.recipes enable row level security; alter table public.recipe_lines enable row level security;
drop policy if exists recipes_read on public.recipes; drop policy if exists recipe_lines_read on public.recipe_lines;
create policy recipes_read on public.recipes for select using (has_role('owner','manager','store','accounts'));
create policy recipe_lines_read on public.recipe_lines for select using (has_role('owner','manager','store','accounts'));

create or replace function public.save_recipe(p_menu_item_id int, p_portion_size text, p_portions numeric, p_note text, p_lines jsonb) returns int language plpgsql security definer set search_path to 'public' as $$
declare v_id int; l jsonb; n int := 0;
begin
  if not has_role('owner','manager') then raise exception 'Only Admin or manager can save recipes.'; end if;
  insert into recipes(menu_item_id, portion_size, portions, note, updated_at, updated_by) values (p_menu_item_id, coalesce(p_portion_size,''), coalesce(nullif(p_portions,0),1), coalesce(p_note,''), now(), auth.uid())
  on conflict (menu_item_id) do update set portion_size = excluded.portion_size, portions = excluded.portions, note = excluded.note, updated_at = now(), updated_by = auth.uid()
  returning id into v_id;
  delete from recipe_lines where recipe_id = v_id;
  for l in select * from jsonb_array_elements(coalesce(p_lines,'[]'::jsonb)) loop
    if (l->>'qty')::numeric > 0 then n := n + 1; insert into recipe_lines(recipe_id, item_id, qty, wastage_pct, note, sort) values (v_id, (l->>'item_id')::int, (l->>'qty')::numeric, nullif(l->>'waste','')::numeric, coalesce(l->>'note',''), n); end if;
  end loop;
  return v_id;
end $$;

create or replace function public.import_recipes(p jsonb) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare r jsonb; d text; m int; i int; ids int[] := '{}'; v_id int; done int := 0; bad jsonb := '[]'::jsonb; dish text; seen text[] := '{}';
begin
  if not has_role('owner','manager') then raise exception 'Only Admin or manager can upload recipes.'; end if;
  -- first pass: group rows by dish; each dish replaces its recipe
  for dish in select distinct lower(trim(x->>'dish')) from jsonb_array_elements(p) x loop
    select id into m from menu_items where lower(name) = dish or lower(coalesce(pos_name,'')) = dish limit 1;
    if m is null then bad := bad || to_jsonb('Dish not found: ' || dish); continue; end if;
    insert into recipes(menu_item_id, updated_by) values (m, auth.uid()) on conflict (menu_item_id) do update set updated_at = now(), updated_by = auth.uid() returning id into v_id;
    select x into r from jsonb_array_elements(p) x where lower(trim(x->>'dish')) = dish limit 1;
    update recipes set portion_size = coalesce(nullif(r->>'portion_size',''), portion_size), portions = coalesce(nullif(r->>'portions','')::numeric, portions), note = coalesce(nullif(r->>'recipe_note',''), note) where id = v_id;
    delete from recipe_lines where recipe_id = v_id;
    done := done + 1;
    for r in select x from jsonb_array_elements(p) x where lower(trim(x->>'dish')) = dish loop
      select id into i from items where lower(name) = lower(trim(r->>'item')) limit 1;
      if i is null then bad := bad || to_jsonb(dish || ': ingredient not found: ' || (r->>'item')); continue; end if;
      insert into recipe_lines(recipe_id, item_id, qty, wastage_pct, note, sort) values (v_id, i, (r->>'qty')::numeric, nullif(r->>'waste','')::numeric, coalesce(r->>'note',''), (select coalesce(max(sort),0)+1 from recipe_lines where recipe_id = v_id));
    end loop;
  end loop;
  return jsonb_build_object('dishes', done, 'problems', bad);
end $$;

-- Durables (plates, glasses, cutlery)
create table if not exists public.durable_items (
  id serial primary key, name text not null unique, category text not null default 'Other', qty numeric not null default 0, replace_cost numeric, kept_at text not null default '', active boolean not null default true, created_at timestamptz not null default now()
);
create table if not exists public.durable_counts (id uuid primary key default gen_random_uuid(), count_date date not null default current_date, note text not null default '', created_by uuid, created_at timestamptz not null default now());
create table if not exists public.durable_count_lines (
  id serial primary key, count_id uuid not null references public.durable_counts(id) on delete cascade, item_id int not null references public.durable_items(id),
  expected numeric not null, counted numeric not null, broken numeric not null default 0, added numeric not null default 0
);
alter table public.durable_items enable row level security; alter table public.durable_counts enable row level security; alter table public.durable_count_lines enable row level security;
create policy durable_items_read on public.durable_items for select using (has_role('owner','manager','store'));
create policy durable_counts_read on public.durable_counts for select using (has_role('owner','manager','store'));
create policy durable_lines_read on public.durable_count_lines for select using (has_role('owner','manager','store'));

create or replace function public.save_durable(p_id int, p_name text, p_category text, p_qty numeric, p_cost numeric, p_kept text, p_active boolean) returns int language plpgsql security definer set search_path to 'public' as $$
declare v int;
begin
  if not has_role('owner','store') then raise exception 'Only Admin or store can change the inventory list.'; end if;
  if p_id is null then insert into durable_items(name, category, qty, replace_cost, kept_at) values (trim(p_name), coalesce(nullif(p_category,''),'Other'), coalesce(p_qty,0), p_cost, coalesce(p_kept,'')) returning id into v;
  else update durable_items set name = trim(p_name), category = coalesce(nullif(p_category,''),'Other'), replace_cost = p_cost, kept_at = coalesce(p_kept,''), active = coalesce(p_active, active) where id = p_id returning id into v; end if;
  return v;
end $$;

create or replace function public.save_durable_count(p_note text, p_lines jsonb) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid; l jsonb; cur numeric; exp numeric;
begin
  if not has_role('owner','store') then raise exception 'Only Admin or store can count the inventory.'; end if;
  insert into durable_counts(note, created_by) values (coalesce(p_note,''), auth.uid()) returning id into v_id;
  for l in select * from jsonb_array_elements(p_lines) loop
    select qty into cur from durable_items where id = (l->>'item_id')::int;
    exp := coalesce(cur,0) + coalesce((l->>'added')::numeric,0) - coalesce((l->>'broken')::numeric,0);
    insert into durable_count_lines(count_id, item_id, expected, counted, broken, added) values (v_id, (l->>'item_id')::int, exp, (l->>'counted')::numeric, coalesce((l->>'broken')::numeric,0), coalesce((l->>'added')::numeric,0));
    update durable_items set qty = (l->>'counted')::numeric where id = (l->>'item_id')::int;
  end loop;
  return v_id;
end $$;

create or replace function public.import_durables(p jsonb) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare r jsonb; na int := 0; nu int := 0;
begin
  if not has_role('owner','store') then raise exception 'Not allowed'; end if;
  for r in select * from jsonb_array_elements(p) loop
    if exists (select 1 from durable_items where lower(name) = lower(trim(r->>'name'))) then
      update durable_items set category = coalesce(nullif(r->>'category',''), category), replace_cost = coalesce(nullif(r->>'cost','')::numeric, replace_cost), kept_at = coalesce(nullif(r->>'kept',''), kept_at) where lower(name) = lower(trim(r->>'name')); nu := nu + 1;
    else insert into durable_items(name, category, qty, replace_cost, kept_at) values (trim(r->>'name'), coalesce(nullif(r->>'category',''),'Other'), coalesce(nullif(r->>'qty','')::numeric,0), nullif(r->>'cost','')::numeric, coalesce(r->>'kept','')); na := na + 1; end if;
  end loop;
  return jsonb_build_object('added', na, 'updated', nu);
end $$;

-- Maintenance
create table if not exists public.maint_tasks (
  id serial primary key, title text not null, area text not null default 'Other', kind text not null default 'repair' check (kind in ('repair','recurring')),
  vendor_name text not null default '', repeat_days int, next_due date, last_done date, status text not null default 'open' check (status in ('open','done')),
  notes text not null default '', cost numeric, reminded_for date, created_by uuid, created_at timestamptz not null default now()
);
create table if not exists public.maint_log (id serial primary key, task_id int not null references public.maint_tasks(id) on delete cascade, done_on date not null, cost numeric, vendor_name text not null default '', note text not null default '', by uuid, created_at timestamptz not null default now());
alter table public.maint_tasks enable row level security; alter table public.maint_log enable row level security;
create policy maint_tasks_read on public.maint_tasks for select using (has_role('owner','manager','store'));
create policy maint_log_read on public.maint_log for select using (has_role('owner','manager','store'));

create or replace function public.save_maint(p_id int, p_title text, p_area text, p_kind text, p_vendor text, p_repeat int, p_next date, p_notes text) returns int language plpgsql security definer set search_path to 'public' as $$
declare v int;
begin
  if not has_role('owner','manager','store') then raise exception 'Not allowed'; end if;
  if p_id is null then insert into maint_tasks(title, area, kind, vendor_name, repeat_days, next_due, notes, created_by) values (trim(p_title), coalesce(p_area,'Other'), p_kind, coalesce(p_vendor,''), p_repeat, p_next, coalesce(p_notes,''), auth.uid()) returning id into v;
  else update maint_tasks set title = trim(p_title), area = coalesce(p_area,'Other'), kind = p_kind, vendor_name = coalesce(p_vendor,''), repeat_days = p_repeat, next_due = p_next, notes = coalesce(p_notes,'') where id = p_id returning id into v; end if;
  return v;
end $$;

create or replace function public.maint_done(p_id int, p_done_on date, p_cost numeric, p_vendor text, p_note text) returns void language plpgsql security definer set search_path to 'public' as $$
declare t record;
begin
  if not has_role('owner','manager','store') then raise exception 'Not allowed'; end if;
  select * into t from maint_tasks where id = p_id; if t.id is null then raise exception 'Task not found'; end if;
  insert into maint_log(task_id, done_on, cost, vendor_name, note, by) values (p_id, p_done_on, p_cost, coalesce(nullif(p_vendor,''), t.vendor_name), coalesce(p_note,''), auth.uid());
  if t.kind = 'recurring' and t.repeat_days is not null then
    update maint_tasks set last_done = p_done_on, next_due = p_done_on + t.repeat_days, reminded_for = null, status = 'open', cost = p_cost where id = p_id;
  else update maint_tasks set last_done = p_done_on, status = 'done', cost = p_cost where id = p_id; end if;
end $$;

create or replace function public.delete_maint(p_id int) returns void language plpgsql security definer set search_path to 'public' as $$
begin if not has_role('owner','manager') then raise exception 'Not allowed'; end if; delete from maint_tasks where id = p_id; end $$;

create or replace function public.maint_remind() returns void language plpgsql security definer set search_path to 'public' as $$
declare t record; v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  for t in select * from maint_tasks where status = 'open' and next_due is not null and next_due <= v_today + 1 and (reminded_for is distinct from next_due) loop
    perform raise_alert('today', case when t.next_due < v_today then 'Overdue: ' else 'Due ' || case when t.next_due = v_today then 'today: ' else 'tomorrow: ' end end || t.title, 'Open Maintenance to mark it done or copy a message for the vendor.', array['owner','manager','store'], null, 'maint');
    update maint_tasks set reminded_for = t.next_due where id = t.id;
  end loop;
end $$;
select cron.schedule('maint-remind', '5 * * * *', 'select public.maint_remind()');

create or replace function public.delete_item(p_id integer) returns text language plpgsql security definer set search_path to 'public' as $$
declare v_name text; n int;
begin
  if not has_role('owner') then raise exception 'Only Admin can delete an item.'; end if;
  select name into v_name from items where id = p_id;
  if v_name is null then raise exception 'Item not found.'; end if;
  select (select count(*) from indent_lines where item_id = p_id) + (select count(*) from po_lines where item_id = p_id) + (select count(*) from grn_lines where item_id = p_id)
       + (select count(*) from issue_lines where item_id = p_id) + (select count(*) from stock_count_lines where item_id = p_id) + (select count(*) from sos_alerts where item_id = p_id)
       + (select count(*) from recipe_lines where item_id = p_id) + (select count(*) from stock_ledger where item_id = p_id and movement <> 'opening') into n;
  if n > 0 then raise exception '% has been used in indents, orders, recipes or stock movements, so it cannot be deleted. Make it inactive instead.', v_name; end if;
  alter table stock_ledger disable trigger stock_ledger_no_update;
  delete from stock_ledger where item_id = p_id and movement = 'opening';
  alter table stock_ledger enable trigger stock_ledger_no_update;
  delete from items where id = p_id;
  insert into audit_log(table_name,row_id,action,new_row) values ('items', p_id::text, 'delete_item', jsonb_build_object('name', v_name));
  return v_name;
end $$;

revoke all on function public.import_items(jsonb), public.import_opening(jsonb), public.import_menu_rows(jsonb), public.save_recipe(int,text,numeric,text,jsonb), public.import_recipes(jsonb), public.save_durable(int,text,text,numeric,numeric,text,boolean), public.save_durable_count(text,jsonb), public.import_durables(jsonb), public.save_maint(int,text,text,text,text,int,date,text), public.maint_done(int,date,numeric,text,text), public.delete_maint(int), public.maint_remind() from public, anon;
grant execute on function public.import_items(jsonb), public.import_opening(jsonb), public.import_menu_rows(jsonb), public.save_recipe(int,text,numeric,text,jsonb), public.import_recipes(jsonb), public.save_durable(int,text,text,numeric,numeric,text,boolean), public.save_durable_count(text,jsonb), public.import_durables(jsonb), public.save_maint(int,text,text,text,text,int,date,text), public.maint_done(int,date,numeric,text,text), public.delete_maint(int) to authenticated;

grant select on public.recipes, public.recipe_lines, public.durable_items, public.durable_counts, public.durable_count_lines, public.maint_tasks, public.maint_log to authenticated;
grant usage, select on all sequences in schema public to authenticated;
