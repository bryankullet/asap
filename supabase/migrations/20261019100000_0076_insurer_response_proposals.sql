-- 0076 — An insurer's quote by email is read into a proposed response (D-152).
--
-- When the inbound router files an insurer's quote or decline to the quotation waiting for it, ASAP
-- reads the premium, currency and validity — or the decline and its reason — from the email's own
-- words, by fixed patterns (never the model), and keeps them here as a proposal with the sentence it
-- read them from. Nothing reaches insurer_responses until a person accepts or corrects it through
-- the same "record response" path as always; the proposal then names the response it became.

create table insurer_response_proposals (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references organizations(id) on delete cascade,
  opportunity_id         uuid not null references opportunities(id) on delete cascade,
  opportunity_insurer_id uuid not null references opportunity_insurers(id) on delete cascade,
  email_message_id       uuid not null references email_messages(id) on delete cascade,
  outcome                text not null check (outcome in ('quoted', 'declined')),
  premium_amount         numeric(14,2) check (premium_amount is null or premium_amount >= 0),
  premium_currency       text check (premium_currency is null or premium_currency ~ '^[A-Z]{3}$'),
  valid_until            date,
  decline_reason         text,
  -- The words each value was read from, so a person sees the evidence beside the value.
  evidence               jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array'),
  method                 text not null check (length(btrim(method)) > 0),
  state                  text not null default 'proposed' check (state in ('proposed', 'accepted', 'corrected', 'rejected')),
  insurer_response_id    uuid references insurer_responses(id) on delete set null,
  decided_by             uuid references users(id),
  decided_at             timestamptz,
  created_at             timestamptz not null default now(),
  constraint insurer_response_proposals_one_per_email unique (opportunity_insurer_id, email_message_id),
  constraint insurer_response_proposals_amount_needs_currency check ((premium_amount is null) = (premium_currency is null)),
  constraint insurer_response_proposals_decided_whole check ((state = 'proposed') = (decided_by is null and decided_at is null)),
  constraint insurer_response_proposals_accepted_names_response check (state not in ('accepted', 'corrected') or insurer_response_id is not null)
);
create index insurer_response_proposals_organization_id_idx on insurer_response_proposals (organization_id);
create index insurer_response_proposals_opportunity_id_idx on insurer_response_proposals (opportunity_id);
create index insurer_response_proposals_email_message_id_idx on insurer_response_proposals (email_message_id);
create index insurer_response_proposals_insurer_response_id_idx on insurer_response_proposals (insurer_response_id);
create index insurer_response_proposals_decided_by_idx on insurer_response_proposals (decided_by);
comment on table insurer_response_proposals is 'An insurer''s reply as ASAP read it from the email (D-152): a proposal, until a person accepts or corrects it into an insurer response.';

alter table insurer_response_proposals enable row level security;
create policy tenant_select on insurer_response_proposals for select to authenticated, asap_worker using (app.can_access(organization_id));
grant select on insurer_response_proposals to authenticated, asap_worker;
revoke insert, update, delete on insurer_response_proposals from authenticated, asap_worker, anon;
create trigger "000_through_api" before insert or update or delete on insurer_response_proposals
  for each row execute function app.placement_writes_through_api();

-- A person's decision on a proposal: accepted or corrected into the response they recorded, or rejected.
create or replace function public.insurer_response_proposal_decide(p_id uuid, p_decision text, p_insurer_response_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid := app.require_api_caller(); p insurer_response_proposals;
begin
  select * into p from insurer_response_proposals where id = p_id for update;
  if not found or app.current_membership(p.organization_id) is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not app.has_permission(p.organization_id, 'quote', 'edit') then raise exception 'permission_denied' using errcode = '42501'; end if;
  if p.state <> 'proposed' then return jsonb_build_object('state', p.state, 'changed', false); end if;
  if p_decision not in ('accepted', 'corrected', 'rejected') then raise exception 'bad_decision' using errcode = '23514'; end if;
  if p_decision <> 'rejected' and not exists (select 1 from insurer_responses where id = p_insurer_response_id and opportunity_insurer_id = p.opportunity_insurer_id) then
    raise exception 'response_not_this_insurers' using errcode = '22023';
  end if;
  update insurer_response_proposals set state = p_decision, insurer_response_id = case when p_decision = 'rejected' then null else p_insurer_response_id end,
         decided_by = v_user, decided_at = now() where id = p.id;
  perform app.engine_audit(p.organization_id, v_user, 'quote.proposal_' || p_decision, 'opportunity', p.opportunity_id, jsonb_build_object('state', 'proposed'),
                           jsonb_build_object('proposalId', p.id, 'insurerResponseId', p_insurer_response_id));
  return jsonb_build_object('state', p_decision, 'changed', true);
end $$;
revoke all on function public.insurer_response_proposal_decide(uuid, text, uuid) from public, anon;
grant execute on function public.insurer_response_proposal_decide(uuid, text, uuid) to authenticated;
