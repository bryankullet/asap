-- 0025 — The API registers its own key on boot
--
-- app.api_keys (0023) was filled by hand with scripts/set-api-internal-key.sh. From here the API
-- does it itself: on boot, with the service client, it calls api_key_register(sha256 of its
-- API_INTERNAL_KEY). If an active row already matches, nothing changes; otherwise every other
-- active row is revoked and the new hash inserted. Only the hash ever reaches the database; the
-- plaintext lives in the API's environment and nowhere else. service_role only.
create or replace function public.api_key_register(p_key_hash text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_exists boolean;
begin
  if p_key_hash is null or p_key_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'key_hash_invalid' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('app.api_keys'));
  select exists (select 1 from app.api_keys where key_hash = p_key_hash and revoked_at is null) into v_exists;
  if v_exists then return false; end if;
  update app.api_keys set revoked_at = now() where revoked_at is null;
  insert into app.api_keys (key_hash, label) values (p_key_hash, 'api')
  on conflict (key_hash) do update set revoked_at = null;
  return true;
end;
$$;
revoke all on function public.api_key_register(text) from public, anon, authenticated, asap_worker;
grant execute on function public.api_key_register(text) to service_role;
