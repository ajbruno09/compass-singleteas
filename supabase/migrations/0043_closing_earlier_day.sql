-- Owner can close an earlier day (for example to show a new person how it works).
drop function if exists public.closing_today();
drop function if exists public.closing_save(jsonb);
drop function if exists public.closing_submit(jsonb);

create or replace function public.closing_pick(p_date date) returns date
language plpgsql stable security definer set search_path = public as $$
declare v date := public.business_date(now());
begin
  if p_date is null or p_date = v then return v; end if;
  if not public.has_role('owner') then raise exception 'Only the owner can close an earlier day'; end if;
  if p_date > v or p_date < v - 60 then raise exception 'Pick a date within the last 60 days'; end if;
  return p_date;
end $$;

create or replace function public.closing_today(p_date date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r public.daily_closings; v date;
begin
  if not public.closing_can_do() and not public.has_role('accounts') then raise exception 'Not allowed'; end if;
  v := public.closing_pick(p_date);
  select * into r from public.daily_closings where business_date = v;
  return jsonb_build_object('business_date', v,
    'row', case when r.id is null then null else jsonb_build_object('id', r.id, 'status', r.status, 'data', r.data, 'submitted_at', r.submitted_at, 'reopen_reason', r.reopen_reason, 'combined', r.combined_var, 'digital', r.digital_var, 'cash', r.cash_var) end);
end $$;

create or replace function public.closing_save(p_data jsonb, p_date date default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_bd date; r public.daily_closings;
begin
  if not public.closing_can_do() then raise exception 'Not allowed'; end if;
  v_bd := public.closing_pick(p_date);
  select * into r from public.daily_closings where business_date = v_bd for update;
  if r.id is null then
    insert into public.daily_closings (business_date, data, created_by) values (v_bd, p_data, auth.uid()) returning * into r;
  elsif r.status in ('draft','reopened') then
    update public.daily_closings set data = p_data, updated_at = now() where id = r.id returning * into r;
  else
    raise exception 'This report is locked';
  end if;
  return jsonb_build_object('ok', true, 'id', r.id);
end $$;

create or replace function public.closing_submit(p_data jsonb, p_date date default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_bd date; r public.daily_closings; c jsonb; v_name text;
begin
  if not public.closing_can_do() then raise exception 'Not allowed'; end if;
  v_bd := public.closing_pick(p_date);
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
