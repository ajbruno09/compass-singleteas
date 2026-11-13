-- Compass 5.118 follow-ups, applied after 0033.
-- 1. The scorecard measures the business day, and "ordering finished" is for the next day's buying.
do $$ declare f text; begin
  f := pg_get_functiondef('public._sc_day(date,date,date)'::regprocedure);
  f := replace(f, 'from buy_day_close c where c.for_date = d)', 'from buy_day_close c where c.for_date = d + 1)');
  execute f;
  f := pg_get_functiondef('public.store_scorecard()'::regprocedure);
  f := replace(f, E'begin fd := indent_for_date(); exception when others then fd := bd; end;\n  if fd is null then fd := bd; end if;', 'fd := bd;');
  f := replace(f, 'select undecided into undec from buy_day_state where for_date = fd;', 'select undecided into undec from buy_day_state where for_date = fd + 1;');
  f := replace(f, 'closed := exists (select 1 from buy_day_close where for_date = fd);', 'closed := exists (select 1 from buy_day_close where for_date = fd + 1);');
  execute f;
end $$;
-- 2. buy_day_status and store_today were created in the Supabase editor in the same session (see git history of this file's neighbours).
