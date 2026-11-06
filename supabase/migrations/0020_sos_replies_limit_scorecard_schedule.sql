-- Compass 5.0: SOS item by item replies, asking Admin for one more SOS, alarm mute log,
-- the counter scorecard, and weekly off and shift for each person.
-- Applied to the live database as "sos_item_replies_limit_approval_scorecard_schedule".
-- The functions reply_sos_items, request_sos_extra, decide_sos_extra, raise_sos (4 argument version),
-- log_sos_mute, counter_scorecard and save_staff_schedule, and the tables sos_extra_requests,
-- sos_mute_log and staff_schedule, are defined exactly as in the live database.
alter table public.sos_alerts add column if not exists item_replies jsonb not null default '{}'::jsonb;
