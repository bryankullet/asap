-- 0029: creating a brokerage is idempotent on a client-generated request key (D-053).
--
-- The first live click-through created two brokerages: the first submit created the row but the
-- browser never saw the response, so the person submitted again. A double submit must be one row.
-- The browser generates one uuid per form mount and sends it with every attempt; the same person
-- sending the same key gets the same organization back. The key is scoped to the creator, so one
-- person's key can never return another person's brokerage.

alter table organizations add column creation_key uuid;
create unique index organizations_created_by_creation_key
  on organizations (created_by, creation_key) where creation_key is not null;

create or replace function app.create_organization(
  p_name           text,
  p_legal_name     text,
  p_country        text,
  p_currency       text,
  p_timezone       text,
  p_accepted_terms boolean,
  p_request_key    uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_org_id  uuid;
  v_role_id uuid;
begin
  if v_user_id is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  -- A repeat of a request this person already made returns the same brokerage. Checked before
  -- validation so a repeat can never fail differently from the original.
  if p_request_key is not null then
    select id into v_org_id from organizations
    where created_by = v_user_id and creation_key = p_request_key;
    if v_org_id is not null then
      update users set active_organization_id = v_org_id, updated_at = now() where id = v_user_id;
      return v_org_id;
    end if;
  end if;

  if coalesce(p_accepted_terms, false) is not true then
    raise exception 'terms_not_accepted' using errcode = '22023';
  end if;
  if p_name is null or length(trim(p_name)) < 2 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  if p_country !~ '^[A-Z]{2}$' then
    raise exception 'invalid_country' using errcode = '22023';
  end if;
  if p_currency !~ '^[A-Z]{3}$' then
    raise exception 'invalid_currency' using errcode = '22023';
  end if;
  if p_timezone is null or p_timezone not in (select name from pg_timezone_names) then
    raise exception 'invalid_timezone' using errcode = '22023';
  end if;

  begin
    insert into organizations (name, legal_name, country, currency, timezone, created_by, settings, creation_key)
    values (
      trim(p_name), nullif(trim(p_legal_name), ''), p_country, p_currency, p_timezone, v_user_id,
      jsonb_build_object('terms_accepted_at', now(), 'terms_accepted_by', v_user_id), p_request_key
    )
    returning id into v_org_id;
  exception when unique_violation then
    -- Two requests with the same key raced; the one that lost returns the winner's row.
    select id into v_org_id from organizations
    where created_by = v_user_id and creation_key = p_request_key;
    update users set active_organization_id = v_org_id, updated_at = now() where id = v_user_id;
    return v_org_id;
  end;

  perform app.seed_default_roles(v_org_id);

  select id into v_role_id from roles
  where organization_id = v_org_id and key = 'brokerage_admin';

  insert into organization_memberships (organization_id, user_id, role_id, is_owner, status)
  values (v_org_id, v_user_id, v_role_id, true, 'active');

  update users set active_organization_id = v_org_id, updated_at = now() where id = v_user_id;

  insert into audit_log (organization_id, actor_type, actor_user_id, action, object_type, object_id, new_state)
  values (v_org_id, 'user', v_user_id, 'organization.created', 'organization', v_org_id,
          jsonb_build_object('name', trim(p_name), 'country', p_country, 'currency', p_currency,
                             'timezone', p_timezone));
  insert into audit_log (organization_id, actor_type, actor_user_id, action, object_type, object_id, new_state)
  values (v_org_id, 'user', v_user_id, 'membership.created', 'membership',
          (select id from organization_memberships where organization_id = v_org_id and user_id = v_user_id),
          jsonb_build_object('user_id', v_user_id, 'role_key', 'brokerage_admin', 'is_owner', true));

  insert into events (organization_id, event_type, entity_type, entity_id, actor, actor_user_id, payload)
  values (v_org_id, 'user.action', 'organization', v_org_id, 'user', v_user_id,
          jsonb_build_object('action', 'organization.created'));

  return v_org_id;
end;
$$;
revoke all on function app.create_organization(text, text, text, text, text, boolean, uuid) from public;
grant execute on function app.create_organization(text, text, text, text, text, boolean, uuid) to authenticated;

-- The six-argument form stays for callers that have no key (pgTAP 0100 before this change) and
-- simply forwards with no key: no idempotency, exactly the old behaviour.
create or replace function app.create_organization(
  p_name text, p_legal_name text, p_country text, p_currency text, p_timezone text, p_accepted_terms boolean)
returns uuid language sql security definer set search_path = public, pg_temp
as $$ select app.create_organization(p_name, p_legal_name, p_country, p_currency, p_timezone, p_accepted_terms, null::uuid) $$;

-- Public wrapper (0024 pattern): SECURITY INVOKER, same grants; the API calls this one.
create or replace function public.create_organization(
  p_name text, p_legal_name text, p_country text, p_currency text, p_timezone text, p_accepted_terms boolean, p_request_key uuid)
returns uuid language sql security invoker set search_path = app, public, pg_temp
as $$ select app.create_organization(p_name, p_legal_name, p_country, p_currency, p_timezone, p_accepted_terms, p_request_key) $$;
revoke all on function public.create_organization(text, text, text, text, text, boolean, uuid) from public;
grant execute on function public.create_organization(text, text, text, text, text, boolean, uuid) to authenticated;
