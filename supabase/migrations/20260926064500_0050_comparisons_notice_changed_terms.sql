-- 0050 — A comparison records exactly what it compared, and notices when that changes.
--
-- A comparison is a photograph of the market at one moment. The danger is not that it is wrong
-- when taken; it is that it stays on the screen after an insurer corrects a premium, a person
-- fixes a misread excess, or a term is added. A broker then puts a page in front of a client that
-- no longer describes any quote in existence.
--
-- So a comparison stores a digest of each response and each term it included. Any change to those
-- rows supersedes it: the comparison is kept, marked stale, and named — which insurer, which term.
-- Nothing recomputes it silently, because a comparison a person has read is a thing that was said.
--
-- Digests, not values. What was compared can be read from the rows it points at; a second copy of
-- the client's terms in an audit table earns nothing and ages badly.

/* ---------------------------------------------------------------------------------------------
 * What "unchanged" means, in one place.
 *
 * The response digest covers only what a comparison puts on screen. `updated_at` is not in it:
 * re-saving a response without changing a figure must not stale a comparison, or the staleness
 * marker becomes noise and stops being read.
 */
create or replace function app.insurer_response_digest(
  p_outcome text, p_premium_amount numeric, p_premium_currency text, p_valid_until date)
returns text language sql immutable security invoker set search_path = '' as $$
  select encode(extensions.digest(
    concat_ws(chr(30), coalesce(p_outcome, ''), coalesce(p_premium_amount::text, ''),
              coalesce(p_premium_currency, ''), coalesce(p_valid_until::text, '')), 'sha256'), 'hex')
$$;

create or replace function app.quote_term_digest(
  p_term_type text, p_label text, p_extracted_value text, p_corrected_value text,
  p_amount numeric, p_currency text, p_unclear boolean)
returns text language sql immutable security invoker set search_path = '' as $$
  select encode(extensions.digest(
    concat_ws(chr(30), coalesce(p_term_type, ''), coalesce(p_label, ''),
              coalesce(p_extracted_value, ''), coalesce(p_corrected_value, ''),
              coalesce(p_amount::text, ''), coalesce(p_currency, ''),
              coalesce(p_unclear::text, '')), 'sha256'), 'hex')
$$;

revoke all on function app.insurer_response_digest(text, numeric, text, date) from public;
revoke all on function app.quote_term_digest(text, text, text, text, numeric, text, boolean) from public;
grant execute on function app.insurer_response_digest(text, numeric, text, date)
  to authenticated, asap_worker;
grant execute on function app.quote_term_digest(text, text, text, text, numeric, text, boolean)
  to authenticated, asap_worker;

/* ---------------------------------------------------------------------------------------------
 * The comparison itself.
 */
create table quote_comparisons (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  opportunity_id    uuid not null references opportunities(id) on delete cascade,
  generated_by      uuid not null references users(id),
  generated_at      timestamptz not null default now(),
  -- Set when this comparison was put in front of the client. Refused while it is stale.
  presented_at      timestamptz,
  presented_by      uuid references users(id),
  -- Set when a quote it included changed underneath it. Names the insurer and the term.
  superseded_at     timestamptz,
  superseded_reason text,
  constraint quote_comparisons_presented_is_whole check (
    (presented_at is null and presented_by is null)
    or (presented_at is not null and presented_by is not null)),
  constraint quote_comparisons_superseded_is_whole check (
    (superseded_at is null and superseded_reason is null)
    or (superseded_at is not null
        and superseded_reason is not null and length(btrim(superseded_reason)) > 0))
);
create index quote_comparisons_organization_id_idx on quote_comparisons (organization_id);
create index quote_comparisons_opportunity_id_idx on quote_comparisons (opportunity_id);
create index quote_comparisons_generated_by_idx on quote_comparisons (generated_by);
create index quote_comparisons_presented_by_idx on quote_comparisons (presented_by);
-- One live comparison per opportunity: generating a new one supersedes the old, never forks it.
create unique index quote_comparisons_one_live_per_opportunity
  on quote_comparisons (opportunity_id) where superseded_at is null;

comment on table quote_comparisons is
  'A comparison of the quotes received, and the digests of exactly what it compared.';

/* One row per insurer answer the comparison put in a column. */
create table quote_comparison_inputs (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  comparison_id     uuid not null references quote_comparisons(id) on delete cascade,
  insurer_response_id uuid not null references insurer_responses(id) on delete cascade,
  -- Named here as well as through the response, so a stale reason can say who without a join
  -- against rows that may themselves have moved on.
  insurer_id        uuid not null references insurers(id),
  response_sha256   text not null check (length(response_sha256) = 64),
  created_at        timestamptz not null default now(),
  constraint quote_comparison_inputs_one_per_response unique (comparison_id, insurer_response_id)
);
create index quote_comparison_inputs_organization_id_idx on quote_comparison_inputs (organization_id);
create index quote_comparison_inputs_comparison_id_idx on quote_comparison_inputs (comparison_id);
create index quote_comparison_inputs_insurer_response_id_idx
  on quote_comparison_inputs (insurer_response_id);
create index quote_comparison_inputs_insurer_id_idx on quote_comparison_inputs (insurer_id);

/* One row per term in that column. The label is kept so a removed term can still be named. */
create table quote_comparison_terms (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  comparison_input_id uuid not null references quote_comparison_inputs(id) on delete cascade,
  quote_term_id     uuid references quote_terms(id) on delete set null,
  term_type         text not null,
  label             text not null,
  term_sha256       text not null check (length(term_sha256) = 64),
  constraint quote_comparison_terms_one_per_term unique (comparison_input_id, term_type, label)
);
create index quote_comparison_terms_organization_id_idx on quote_comparison_terms (organization_id);
create index quote_comparison_terms_comparison_input_id_idx
  on quote_comparison_terms (comparison_input_id);
create index quote_comparison_terms_quote_term_id_idx on quote_comparison_terms (quote_term_id);

/* ---------------------------------------------------------------------------------------------
 * Noticing.
 *
 * Both triggers are AFTER, and both go through one procedure so the reason reads the same
 * wherever the change came from: an insurer's revised quote, a person's correction, an extractor
 * writing a term nobody had recorded.
 */
create or replace function app.supersede_comparisons_for_response(
  p_insurer_response_id uuid, p_reason text)
returns void language sql security invoker set search_path = '' as $$
  update public.quote_comparisons c
     set superseded_at = now(), superseded_reason = p_reason
   where c.superseded_at is null
     and exists (select 1 from public.quote_comparison_inputs i
                  where i.comparison_id = c.id
                    and i.insurer_response_id = p_insurer_response_id)
$$;
revoke all on function app.supersede_comparisons_for_response(uuid, text) from public;
/* The triggers below run as the caller, so the caller must be able to reach this. */
grant execute on function app.supersede_comparisons_for_response(uuid, text)
  to authenticated, asap_worker;

create or replace function app.quote_comparison_notices_response_change()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  v_insurer text;
begin
  if app.insurer_response_digest(old.outcome, old.premium_amount, old.premium_currency, old.valid_until)
     is not distinct from
     app.insurer_response_digest(new.outcome, new.premium_amount, new.premium_currency, new.valid_until)
  then
    return null;  -- Nothing a comparison shows has moved.
  end if;

  select i.name into v_insurer
    from public.opportunity_insurers oi join public.insurers i on i.id = oi.insurer_id
   where oi.id = new.opportunity_insurer_id;

  perform app.supersede_comparisons_for_response(
    new.id,
    coalesce(v_insurer, 'An insurer') || ' changed its quote after this comparison was made.');
  return null;
end $$;
revoke all on function app.quote_comparison_notices_response_change() from public;

create trigger insurer_responses_stale_comparisons
  after update on insurer_responses
  for each row
  execute function app.quote_comparison_notices_response_change();

create or replace function app.quote_comparison_notices_term_change()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  v_row     public.quote_terms;
  v_insurer text;
  v_what    text;
begin
  v_row := coalesce(new, old);

  if tg_op = 'UPDATE'
     and app.quote_term_digest(old.term_type, old.label, old.extracted_value, old.corrected_value,
                               old.amount, old.currency, old.unclear)
         is not distinct from
         app.quote_term_digest(new.term_type, new.label, new.extracted_value, new.corrected_value,
                               new.amount, new.currency, new.unclear)
  then
    return null;
  end if;

  /*
   * A term added to a response nobody has compared yet is not a change to anything — the
   * supersede below simply matches no comparison. Only a response already in a live comparison
   * is affected, which is what makes an insert worth watching at all.
   */
  select i.name into v_insurer
    from public.insurer_responses r
    join public.opportunity_insurers oi on oi.id = r.opportunity_insurer_id
    join public.insurers i on i.id = oi.insurer_id
   where r.id = v_row.insurer_response_id;

  v_what := case tg_op when 'INSERT' then 'added' when 'DELETE' then 'removed' else 'changed' end;

  perform app.supersede_comparisons_for_response(
    v_row.insurer_response_id,
    coalesce(v_insurer, 'An insurer') || ' ' || v_what || ' the term "' || v_row.label
      || '" after this comparison was made.');
  return null;
end $$;
revoke all on function app.quote_comparison_notices_term_change() from public;

create trigger quote_terms_stale_comparisons
  after insert or update or delete on quote_terms
  for each row
  execute function app.quote_comparison_notices_term_change();

/*
 * And the rule the noticing is for: a stale comparison is not shown to a client. Regenerating is
 * the only way past this, which is the point — the broker presents a page that describes quotes
 * that exist.
 */
create or replace function app.quote_comparison_presentation_is_current()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.presented_at is not null and old.presented_at is distinct from new.presented_at
     and new.superseded_at is not null then
    raise exception 'This comparison is out of date. Generate it again before presenting it.'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke all on function app.quote_comparison_presentation_is_current() from public;

create trigger quote_comparisons_presentation_is_current
  before update on quote_comparisons
  for each row
  execute function app.quote_comparison_presentation_is_current();

/* ---------------------------------------------------------------------------------------------
 * Which insurer, and which term. Computed live, so it stays right after several changes.
 */
create or replace function app.quote_comparison_changes(p_comparison_id uuid)
returns table (insurer_id uuid, insurer_name text, term_type text, label text, change text)
language sql stable security invoker set search_path = '' as $$
  -- A response-level figure that moved.
  select i.insurer_id, ins.name, null::text, null::text, 'The premium or validity changed.'
    from public.quote_comparison_inputs i
    join public.insurers ins on ins.id = i.insurer_id
    join public.insurer_responses r on r.id = i.insurer_response_id
   where i.comparison_id = p_comparison_id
     and i.response_sha256 is distinct from
         app.insurer_response_digest(r.outcome, r.premium_amount, r.premium_currency, r.valid_until)
  union all
  -- A term that changed or was removed.
  select i.insurer_id, ins.name, t.term_type, t.label,
         case when q.id is null then 'This term is no longer recorded.'
              else 'This term changed.' end
    from public.quote_comparison_terms t
    join public.quote_comparison_inputs i on i.id = t.comparison_input_id
    join public.insurers ins on ins.id = i.insurer_id
    left join public.quote_terms q
      on q.insurer_response_id = i.insurer_response_id
     and q.term_type = t.term_type and q.label = t.label
   where i.comparison_id = p_comparison_id
     and (q.id is null
          or t.term_sha256 is distinct from
             app.quote_term_digest(q.term_type, q.label, q.extracted_value, q.corrected_value,
                                   q.amount, q.currency, q.unclear))
  union all
  -- A term that was added after the comparison was made.
  select i.insurer_id, ins.name, q.term_type, q.label, 'This term was added afterwards.'
    from public.quote_comparison_inputs i
    join public.insurers ins on ins.id = i.insurer_id
    join public.quote_terms q on q.insurer_response_id = i.insurer_response_id
   where i.comparison_id = p_comparison_id
     and not exists (select 1 from public.quote_comparison_terms t
                      where t.comparison_input_id = i.id
                        and t.term_type = q.term_type and t.label = q.label)
$$;
revoke all on function app.quote_comparison_changes(uuid) from public;
grant execute on function app.quote_comparison_changes(uuid) to authenticated, asap_worker;

comment on function app.quote_comparison_changes(uuid) is
  'What has moved since a comparison was made: which insurer, which term, and how.';

/* ---------------------------------------------------------------------------------------------
 * Tenancy. A comparison is evidence of what was shown to a client; nothing deletes one.
 */
alter table quote_comparisons enable row level security;
alter table quote_comparison_inputs enable row level security;
alter table quote_comparison_terms enable row level security;

create policy tenant_select on quote_comparisons for select to authenticated, asap_worker
  using (app.can_access(organization_id));
create policy tenant_insert on quote_comparisons for insert to authenticated, asap_worker
  with check (app.can_access(organization_id));
create policy tenant_update on quote_comparisons for update to authenticated, asap_worker
  using (app.can_access(organization_id)) with check (app.can_access(organization_id));

create policy tenant_select on quote_comparison_inputs for select to authenticated, asap_worker
  using (app.can_access(organization_id));
create policy tenant_insert on quote_comparison_inputs for insert to authenticated, asap_worker
  with check (app.can_access(organization_id));

create policy tenant_select on quote_comparison_terms for select to authenticated, asap_worker
  using (app.can_access(organization_id));
create policy tenant_insert on quote_comparison_terms for insert to authenticated, asap_worker
  with check (app.can_access(organization_id));

grant select, insert, update on quote_comparisons to authenticated, asap_worker;
grant select, insert on quote_comparison_inputs to authenticated, asap_worker;
grant select, insert on quote_comparison_terms to authenticated, asap_worker;
revoke delete on quote_comparisons, quote_comparison_inputs, quote_comparison_terms
  from asap_worker, authenticated;
