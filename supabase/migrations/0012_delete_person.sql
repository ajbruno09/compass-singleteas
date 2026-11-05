-- Admin only. Deletes a person's login. Anyone with real work recorded (sent indents, counts, receipts, bills) cannot be deleted, only switched off.
create or replace function delete_person(p_user uuid) returns text
language plpgsql security definer set search_path = public, auth as $$
declare r app_role;
begin
  if not has_role('owner') then raise exception 'Only Admin can do this'; end if;
  if p_user = auth.uid() then raise exception 'You cannot delete yourself'; end if;
  select role into r from profiles where id = p_user;
  if r is null then raise exception 'Person not found'; end if;
  if r = 'owner' then raise exception 'An Admin login cannot be deleted'; end if;
  begin
    -- unsent drafts are not real work, so they go with the person
    delete from indents where created_by = p_user and status = 'draft';
    delete from auth.users where id = p_user;
  exception when foreign_key_violation then
    return 'has_work';
  end;
  return 'deleted';
end $$;
revoke all on function delete_person(uuid) from public, anon;
grant execute on function delete_person(uuid) to authenticated;
