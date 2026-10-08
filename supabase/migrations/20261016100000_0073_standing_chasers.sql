-- 0073 — Autonomy build, phase 9 (D-147): standing approvals for routine insurer chasers.
--
-- A person approves a chaser template once — wording, audience insurer only, and a minimum gap
-- between chasers. ASAP may send follow-ups rendered exactly from it, only when the brokerage has
-- turned insurer_chasers on, a mailbox is connected and the insurer's address is verified. Every
-- send is recorded against the version that approved it. Off by default.

create table chaser_templates (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  purpose         text not null check (purpose in ('quote_chase', 'placement_chase', 'issuance_chase')),
  version         integer not null check (version >= 1),
  audience        text not null default 'insurer' check (audience = 'insurer'),
  subject_template text not null check (length(btrim(subject_template)) between 5 and 300),
  body_template   text not null check (length(btrim(body_template)) between 20 and 4000),
  min_days_between integer not null check (min_days_between between 1 and 30),
  sha256          text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  approved_by     uuid not null references users(id),
  approved_at     timestamptz not null default now(),
  retired_at      timestamptz,
  unique (organization_id, purpose, version)
);
create unique index chaser_templates_one_live on chaser_templates (organization_id, purpose) where retired_at is null;
create index chaser_templates_approved_by_idx on chaser_templates (approved_by);
comment on table chaser_templates is 'A person''s standing approval of the exact wording of a routine insurer chaser (D-147). Versions are retired, never edited.';

create table chaser_sends (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  template_id     uuid not null references chaser_templates(id),
  run_id          uuid not null references workflow_runs(id) on delete cascade,
  party           text not null,
  follow_up       integer not null check (follow_up >= 1),
  to_address      text not null,
  body_sha256     text not null check (body_sha256 ~ '^[0-9a-f]{64}$'),
  send_attempt_id uuid not null references email_send_attempts(id),
  sent_at         timestamptz not null default now(),
  unique (run_id, party, follow_up)
);
create index chaser_sends_organization_id_idx on chaser_sends (organization_id);
create index chaser_sends_template_id_idx on chaser_sends (template_id);
create index chaser_sends_send_attempt_id_idx on chaser_sends (send_attempt_id);
comment on table chaser_sends is 'Every chaser sent under a standing approval, with the template version, address and digest (D-147).';

alter table chaser_templates enable row level security;
alter table chaser_sends enable row level security;
create policy tenant_select on chaser_templates for select to authenticated, asap_worker using (app.can_access(organization_id));
create policy tenant_select on chaser_sends for select to authenticated, asap_worker using (app.can_access(organization_id));
grant select on chaser_templates, chaser_sends to authenticated, asap_worker;
revoke insert, update, delete on chaser_templates, chaser_sends from authenticated, asap_worker, anon;
create trigger "000_through_api" before insert or update or delete on chaser_templates for each row execute function app.placement_writes_through_api();
create trigger "000_through_api" before insert or update or delete on chaser_sends for each row execute function app.placement_writes_through_api();

-- A person approves a template: a new version, the previous retired. Needs the approving permission.
create or replace function public.chaser_template_approve(p_organization_id uuid, p_purpose text, p_subject text, p_body text, p_min_days integer)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := app.require_api_caller();
  v_version integer;
  v_id uuid;
  v_sha text := encode(extensions.digest(convert_to(p_purpose || E'\n' || p_subject || E'\n\n' || p_body || E'\n' || p_min_days::text, 'UTF8'), 'sha256'), 'hex');
begin
  if app.current_membership(p_organization_id) is null then raise exception 'not_a_member' using errcode = '42501'; end if;
  if not app.has_permission(p_organization_id, 'email', 'approve') then raise exception 'permission_denied' using errcode = '42501'; end if;
  select id into v_id from chaser_templates where organization_id = p_organization_id and purpose = p_purpose and retired_at is null and sha256 = v_sha;
  if v_id is not null then return jsonb_build_object('id', v_id, 'created', false); end if;
  update chaser_templates set retired_at = now() where organization_id = p_organization_id and purpose = p_purpose and retired_at is null;
  select coalesce(max(version), 0) + 1 into v_version from chaser_templates where organization_id = p_organization_id and purpose = p_purpose;
  insert into chaser_templates (organization_id, purpose, version, subject_template, body_template, min_days_between, sha256, approved_by)
  values (p_organization_id, p_purpose, v_version, p_subject, p_body, p_min_days, v_sha, v_user) returning id into v_id;
  perform app.engine_audit(p_organization_id, v_user, 'chaser_template.approved', 'chaser_template', v_id, null,
                           jsonb_build_object('purpose', p_purpose, 'version', v_version, 'sha256', v_sha, 'min_days_between', p_min_days));
  return jsonb_build_object('id', v_id, 'created', true, 'version', v_version);
end $$;
revoke all on function public.chaser_template_approve(uuid, text, text, text, integer) from public, anon;
grant execute on function public.chaser_template_approve(uuid, text, text, text, integer) to authenticated;

-- Withdrawing a standing approval stops every send under it at once.
create or replace function public.chaser_template_withdraw(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid := app.require_api_caller(); t chaser_templates;
begin
  select * into t from chaser_templates where id = p_id for update;
  if not found or app.current_membership(t.organization_id) is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not app.has_permission(t.organization_id, 'email', 'approve') then raise exception 'permission_denied' using errcode = '42501'; end if;
  if t.retired_at is not null then return jsonb_build_object('changed', false); end if;
  update chaser_templates set retired_at = now() where id = t.id;
  perform app.engine_audit(t.organization_id, v_user, 'chaser_template.withdrawn', 'chaser_template', t.id, null, jsonb_build_object('version', t.version));
  return jsonb_build_object('changed', true);
end $$;
revoke all on function public.chaser_template_withdraw(uuid) from public, anon;
grant execute on function public.chaser_template_withdraw(uuid) to authenticated;
