-- The store can add minutes to an SOS it has answered; the counter is told.
alter table public.sos_alerts add column if not exists extended_minutes int not null default 0;

create or replace function public.extend_sos(p_id uuid, p_extra int) returns public.sos_alerts
language plpgsql security definer set search_path = public as $$
declare r public.sos_alerts; nm text;
begin
  if not public.has_role('owner', 'store') then raise exception 'Only the store can change the time.'; end if;
  if p_extra is null or p_extra < 5 or p_extra > 240 then raise exception 'Please choose between 5 and 240 minutes.'; end if;
  update public.sos_alerts
     set eta_minutes = coalesce(eta_minutes, 0) + p_extra, extended_minutes = extended_minutes + p_extra,
         acked_by = coalesce(acked_by, auth.uid()), acked_at = coalesce(acked_at, now())
   where id = p_id and resolved_at is null and issued_at is null
   returning * into r;
  if r.id is null then raise exception 'This SOS is already issued or closed.'; end if;
  select name into nm from public.locations where id = r.location_id;
  begin
    perform public.notify(null, array[r.raised_by], 'Store needs more time', 'The store needs ' || p_extra || ' more minutes for your SOS. New time: about ' || r.eta_minutes || ' minutes from when they answered.', '/', 'sos-ext-' || r.id::text || '-' || r.extended_minutes::text, false);
  exception when others then null; end;
  return r;
end $$;
revoke all on function public.extend_sos(uuid, int) from public, anon;
grant execute on function public.extend_sos(uuid, int) to authenticated;
