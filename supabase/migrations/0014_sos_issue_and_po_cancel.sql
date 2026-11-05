-- SOS: the store issues from the SOS page; issued SOS auto-close 2 hours later if the counter never confirms.
alter table public.sos_alerts add column if not exists issue_id uuid references public.issues(id);
alter table public.sos_alerts add column if not exists issued_at timestamptz;
alter table public.sos_alerts add column if not exists issued_by uuid references public.profiles(id);
alter table public.sos_alerts add column if not exists auto_closed boolean not null default false;

create or replace function public.issue_sos(p_id uuid, p_lines jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.sos_alerts; res jsonb;
begin
  if not public.has_role('owner', 'store') then raise exception 'Only the store can issue items.'; end if;
  select * into a from public.sos_alerts where id = p_id for update;
  if a.id is null or a.resolved_at is not null then raise exception 'This SOS is already closed.'; end if;
  if a.issued_at is not null then raise exception 'Items for this SOS were already issued.'; end if;
  res := public.create_issue(a.location_id, p_lines);
  update public.sos_alerts set issue_id = (res->>'id')::uuid, issued_at = now(), issued_by = auth.uid(),
         acked_by = coalesce(acked_by, auth.uid()), acked_at = coalesce(acked_at, now())
   where id = p_id;
  return res;
end $$;
revoke all on function public.issue_sos(uuid, jsonb) from public, anon;
grant execute on function public.issue_sos(uuid, jsonb) to authenticated;

create or replace function public.sos_sweep() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.sos_alerts set resolved_at = now(), auto_closed = true
   where resolved_at is null and issued_at is not null and issued_at < now() - interval '2 hours';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.sos_sweep() from public, anon;
grant execute on function public.sos_sweep() to authenticated;

-- Purchase orders: the store asks to cancel, only Admin approves. Nothing is deleted.
create table if not exists public.po_cancel_requests (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references public.purchase_orders(id) on delete cascade,
  requested_by uuid references public.profiles(id),
  reason text not null,
  requested_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  decision_note text not null default ''
);
create unique index if not exists po_cancel_one_pending on public.po_cancel_requests(po_id) where status = 'pending';
alter table public.po_cancel_requests enable row level security;
drop policy if exists po_cancel_read on public.po_cancel_requests;
create policy po_cancel_read on public.po_cancel_requests for select to authenticated using (public.has_role('owner', 'manager', 'store'));
grant select on public.po_cancel_requests to authenticated;

create or replace function public.request_po_cancel(p_po_id uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare st public.po_status; rid uuid; ids uuid[]; pn text;
begin
  if not public.has_role('owner', 'store') then raise exception 'Only the store can ask to cancel an order.'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Please write the reason.'; end if;
  select status, po_number into st, pn from public.purchase_orders where id = p_po_id;
  if st is null then raise exception 'Order not found.'; end if;
  if st not in ('draft', 'sent') then raise exception 'This order can no longer be cancelled. Goods are already received or it is cancelled.'; end if;
  insert into public.po_cancel_requests(po_id, requested_by, reason) values (p_po_id, auth.uid(), trim(p_reason)) returning id into rid;
  select coalesce(array_agg(id), '{}') into ids from public.profiles where role = 'owner' and active;
  begin perform public.notify(null, ids, 'Cancel order?', 'The store asks to cancel ' || pn || '. Reason: ' || trim(p_reason), '/buying', 'pocancel-' || rid::text, false);
  exception when others then null; end;
  return rid;
end $$;

create or replace function public.decide_po_cancel(p_request_id uuid, p_approve boolean, p_note text default '') returns void
language plpgsql security definer set search_path = public as $$
declare r public.po_cancel_requests;
begin
  if not public.has_role('owner') then raise exception 'Only Admin can approve this.'; end if;
  select * into r from public.po_cancel_requests where id = p_request_id for update;
  if r.id is null or r.status <> 'pending' then raise exception 'This request is already decided.'; end if;
  update public.po_cancel_requests set status = case when p_approve then 'approved' else 'rejected' end, decided_by = auth.uid(), decided_at = now(), decision_note = coalesce(p_note, '') where id = r.id;
  if p_approve then
    update public.purchase_orders set status = 'cancelled' where id = r.po_id and status in ('draft', 'sent');
    if not found then raise exception 'This order can no longer be cancelled.'; end if;
  end if;
end $$;

create or replace function public.cancel_po(p_po_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  if not public.has_role('owner') then raise exception 'Only Admin can cancel an order.'; end if;
  update public.po_cancel_requests set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = 'Admin cancelled directly' where po_id = p_po_id and status = 'pending';
  insert into public.po_cancel_requests(po_id, requested_by, reason, status, decided_by, decided_at) values (p_po_id, auth.uid(), coalesce(nullif(trim(p_reason), ''), 'Cancelled by Admin'), 'approved', auth.uid(), now()) returning id into rid;
  update public.purchase_orders set status = 'cancelled' where id = p_po_id and status in ('draft', 'sent');
  if not found then raise exception 'This order can no longer be cancelled.'; end if;
end $$;

revoke all on function public.request_po_cancel(uuid, text), public.decide_po_cancel(uuid, boolean, text), public.cancel_po(uuid, text) from public, anon;
grant execute on function public.request_po_cancel(uuid, text), public.decide_po_cancel(uuid, boolean, text), public.cancel_po(uuid, text) to authenticated;
