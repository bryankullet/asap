-- 0090 — Saved, versioned renewal proposals (D-167).
--
-- A proposal is a hypothetical a broker keeps: "if the client chose these insurers", saved from the
-- exploration (D-160) so it can be shown, discussed and compared with a later version. It is never the
-- client's instruction, never sent, and never a value store: it holds the insurers explored (their
-- quotation-insurer ids) and the revision of each answer when it was saved, so a later revision is said
-- as "revised since this proposal was saved". Figures are always read from the quotation itself.
--   * renewal_proposal_save numbers versions per Work item, needs job/edit and an open renewal, and
--     accepts only insurers on that renewal's own quotation. Audited.
--   * Every member who can see the work can read its proposals; writes only through the function.

create table renewal_proposals (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references organizations(id),
  work_item_id        uuid not null references work_items(id),
  opportunity_id      uuid not null references opportunities(id),
  version             integer not null check (version >= 1),
  opportunity_insurer_ids uuid[] not null check (cardinality(opportunity_insurer_ids) between 1 and 3),
  revisions           jsonb not null default '{}'::jsonb check (jsonb_typeof(revisions) = 'object'),
  note                text check (note is null or length(note) <= 1000),
  created_by          uuid not null references users(id),
  created_at          timestamptz not null default now(),
  unique (work_item_id, version)
);
create index renewal_proposals_organization_id_idx on renewal_proposals (organization_id);
create index renewal_proposals_opportunity_id_idx on renewal_proposals (opportunity_id);
create index renewal_proposals_created_by_idx on renewal_proposals (created_by);
comment on table renewal_proposals is 'A hypothetical a broker saved from the exploration: insurers and answer revisions, never values, never an instruction (D-167).';

alter table renewal_proposals enable row level security;
create policy tenant_select on renewal_proposals for select to authenticated
  using (app.can_access(organization_id));
grant select on renewal_proposals to authenticated;
revoke all on renewal_proposals from anon;

create or replace function public.renewal_proposal_save(p_work_item_id uuid, p_opportunity_insurer_ids uuid[], p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := app.require_api_caller();
  w work_items;
  v_opp uuid;
  v_version integer;
  v_revisions jsonb := '{}'::jsonb;
  v_id uuid;
  v_oi uuid;
begin
  select * into w from work_items where id = p_work_item_id and deleted_at is null for update;
  if not found or app.current_membership(w.organization_id) is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not app.has_permission(w.organization_id, 'job', 'edit') then raise exception 'permission_denied' using errcode = '42501'; end if;
  if w.kind <> 'renewal' or w.task_status = 'done' then raise exception 'not_an_open_renewal' using errcode = '23514'; end if;
  select id into v_opp from opportunities where work_item_id = w.id and organization_id = w.organization_id order by created_at desc limit 1;
  if v_opp is null then raise exception 'no_quotation' using errcode = '23514'; end if;
  if p_opportunity_insurer_ids is null or cardinality(p_opportunity_insurer_ids) not between 1 and 3 then
    raise exception 'proposal_size' using errcode = '23514';
  end if;
  foreach v_oi in array p_opportunity_insurer_ids loop
    if not exists (select 1 from opportunity_insurers oi where oi.id = v_oi and oi.opportunity_id = v_opp and oi.removed_at is null) then
      raise exception 'not_on_this_quotation' using errcode = '23514';
    end if;
    v_revisions := v_revisions || jsonb_build_object(v_oi::text, (
      select max(rv.revision) from insurer_response_revisions rv join insurer_responses r on r.id = rv.insurer_response_id where r.opportunity_insurer_id = v_oi));
  end loop;
  select coalesce(max(version), 0) + 1 into v_version from renewal_proposals where work_item_id = w.id;
  insert into renewal_proposals (organization_id, work_item_id, opportunity_id, version, opportunity_insurer_ids, revisions, note, created_by)
  values (w.organization_id, w.id, v_opp, v_version, p_opportunity_insurer_ids, v_revisions, nullif(btrim(coalesce(p_note, '')), ''), v_user)
  returning id into v_id;
  perform app.engine_audit(w.organization_id, v_user, 'renewal.proposal_saved', 'work_item', w.id, null,
    jsonb_build_object('proposal_id', v_id, 'version', v_version, 'opportunity_insurer_ids', to_jsonb(p_opportunity_insurer_ids)));
  return jsonb_build_object('id', v_id, 'version', v_version);
end $$;
revoke all on function public.renewal_proposal_save(uuid, uuid[], text) from public, anon;
grant execute on function public.renewal_proposal_save(uuid, uuid[], text) to authenticated;
-- ProposalVersions, registered for Living surfaces: the saved versions, beside the exploration.

insert into component_definitions
  (component_id, version, name, purpose, allowed_spaces, required_permissions,
   can_contain_action, requires_evidence, props_schema)
values
  ('ProposalVersions', 1, 'Saved proposals', 'Hypotheticals saved from the exploration, versioned, never an instruction, with what has been revised since.',
   array['living']::text[],
   array[]::text[],
   true, false,
   '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"items":{"maxItems":12,"type":"array","items":{"type":"object","properties":{"version":{"type":"integer","minimum":1,"maximum":9007199254740991},"savedAt":{"type":"string","maxLength":40},"by":{"anyOf":[{"type":"string","maxLength":200},{"type":"null"}]},"note":{"anyOf":[{"type":"string","maxLength":1000},{"type":"null"}]},"insurers":{"maxItems":3,"type":"array","items":{"type":"string","minLength":1,"maxLength":200}},"revisedSince":{"maxItems":3,"type":"array","items":{"type":"string","minLength":1,"maxLength":200}},"latest":{"type":"boolean"},"ref":{"type":"object","propertyNames":{"type":"string","maxLength":60},"additionalProperties":{"anyOf":[{"type":"string","maxLength":200},{"maxItems":10,"type":"array","items":{"type":"string","maxLength":200}}]}}},"required":["version","savedAt","by","note","insurers","revisedSince","latest","ref"],"additionalProperties":false}},"committed":{"anyOf":[{"type":"string","minLength":1,"maxLength":500},{"type":"null"}]},"note":{"type":"string","minLength":1,"maxLength":500}},"required":["items","committed","note"],"additionalProperties":false}'::jsonb);
