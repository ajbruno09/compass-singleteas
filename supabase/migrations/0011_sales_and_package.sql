-- Daily sales per counter, entered by Admin (until the POS feed is connected). Staff only ever see totals for their own counters.
create table if not exists daily_sales (
  business_date date not null,
  location_id int not null references locations(id),
  amount numeric(12,2) not null check (amount >= 0),
  updated_at timestamptz not null default now(),
  primary key (business_date, location_id)
);
alter table daily_sales enable row level security;
drop policy if exists daily_sales_read on daily_sales;
create policy daily_sales_read on daily_sales for select to authenticated using (has_role('owner','manager','accounts'));
grant select on daily_sales to authenticated;

-- Monthly cost of food and stay that the cafe bears for each person. Salary is deliberately never stored here.
create table if not exists staff_package (
  profile_id uuid primary key references profiles(id) on delete cascade,
  food_monthly numeric(10,2) not null default 0,
  stay_monthly numeric(10,2) not null default 0,
  updated_at timestamptz not null default now()
);
alter table staff_package enable row level security;
drop policy if exists staff_package_read on staff_package;
create policy staff_package_read on staff_package for select to authenticated using (has_role('owner') or profile_id = auth.uid());
grant select on staff_package to authenticated;

create or replace function save_sales(p_date date, p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare r jsonb; n int := 0;
begin
  if not has_role('owner','manager','accounts') then raise exception 'not allowed'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    if (r->>'amount') is null or (r->>'amount') = '' then
      delete from daily_sales where business_date = p_date and location_id = (r->>'location_id')::int;
    else
      insert into daily_sales(business_date, location_id, amount) values (p_date, (r->>'location_id')::int, (r->>'amount')::numeric)
      on conflict (business_date, location_id) do update set amount = excluded.amount, updated_at = now();
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

create or replace function my_sales() returns jsonb
language plpgsql security definer set search_path = public as $$
declare bd date := business_date(now()); mine int[] := my_location_ids(); last_d date;
        t_mine numeric; t_all numeric; m_mine numeric; m_all numeric;
begin
  select max(business_date) into last_d from daily_sales where business_date <= bd;
  if last_d is null then return jsonb_build_object('has_data', false); end if;
  select coalesce(sum(amount) filter (where location_id = any(mine)),0), coalesce(sum(amount),0) into t_mine, t_all from daily_sales where business_date = last_d;
  select coalesce(sum(amount) filter (where location_id = any(mine)),0), coalesce(sum(amount),0) into m_mine, m_all from daily_sales where business_date >= date_trunc('month', last_d)::date and business_date <= last_d;
  return jsonb_build_object('has_data', true, 'as_of', last_d, 'day_mine', t_mine, 'day_share', case when t_all>0 then round(t_mine/t_all*100,1) else 0 end,
    'month_mine', m_mine, 'month_share', case when m_all>0 then round(m_mine/m_all*100,1) else 0 end);
end $$;

create or replace function my_package() returns jsonb
language sql security definer set search_path = public as $$
  select coalesce((select jsonb_build_object('food', food_monthly, 'stay', stay_monthly) from staff_package where profile_id = auth.uid()), jsonb_build_object('food', 0, 'stay', 0));
$$;

create or replace function save_package(p_user uuid, p_food numeric, p_stay numeric) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_role('owner') then raise exception 'not allowed'; end if;
  insert into staff_package(profile_id, food_monthly, stay_monthly) values (p_user, coalesce(p_food,0), coalesce(p_stay,0))
  on conflict (profile_id) do update set food_monthly = excluded.food_monthly, stay_monthly = excluded.stay_monthly, updated_at = now();
end $$;

grant execute on function save_sales(date, jsonb), my_sales(), my_package(), save_package(uuid, numeric, numeric) to authenticated;
