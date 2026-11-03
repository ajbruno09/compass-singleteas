-- Wave 1 functions and rules seed
create or replace function public.rule_value(p_key text) returns jsonb language sql stable security definer set search_path=public as $$
  select coalesce((select h.value from rule_history h where h.key=p_key and h.effective_from<=current_date order by h.effective_from desc, h.id desc limit 1),(select value from rules where key=p_key))
$$;

create or replace function public.set_rule(p_key text, p_value jsonb, p_from date, p_note text) returns void language plpgsql security definer set search_path=public as $$
declare r rules; f date;
begin
  if not public.has_role('owner') then raise exception 'Only the owner can change rules'; end if;
  select * into r from rules where key=p_key;
  if not found then raise exception 'Unknown rule'; end if;
  f := case when r.wired then current_date else greatest(coalesce(p_from,current_date),current_date) end;
  insert into rule_history(key,value,effective_from,set_by,note) values (p_key,p_value,f,auth.uid(),coalesce(p_note,''));
  if f<=current_date then
    update rules set value=p_value, updated_at=now() where key=p_key;
    if p_key in ('indent_open','indent_due','closing_due','closing_escalate') then
      update app_settings set value=jsonb_set(value,array[p_key],p_value), updated_at=now() where key='reminders';
    end if;
  end if;
end $$;

create or replace function public.import_menu(p jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare i jsonb; ni int:=0; nc int:=0;
begin
  if not public.has_role('owner') then raise exception 'Only the owner can load the menu'; end if;
  for i in select * from jsonb_array_elements(p->'items') loop
    if not exists (select 1 from menu_items where name=i->>'n') and not exists (select 1 from ignored_pos_items where pos_name=i->>'pp') then
      insert into menu_items(name,pos_name,price,menu_page,menu_group,location_id,status,needs_check,note)
      values (i->>'n',nullif(i->>'pp',''),nullif(i->>'pr','')::numeric,i->>'pg',i->>'g',nullif(i->>'l','')::smallint,coalesce(i->>'s','active'),coalesce((i->>'c')::boolean,false),coalesce(i->>'nt',''));
      ni:=ni+1;
    end if;
  end loop;
  for i in select * from jsonb_array_elements(p->'combos') loop
    if not exists (select 1 from menu_combos where name=i->>'n') then
      insert into menu_combos(name,price,grp,parts) values (i->>'n',nullif(i->>'pr','')::numeric,i->>'g',coalesce(i->>'p',''));
      nc:=nc+1;
    end if;
  end loop;
  return jsonb_build_object('items',ni,'combos',nc);
end $$;

create or replace function public.purge_menu_item(p_id int) returns void language plpgsql security definer set search_path=public as $$
declare m menu_items;
begin
  if not public.has_role('owner') then raise exception 'Only the owner can remove menu items for good'; end if;
  select * into m from menu_items where id=p_id;
  if not found then return; end if;
  insert into audit_log(table_name,row_id,action,old_row) values ('menu_items',p_id::text,'purge',to_jsonb(m));
  if m.pos_name is not null then insert into ignored_pos_items(pos_name,reason,created_by) values (m.pos_name,'Removed from Compass',auth.uid()) on conflict do nothing; end if;
  delete from menu_items where id=p_id;
end $$;

create or replace function public.raise_alert(p_level text,p_title text,p_body text default '',p_roles text[] default '{owner}',p_location smallint default null,p_source text default '') returns uuid language plpgsql security definer set search_path=public as $$
declare v uuid;
begin
  insert into alerts(level,title,body,target_roles,location_id,source) values (p_level,p_title,p_body,p_roles,p_location,p_source) returning id into v;
  if p_level='urgent' then perform public.notify(p_roles,null,p_title,p_body,'/','alert',true); end if;
  return v;
end $$;

create or replace function public.finish_alert(p_id uuid) returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.has_role('owner','manager') then raise exception 'Not allowed'; end if;
  update alerts set done_at=now(), done_by=auth.uid() where id=p_id and done_at is null;
end $$;

create or replace function public.mark_notice_read(p_id uuid) returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null then return; end if;
  if not exists (select 1 from notice_reads where notice_id=p_id and profile_id=auth.uid()) then insert into notice_reads(notice_id,profile_id) values (p_id,auth.uid()); end if;
end $$;

create or replace function public.submit_signup(p_name text,p_phone text,p_locs int[],p_selfie text) returns text language plpgsql security definer set search_path=public as $$
begin
  if length(trim(coalesce(p_name,'')))<2 then return 'Please enter your name.'; end if;
  if coalesce(p_phone,'') !~ '^[6-9][0-9]{9}$' then return 'Enter your 10 digit mobile number.'; end if;
  if coalesce(length(p_selfie),0)<500 or length(p_selfie)>250000 then return 'Please send a clear photo of your face.'; end if;
  if exists (select 1 from profiles where phone=p_phone) then return 'This number is already registered. Please ask the owner.'; end if;
  if exists (select 1 from pending_signups where phone=p_phone and status='pending') then return 'Your request is already with the owner.'; end if;
  insert into pending_signups(full_name,phone,location_ids,selfie) values (trim(p_name),p_phone,coalesce(p_locs,'{}'),p_selfie);
  insert into alerts(level,title,body,target_roles,source) values ('today','New staff sign up',trim(p_name)||' ('||p_phone||') is waiting for approval','{owner}','signup');
  return 'ok';
end $$;

create or replace function public.decide_signup(p_id uuid,p_ok boolean,p_user uuid default null) returns void language plpgsql security definer set search_path=public as $$
declare s pending_signups;
begin
  if not public.has_role('owner') then raise exception 'Only the owner can approve sign ups'; end if;
  select * into s from pending_signups where id=p_id;
  if not found then raise exception 'Request not found'; end if;
  update pending_signups set status=case when p_ok then 'approved' else 'declined' end, decided_by=auth.uid(), decided_at=now() where id=p_id;
  if p_ok and p_user is not null then update profiles set photo=s.selfie where id=p_user; end if;
  update alerts set done_at=now(), done_by=auth.uid() where source='signup' and done_at is null and body like s.full_name||'%';
end $$;

create or replace function public.set_my_photo(p_photo text) returns text language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null then return 'Please sign in again.'; end if;
  if coalesce(length(p_photo),0)<500 or length(p_photo)>250000 then return 'That photo is not usable. Please try again.'; end if;
  update profiles set photo=p_photo, updated_at=now() where id=auth.uid();
  return 'ok';
end $$;

create or replace function public.clear_photo(p_user uuid) returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.has_role('owner') then raise exception 'Only the owner can do this'; end if;
  update profiles set photo=null, updated_at=now() where id=p_user;
end $$;

revoke all on function public.rule_value(text),public.set_rule(text,jsonb,date,text),public.import_menu(jsonb),public.purge_menu_item(int),public.raise_alert(text,text,text,text[],smallint,text),public.finish_alert(uuid),public.mark_notice_read(uuid),public.submit_signup(text,text,int[],text),public.decide_signup(uuid,boolean,uuid),public.set_my_photo(text),public.clear_photo(uuid) from public;
grant execute on function public.rule_value(text),public.set_rule(text,jsonb,date,text),public.import_menu(jsonb),public.purge_menu_item(int),public.finish_alert(uuid),public.mark_notice_read(uuid),public.decide_signup(uuid,boolean,uuid),public.set_my_photo(text),public.clear_photo(uuid) to authenticated;
grant execute on function public.submit_signup(text,text,int[],text) to anon, authenticated;
grant execute on function public.raise_alert(text,text,text,text[],smallint,text) to service_role;

insert into rules(key,label,description,group_name,kind,unit,value,wired,money,sort,why) values
('indent_open','Indent opens','When departments can start sending their indent.','Reminders','time','','"15:30"',true,false,10,''),
('indent_due','Indent due','Indents should be in by this time.','Reminders','time','','"17:00"',true,false,11,''),
('closing_due','Closing due','Day end closing should be done by this time.','Reminders','time','','"22:30"',true,false,12,''),
('closing_escalate','Closing escalates','If closing is still pending, the owner is told at this time.','Reminders','time','','"23:30"',true,false,13,''),
('sos_escalate_seconds','SOS escalates after','If nobody answers an SOS in this time, it goes to the next person.','Urgent requests','number','seconds','120',false,false,20,''),
('sos_review_time','SOS review time','When the day end review of SOS reasons is shown.','Urgent requests','time','','"22:00"',false,false,21,''),
('po_round_step','Round purchase quantities to','Purchase orders are rounded up to this step.','Buying','number','','0.5',false,false,30,''),
('closing_window_open','Closing count opens','Night stock counts can start from this time.','Closing stock','time','','"22:30"',false,false,40,''),
('closing_window_late','Closing count accepted until','Counts after closing time and up to this time next morning are marked late.','Closing stock','time','','"09:00"',false,false,41,''),
('overstock_days','Overstock after','More than this many days of stock in a kitchen counts as overstock.','Closing stock','number','days','2',false,false,42,''),
('overstock_mode','Overstock action','advice_only shows advice; approval asks the store manager or owner to approve the indent.','Closing stock','text','','"advice_only"',false,false,43,''),
('wastage_allowance_pct','Wastage allowed','Default wastage allowed before it is flagged. Items can have their own.','Wastage','percent','%','5',false,false,50,''),
('refill_buffer_pct','Refill buffer','Extra allowed for refills such as sambar.','Wastage','percent','%','20',false,false,51,''),
('unknown_item_alert','Alert on unknown items billed','Tell the owner right away when the POS sends an item Compass does not know or has switched off.','Alerts','text','','"on"',false,false,60,''),
('salary_target_pct','Salary target','Target pay cost as a share of sales.','Business model (draft)','percent','%','20',false,true,70,'Draft'),
('incentive_launch_rate_pct','Incentive launch rate','Incentive share during the launch months.','Business model (draft)','percent','%','25',false,true,71,'Draft'),
('incentive_launch_months','Launch period','How long the launch rate runs.','Business model (draft)','number','months','3',false,true,72,'Draft'),
('incentive_rate_after_pct','Incentive rate after launch','Incentive share after the launch months.','Business model (draft)','percent','%','15',false,true,73,'Draft'),
('cost_band_free_max','Cost band: free up to','Food cost percent up to which there is no deduction.','Business model (draft)','percent','%','40',false,true,74,'Draft'),
('cost_band_41_45','Cost band 41 to 45%','Amount held back in this band.','Business model (draft)','money','','1000',false,true,75,'Draft'),
('cost_band_45_50','Cost band 45 to 50%','Amount held back in this band.','Business model (draft)','money','','2500',false,true,76,'Draft'),
('cost_band_above_50','Cost band above 50%','Amount held back in this band.','Business model (draft)','money','','5000',false,true,77,'Draft')
on conflict (key) do nothing;
insert into rule_history(key,value,effective_from,note) select key,value,current_date,'Starting value' from rules r where not exists (select 1 from rule_history h where h.key=r.key);
