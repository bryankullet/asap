-- pgTAP: opening a draft from an email (0075, D-151).
begin;
select plan(3);
select ok(not has_function_privilege('authenticated', 'public.inbound_open_draft(uuid, text, text, uuid, uuid, uuid, text, jsonb, text, text, date, text, text, text)', 'execute'), 'no session can open a draft this way');
select ok(has_function_privilege('service_role', 'public.inbound_open_draft(uuid, text, text, uuid, uuid, uuid, text, jsonb, text, text, date, text, text, text)', 'execute'), 'the engine can');
select ok(exists(select 1 from pg_constraint where conname = 'inbound_classifications_opened_has_work'), 'an opened email names the work it opened');
select * from finish();
rollback;
