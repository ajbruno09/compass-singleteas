-- Compass 5.117: log of every AI bill read, so the owner can see what it costs.
create table if not exists public.bill_reads (
  id bigserial primary key,
  at timestamptz not null default now(),
  user_id uuid,
  vendor text,
  tier text not null check (tier in ('light','strong')),
  pages smallint not null default 1,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cost_usd numeric(10,5) not null default 0,
  retried boolean not null default false,
  ok boolean not null default true,
  error text
);
alter table public.bill_reads enable row level security;
drop policy if exists bill_reads_owner on public.bill_reads;
create policy bill_reads_owner on public.bill_reads for select to authenticated using (public.has_role('owner'));
grant select on public.bill_reads to authenticated;
grant select, insert on public.bill_reads to service_role;
grant usage, select on sequence public.bill_reads_id_seq to service_role;
create index if not exists bill_reads_at_idx on public.bill_reads (at desc);
alter table public.bill_reads add column if not exists paths text[], add column if not exists style text;
