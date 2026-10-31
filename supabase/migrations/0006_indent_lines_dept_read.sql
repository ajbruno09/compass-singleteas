-- A counter can always read back its own indent lines (after sending, while the store works on it).
drop policy if exists indent_lines_dept_read on public.indent_lines;
create policy indent_lines_dept_read on public.indent_lines for select to authenticated
  using (exists (select 1 from public.indents i where i.id = indent_id and i.location_id = any(public.my_location_ids())));
