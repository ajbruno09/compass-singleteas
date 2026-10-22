-- 0003: table permissions for signed-in users, tighter function access, and flags on imported bills.

-- Table permissions for signed-in users. Row-level security still decides which rows each person can see or change.
grant usage on schema public to authenticated;
grant select, insert, update, delete on
  public.app_settings, public.locations, public.profile_locations, public.units, public.categories,
  public.items, public.item_locations, public.vendors, public.vendor_items,
  public.indents, public.indent_lines, public.purchase_orders, public.po_lines,
  public.goods_receipts, public.grn_lines, public.issues, public.issue_lines,
  public.stock_counts, public.stock_count_lines
  to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update on public.vendor_bills to authenticated;
grant select, insert on public.bill_payments to authenticated;
grant select on public.stock_ledger, public.audit_log, public.stock_on_hand, public.vendor_bill_balances to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on function public.department_items(smallint), public.issue_items_to_confirm(uuid),
  public.post_opening_stock(smallint, int, numeric, text) to authenticated;

revoke execute on function public.business_date(timestamptz) from public, anon;
revoke execute on function public.has_role(public.app_role[]) from public, anon;
revoke execute on function public.my_location_ids() from public, anon;
revoke execute on function public.my_role() from public, anon;
grant execute on function public.business_date(timestamptz), public.has_role(public.app_role[]), public.my_location_ids(), public.my_role() to authenticated;
revoke all on function public.import_legacy_bills(jsonb) from public, anon, authenticated;

update public.vendor_bills set remarks = concat_ws(' | ', nullif(remarks,''), 'Check: same amount and same UPI reference as another Hyperpure bill a day apart; may be entered twice')
 where legacy_id in ('14d7bb34-89cf-452f-bbc4-9fce55cd158a','eeea063b-7362-4008-b118-6e9e65f21a28','110400e2-b335-43f1-bc5c-d06d12ccc059','ffe775e3-5f78-48c6-b5bc-252005f145e1')
   and remarks not like '%Check:%';
update public.vendor_bills set remarks = concat_ws(' | ', nullif(remarks,''), 'Check: Hyperpure-style bill number and the same amount as Hyperpure order 29348875 on 20 Aug; may be the same bill under the wrong vendor')
 where legacy_id = 'e76830cd-8752-4635-9abd-d2c7ff8b4c12' and remarks not like '%Check:%';
update public.vendor_bills set remarks = concat_ws(' | ', nullif(remarks,''), 'Note: one UPI reference covers two Murthy Gas bills; fine if a single payment of Rs 12,400 was made')
 where legacy_id in ('3295f4c8-b782-4f7a-90c8-4879486501bc','6e25d7b9-4e76-4861-ac8e-e24d64ade443') and remarks not like '%Note:%';
