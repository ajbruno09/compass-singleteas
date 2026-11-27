-- Daily closing (cash and POS reconciliation), moved from the separate Daily Closing app into Compass.
-- New role: closing_staff (added as an enum value in its own statement before this file).
-- One report per business day. Draft saves as you go. Submit locks it. Staff can ask to reopen; manager, owner or accounts approve.

create table if not exists public.daily_closings (
  id uuid primary key default gen_random_uuid(),
  business_date date not null unique,
  status text not null default 'draft' check (status in ('draft','submitted','reopen_requested','reopened','verified','flagged')),
  data jsonb not null default '{}'::jsonb,
  pos_total numeric,
  digital_var numeric,
  cash_var numeric,
  combined_var numeric,
  closing_cash numeric,
  created_by uuid references public.profiles(id),
  submitted_by uuid references public.profiles(id),
  submitted_at timestamptz,
  reopen_reason text,
  review_note text,
  accounts_count numeric,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  events jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.daily_closings enable row level security;
drop policy if exists closings_read on public.daily_closings;
create policy closings_read on public.daily_closings for select to authenticated
  using (public.has_role('owner','manager','accounts'));

-- The money maths, one place. Same rules as the old app (checked against 26 Nov: digital +855, cash -1654).
create or replace function public.closing_calc(p jsonb) returns jsonb
language plpgsql stable as $$
declare
  v_card numeric := coalesce(nullif(p->>'card','')::numeric,0);
  v_upi numeric := coalesce(nullif(p->>'upi','')::numeric,0);
  v_qr numeric := coalesce(nullif(p->>'qr','')::numeric,0);
  v_cash numeric := coalesce(nullif(p->>'cash','')::numeric,0);
  v_paytm numeric := coalesce(nullif(p->>'paytm','')::numeric,0);
  v_open numeric := coalesce(nullif(p->>'open','')::numeric,0);
  v_out numeric := coalesce(nullif(p->>'withdrawn','')::numeric,0);
  v_edc numeric := 0; v_old numeric := 0; v_counted numeric := 0; d text;
begin
  if coalesce((p->>'edcYes')::boolean,false) then
    select coalesce(sum(coalesce(nullif(r->>'amt','')::numeric,0)),0) into v_edc from jsonb_array_elements(coalesce(p->'edc','[]'::jsonb)) r;
  end if;
  if coalesce((p->>'oldYes')::boolean,false) then
    select coalesce(sum(coalesce(nullif(r->>'amt','')::numeric,0)),0) into v_old from jsonb_array_elements(coalesce(p->'olds','[]'::jsonb)) r where r->>'method' = 'Cash';
  end if;
  foreach d in array array['500','200','100','50','20','10','5','2','1'] loop
    v_counted := v_counted + d::numeric * coalesce(nullif(p->'n'->>d,'')::numeric,0);
  end loop;
  return jsonb_build_object(
    'digital', v_paytm - v_edc - (v_card + v_upi + v_qr),
    'cash', (v_counted + v_out) - v_open - v_old - v_cash,
    'combined', (v_paytm - v_edc - (v_card + v_upi + v_qr)) + ((v_counted + v_out) - v_open - v_old - v_cash),
    'counted', v_counted,
    'closing', v_counted + v_out
  );
end $$;

create or replace function public.closing_can_do() returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_role('owner','manager','closing_staff');
$$;

create or replace function public.closing_today() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r public.daily_closings;
begin
  if not public.closing_can_do() and not public.has_role('accounts') then raise exception 'Not allowed'; end if;
  select * into r from public.daily_closings where business_date = public.business_date(now());
  return jsonb_build_object('business_date', public.business_date(now()),
    'row', case when r.id is null then null else jsonb_build_object('id', r.id, 'status', r.status, 'data', r.data, 'submitted_at', r.submitted_at, 'reopen_reason', r.reopen_reason, 'combined', r.combined_var, 'digital', r.digital_var, 'cash', r.cash_var) end);
end $$;

create or replace function public.closing_save(p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_bd date := public.business_date(now()); r public.daily_closings;
begin
  if not public.closing_can_do() then raise exception 'Not allowed'; end if;
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
  return jsonb_build_object('ok', true, 'digital', c->'digital', 'cash', c->'cash', 'combined', c->'combined');
end $$;

create or replace function public.closing_request_reopen(p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_bd date := public.business_date(now()); r public.daily_closings; v_name text;
begin
  if not public.closing_can_do() then raise exception 'Not allowed'; end if;
  select * into r from public.daily_closings where business_date = v_bd for update;
  if r.id is null or r.status <> 'submitted' then raise exception 'Nothing to reopen'; end if;
  select full_name into v_name from public.profiles where id = auth.uid();
  update public.daily_closings set status = 'reopen_requested', reopen_reason = nullif(trim(p_reason),''), updated_at = now(),
    events = events || jsonb_build_array(jsonb_build_object('at', now(), 'by', v_name, 'what', 'Asked to open for change', 'note', nullif(trim(p_reason),'')))
  where id = r.id;
  insert into public.notices (title, body, pinned, profile_ids, created_by, expires_at)
  select 'Closing: change requested', coalesce(v_name,'Staff') || ' asked to change the closing report for ' || to_char(v_bd,'DD Mon') || '. Reason: ' || coalesce(nullif(trim(p_reason),''),'none given') || '. Open Daily closing to allow it.', true, array_agg(id), auth.uid(), now() + interval '3 days'
  from public.profiles where role in ('owner','manager') and active having count(*) > 0;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.closing_reopen(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.daily_closings; v_name text;
begin
  if not public.has_role('owner','manager','accounts') then raise exception 'Not allowed'; end if;
  select * into r from public.daily_closings where id = p_id for update;
  if r.id is null or r.status not in ('submitted','reopen_requested','flagged') then raise exception 'Cannot reopen this report'; end if;
  select full_name into v_name from public.profiles where id = auth.uid();
  update public.daily_closings set status = 'reopened', updated_at = now(),
    events = events || jsonb_build_array(jsonb_build_object('at', now(), 'by', v_name, 'what', 'Opened for change'))
  where id = r.id;
  if r.submitted_by is not null then
    insert into public.notices (title, body, pinned, profile_ids, created_by, expires_at)
    values ('Closing report opened', 'Your closing report for ' || to_char(r.business_date,'DD Mon') || ' is open for change. Make the change and submit it again.', true, array[r.submitted_by], auth.uid(), now() + interval '3 days');
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.closing_review(p_id uuid, p_action text, p_note text default null, p_count numeric default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.daily_closings; v_name text;
begin
  if not public.has_role('owner','manager','accounts') then raise exception 'Not allowed'; end if;
  if p_action not in ('verified','flagged') then raise exception 'Bad action'; end if;
  select * into r from public.daily_closings where id = p_id for update;
  if r.id is null or r.status not in ('submitted','verified','flagged','reopen_requested') then raise exception 'Cannot review this report'; end if;
  select full_name into v_name from public.profiles where id = auth.uid();
  update public.daily_closings set status = p_action, review_note = nullif(trim(coalesce(p_note,'')),''), accounts_count = p_count, reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now(),
    events = events || jsonb_build_array(jsonb_build_object('at', now(), 'by', v_name, 'what', initcap(p_action), 'note', nullif(trim(coalesce(p_note,'')),'')))
  where id = r.id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.closing_list(p_limit int default 60) returns setof public.daily_closings
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_role('owner','manager','accounts') then raise exception 'Not allowed'; end if;
  return query select * from public.daily_closings order by business_date desc limit greatest(p_limit,1);
end $$;

-- Any person can also be given POS closing with the "Can do POS closing" tick in People (duty_people, duty = 'pos_closing').
create or replace function public.closing_can_do() returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_role('owner','manager','closing_staff')
      or exists (select 1 from public.duty_people d join public.profiles p on p.id = d.profile_id
                 where d.duty = 'pos_closing' and d.profile_id = auth.uid() and p.active);
$$;
