-- 0071 — Autonomy build, phase 7 (D-145): approved messages leave through the mailbox boundary.
--
-- 1. insurer_contacts: an insurer's verified address, recorded by a person with a source. Without
--    one, an insurer message is delivered by a person, as before.
-- 2. A prepared communication sent through a connected mailbox records the send attempt that is
--    its evidence. prepared_communication_record_sent(): only for a message a person approved,
--    only on an attempt that the provider accepted and that the same person approved.

create table insurer_contacts (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  insurer_id      uuid not null references insurers(id) on delete cascade,
  email           text not null check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and email = lower(email)),
  label           text,
  -- How the person knows it is the insurer's: "Jubilee underwriting circular, Aug 2026".
  source          text not null check (length(btrim(source)) >= 3),
  verified_by     uuid not null references users(id),
  verified_at     timestamptz not null default now(),
  retired_at      timestamptz,
  created_at      timestamptz not null default now()
);
create unique index insurer_contacts_one_live_address on insurer_contacts (organization_id, insurer_id, email) where retired_at is null;
create index insurer_contacts_organization_id_idx on insurer_contacts (organization_id);
create index insurer_contacts_insurer_id_idx on insurer_contacts (insurer_id);
create index insurer_contacts_verified_by_idx on insurer_contacts (verified_by);
comment on table insurer_contacts is 'An insurer''s verified email address, recorded by a person with its source (D-145). Insurer messages are sent to it only through a connected mailbox, after approval.';

alter table insurer_contacts enable row level security;
create policy tenant_select on insurer_contacts for select to authenticated, asap_worker using (app.can_access(organization_id));
grant select on insurer_contacts to authenticated, asap_worker;
revoke insert, update, delete on insurer_contacts from authenticated, asap_worker, anon;
create trigger "000_through_api" before insert or update or delete on insurer_contacts
  for each row execute function app.placement_writes_through_api();

create or replace function public.insurer_contact_record(p_insurer_id uuid, p_email text, p_label text, p_source text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := app.require_api_caller();
  i insurers;
  v_id uuid;
begin
  select * into i from insurers where id = p_insurer_id and deleted_at is null;
  if not found or app.current_membership(i.organization_id) is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not app.has_permission(i.organization_id, 'quote', 'edit') then raise exception 'permission_denied' using errcode = '42501'; end if;
  if p_source is null or length(btrim(p_source)) < 3 then raise exception 'source_required' using errcode = '23514'; end if;
  select id into v_id from insurer_contacts where organization_id = i.organization_id and insurer_id = i.id and email = lower(btrim(p_email)) and retired_at is null;
  if v_id is not null then return jsonb_build_object('id', v_id, 'created', false); end if;
  insert into insurer_contacts (organization_id, insurer_id, email, label, source, verified_by)
  values (i.organization_id, i.id, lower(btrim(p_email)), nullif(btrim(coalesce(p_label, '')), ''), btrim(p_source), v_user)
  returning id into v_id;
  perform app.engine_audit(i.organization_id, v_user, 'insurer.contact_verified', 'insurer', i.id, null,
                           jsonb_build_object('email', lower(btrim(p_email)), 'source', btrim(p_source)));
  return jsonb_build_object('id', v_id, 'created', true);
end $$;
revoke all on function public.insurer_contact_record(uuid, text, text, text) from public, anon;
grant execute on function public.insurer_contact_record(uuid, text, text, text) to authenticated;

alter table prepared_communications add column send_attempt_id uuid references email_send_attempts(id) on delete set null;
create index prepared_communications_send_attempt_id_idx on prepared_communications (send_attempt_id);
alter table prepared_communications add constraint prepared_communications_sent_has_attempt
  check (state <> 'sent' or provider_message_id is null or send_attempt_id is not null);

create or replace function public.prepared_communication_record_sent(p_id uuid, p_attempt_id uuid, p_to_address text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := app.require_api_caller();
  m prepared_communications;
  a email_send_attempts;
begin
  select * into m from prepared_communications where id = p_id for update;
  if not found or app.current_membership(m.organization_id) is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if m.state = 'sent' then return jsonb_build_object('id', m.id, 'changed', false); end if;
  if m.state <> 'approved' then raise exception 'not_approved' using errcode = '23514'; end if;
  select * into a from email_send_attempts where id = p_attempt_id and organization_id = m.organization_id;
  if not found or a.outcome <> 'sent' or a.provider_message_id is null then raise exception 'not_sent' using errcode = '23514'; end if;
  if a.approved_by <> v_user then raise exception 'not_the_approver' using errcode = '42501'; end if;
  if a.idempotency_key <> m.id::text || ':' || m.body_sha256 then raise exception 'not_this_message' using errcode = '23514'; end if;
  update prepared_communications set state = 'sent', send_attempt_id = a.id, provider_message_id = a.provider_message_id,
         to_address = coalesce(p_to_address, to_address), delivered_at = coalesce(a.provider_accepted_at, now()), updated_at = now()
   where id = m.id;
  update workflow_runs set next_run_at = now(), updated_at = now() where id = m.run_id;
  perform app.engine_audit(m.organization_id, v_user, 'workflow.communication_sent', 'workflow_run', m.run_id, null,
    jsonb_build_object('communication_id', m.id, 'audience', m.audience, 'attempt_id', a.id, 'provider_message_id', a.provider_message_id));
  insert into events (organization_id, event_type, entity_type, entity_id, actor, actor_user_id, payload)
  values (m.organization_id, 'workflow.communication_delivered', 'workflow_run', m.run_id, 'user', v_user,
          jsonb_build_object('communicationId', m.id, 'sent', true));
  return jsonb_build_object('id', m.id, 'changed', true);
end $$;
revoke all on function public.prepared_communication_record_sent(uuid, uuid, text) from public, anon;
grant execute on function public.prepared_communication_record_sent(uuid, uuid, text) to authenticated;
