-- pgTAP: 0025 — two boots with the same key register once; a boot with a new key revokes the old.
begin;
select plan(8);
select throws_ok($$select public.api_key_register('not-a-hash')$$, '22023', 'key_hash_invalid', 'a non-sha256 value is refused');
create or replace function pg_temp.boot(p_hash text) returns boolean language plpgsql as $$
declare v boolean;
begin
  perform set_config('role', 'service_role', true);
  select public.api_key_register(p_hash) into v;
  perform set_config('role', 'none', true);
  return v;
end $$;
select is(pg_temp.boot(repeat('a', 64)), true, 'first boot registers');
select is(pg_temp.boot(repeat('a', 64)), false, 'second boot with the same key registers nothing');
select is((select count(*) from app.api_keys where revoked_at is null), 1::bigint, 'exactly one active key');
select is(pg_temp.boot(repeat('b', 64)), true, 'a boot with a new key registers it');
select is((select revoked_at is not null from app.api_keys where key_hash = repeat('a', 64)), true, 'and revokes the old one');
select is((select count(*) from app.api_keys where revoked_at is null), 1::bigint, 'still exactly one active key');
set role authenticated;
select throws_ok($$select public.api_key_register(repeat('c', 64))$$, '42501', null, 'signed-in users cannot register keys');
reset role;
select * from finish();
rollback;
