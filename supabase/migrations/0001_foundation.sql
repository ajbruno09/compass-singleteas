-- Compass foundation: people, locations, masters, vendors.
-- Money in rupees as numeric(12,2); quantities as numeric(12,3) in each item's base unit.

create extension if not exists pgcrypto;

-- ── Types ────────────────────────────────────────────────────
create type public.app_role as enum ('owner', 'manager', 'store', 'department', 'closing', 'accounts');
create type public.location_kind as enum ('store', 'department');
create type public.count_frequency as enum ('daily', 'weekly');

-- ── Settings ─────────────────────────────────────────────────
create table public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
insert into public.app_settings (key, value) values
  ('owner_emails', '["ajbruno09@gmail.com"]'),
  ('business_day_cutoff', '{"hour": 3, "minute": 0, "timezone": "Asia/Kolkata"}'),
  ('reminders', '{"indent_open": "15:30", "indent_due": "17:00", "closing_due": "22:30", "closing_escalate": "23:30"}'),
  ('staff_login_domain', '"staff.singleteas.local"');

-- ── Locations ────────────────────────────────────────────────
create table public.locations (
  id smallserial primary key,
  code text not null unique check (code ~ '^[a-z_]+$'),
  name text not null,
  kind public.location_kind not null,
  sort smallint not null default 0,
  active boolean not null default true
);
insert into public.locations (code, name, kind, sort) values
  ('store', 'Store', 'store', 0),
  ('kitchen', 'Kitchen', 'department', 1),
  ('tea_counter', 'Tea counter', 'department', 2),
  ('juice_counter', 'Juice counter', 'department', 3),
  ('pickup', 'Pickup station', 'department', 4),
  ('general_foh', 'General FOH', 'department', 5),
  ('snacks_counter', 'Snacks counter', 'department', 6);

-- ── People ───────────────────────────────────────────────────
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  phone text unique check (phone is null or phone ~ '^[6-9][0-9]{9}$'),
  email text,
  role public.app_role not null default 'department',
  extra_language text check (extra_language is null or extra_language ~ '^[a-z]{2,3}$'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profile_locations (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  location_id smallint not null references public.locations(id),
  primary key (profile_id, location_id)
);

-- Helpers used by every policy. SECURITY DEFINER so they can read profiles under RLS.
create or replace function public.my_role() returns public.app_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active
$$;

create or replace function public.has_role(variadic roles public.app_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = any(roles) from public.profiles where id = auth.uid() and active), false)
$$;

create or replace function public.my_location_ids() returns smallint[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(location_id), '{}') from public.profile_locations where profile_id = auth.uid()
$$;

-- New sign-ups: the owner email becomes owner; anyone else starts inactive until the owner sets them up.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_owner boolean;
begin
  select (value ? lower(new.email)) into v_owner from public.app_settings where key = 'owner_emails';
  insert into public.profiles (id, email, phone, full_name, role, active)
  values (
    new.id,
    lower(new.email),
    nullif(new.raw_user_meta_data->>'phone', ''),
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    case when coalesce(v_owner, false) then 'owner'::public.app_role else 'department'::public.app_role end,
    coalesce(v_owner, false) or coalesce((new.raw_app_meta_data->>'created_by_owner')::boolean, false)
  );
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Nobody but the owner changes roles or activation; people may edit their own name and language only.
create or replace function public.guard_profile_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Server-side work (no signed-in user, e.g. the staff-setup function) and the owner may change anything.
  if auth.uid() is null or public.has_role('owner') then
    return new;
  end if;
  if new.role is distinct from old.role or new.active is distinct from old.active
     or new.phone is distinct from old.phone or new.id is distinct from old.id then
    raise exception 'Only the owner can change role, phone or access';
  end if;
  return new;
end $$;
create trigger guard_profile_update before update on public.profiles
  for each row execute function public.guard_profile_update();

-- ── Units and categories ─────────────────────────────────────
create table public.units (
  code text primary key,
  name text not null,
  kind text not null check (kind in ('weight', 'volume', 'count')),
  decimals smallint not null default 0
);
insert into public.units (code, name, kind, decimals) values
  ('kg', 'Kilogram', 'weight', 3),
  ('L', 'Litre', 'volume', 3),
  ('pcs', 'Pieces', 'count', 0),
  ('pkt', 'Packet', 'count', 0),
  ('bunch', 'Bunch', 'count', 0),
  ('tray', 'Tray', 'count', 0),
  ('box', 'Box', 'count', 0),
  ('roll', 'Roll', 'count', 0),
  ('bottle', 'Bottle', 'count', 0),
  ('can', 'Can', 'count', 0),
  ('tub', 'Tub', 'count', 0),
  ('sachet', 'Sachet', 'count', 0),
  ('cyl', 'Cylinder', 'count', 0);

create table public.categories (
  id smallserial primary key,
  code text not null unique,
  name text not null,
  sort smallint not null default 0
);
insert into public.categories (code, name, sort) values
  ('food', 'Food and raw materials', 1),
  ('kitchen_consumables', 'Kitchen supplies', 2),
  ('packaging', 'Packaging', 3),
  ('daily_cleaning', 'Daily cleaning', 4),
  ('chemicals', 'Cleaning chemicals', 5),
  ('safety', 'Safety and hygiene wear', 6),
  ('guest_supplies', 'Guest and counter supplies', 7),
  ('durables', 'General and durable items', 8);

-- ── Items ────────────────────────────────────────────────────
create table public.items (
  id serial primary key,
  name text not null,
  local_names jsonb not null default '{}'::jsonb,       -- {"hi": "दही", "as": "..."}
  category_id smallint not null references public.categories(id),
  unit text not null references public.units(code),       -- the unit stock is counted in
  purchase_unit text references public.units(code),       -- the unit it is bought in, when different
  purchase_factor numeric(12,3) check (purchase_factor is null or purchase_factor > 0),
  quick_amounts numeric(12,3)[] not null default '{}',    -- one-tap amounts, in `unit`
  photo_path text,                                        -- storage path in the item-photos bucket
  count_frequency public.count_frequency not null default 'weekly',
  tolerance_pct numeric(5,2) not null default 5 check (tolerance_pct >= 0),
  last_cost numeric(12,2),                                -- rupees per `unit`
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name)
);

create table public.item_locations (
  item_id int not null references public.items(id) on delete cascade,
  location_id smallint not null references public.locations(id),
  par_level numeric(12,3),
  primary key (item_id, location_id)
);

-- ── Vendors ──────────────────────────────────────────────────
create table public.vendors (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  code text,
  category text,
  contact_person text,
  phone text,
  whatsapp text,
  email text,
  address text,
  gst text,
  credit_days int check (credit_days is null or credit_days >= 0),
  bank_name text,
  bank_account text,
  ifsc text,
  upi text,
  active boolean not null default true,
  remarks text,
  legacy_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.vendor_items (
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  item_id int not null references public.items(id) on delete cascade,
  agreed_rate numeric(12,2),
  primary key (vendor_id, item_id)
);

-- ── updated_at ───────────────────────────────────────────────
create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end $$;
create trigger touch_profiles before update on public.profiles for each row execute function public.touch_updated_at();
create trigger touch_items before update on public.items for each row execute function public.touch_updated_at();
create trigger touch_vendors before update on public.vendors for each row execute function public.touch_updated_at();

-- ── Row-level security ───────────────────────────────────────
alter table public.app_settings enable row level security;
alter table public.locations enable row level security;
alter table public.profiles enable row level security;
alter table public.profile_locations enable row level security;
alter table public.units enable row level security;
alter table public.categories enable row level security;
alter table public.items enable row level security;
alter table public.item_locations enable row level security;
alter table public.vendors enable row level security;
alter table public.vendor_items enable row level security;

create policy settings_read on public.app_settings for select to authenticated using (public.has_role('owner', 'manager'));
create policy settings_write on public.app_settings for all to authenticated using (public.has_role('owner')) with check (public.has_role('owner'));

create policy locations_read on public.locations for select to authenticated using (public.my_role() is not null);
create policy locations_write on public.locations for all to authenticated using (public.has_role('owner')) with check (public.has_role('owner'));

create policy profiles_read_self on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_read_admin on public.profiles for select to authenticated using (public.has_role('owner', 'manager'));
create policy profiles_update_self on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_update_owner on public.profiles for update to authenticated using (public.has_role('owner')) with check (public.has_role('owner'));

create policy profile_locations_read on public.profile_locations for select to authenticated using (profile_id = auth.uid() or public.has_role('owner', 'manager'));
create policy profile_locations_write on public.profile_locations for all to authenticated using (public.has_role('owner')) with check (public.has_role('owner'));

create policy units_read on public.units for select to authenticated using (public.my_role() is not null);
create policy units_write on public.units for all to authenticated using (public.has_role('owner')) with check (public.has_role('owner'));
create policy categories_read on public.categories for select to authenticated using (public.my_role() is not null);
create policy categories_write on public.categories for all to authenticated using (public.has_role('owner')) with check (public.has_role('owner'));

-- Department staff see only the items listed for their locations; costs are hidden from them by the view below.
create policy items_read_office on public.items for select to authenticated using (public.has_role('owner', 'manager', 'store', 'accounts'));
create policy items_write on public.items for all to authenticated using (public.has_role('owner', 'manager')) with check (public.has_role('owner', 'manager'));

create policy item_locations_read on public.item_locations for select to authenticated using (
  public.has_role('owner', 'manager', 'store', 'accounts') or location_id = any(public.my_location_ids()));
create policy item_locations_write on public.item_locations for all to authenticated using (public.has_role('owner', 'manager')) with check (public.has_role('owner', 'manager'));

create policy vendors_read on public.vendors for select to authenticated using (public.has_role('owner', 'manager', 'store', 'accounts'));
create policy vendors_write on public.vendors for all to authenticated using (public.has_role('owner', 'accounts')) with check (public.has_role('owner', 'accounts'));
create policy vendor_items_read on public.vendor_items for select to authenticated using (public.has_role('owner', 'manager', 'store', 'accounts'));
create policy vendor_items_write on public.vendor_items for all to authenticated using (public.has_role('owner', 'accounts', 'store')) with check (public.has_role('owner', 'accounts', 'store'));

-- Item list for department phones: only their locations' items, no cost or tolerance.
create or replace function public.department_items(p_location_id smallint)
returns table (id int, name text, local_names jsonb, category_id smallint, unit text,
               quick_amounts numeric[], photo_path text, count_frequency public.count_frequency, par_level numeric)
language sql stable security definer set search_path = public as $$
  select i.id, i.name, i.local_names, i.category_id, i.unit, i.quick_amounts, i.photo_path, i.count_frequency, il.par_level
  from public.items i join public.item_locations il on il.item_id = i.id
  where i.active and il.location_id = p_location_id
    and (p_location_id = any(public.my_location_ids()) or public.has_role('owner', 'manager', 'store'))
  order by i.category_id, i.name
$$;
revoke all on function public.department_items(smallint) from public, anon;
grant execute on function public.department_items(smallint) to authenticated;

revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.guard_profile_update() from public, anon, authenticated;
