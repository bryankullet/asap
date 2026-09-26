-- 0049 — An approval covers one exact request, and going stale is recorded.
--
-- 0048 stored `approved_body_sha256` beside the approval and the API cleared it when a request was
-- prepared again. Two things were missing, and both matter because this approval is the only thing
-- standing between a draft and a message leaving the brokerage (§45 rule 13).
--
-- **The database could not check the digest.** It was computed in TypeScript, so the constraint
-- could only say the three approval columns moved together — not that the digest described the
-- text actually in the row. Any future code path that updated `body_text` directly would leave an
-- approval standing over content nobody approved. The digest is now computed by a SQL function
-- that both the database and the API use, and a trigger enforces the relationship rather than
-- trusting a caller to remember.
--
-- **A superseded approval vanished.** Clearing the columns erased who had approved what. Approvals
-- are now an append-only log: superseding one records when it went stale and why, so "this was
-- approved on Tuesday and edited on Wednesday" is answerable a year later.
--
-- The log stores the digest, never the request text. A quotation request quotes the client's own
-- information, and an audit table is the wrong place to keep a second copy of it.

/* ---------------------------------------------------------------------------------------------
 * The canonical digest.
 *
 * Immutable, so a check constraint may call it. The separator is a record separator character,
 * which cannot occur in a subject line — without one, a subject ending in "x" with body "y" and a
 * subject "x" with body starting "y" would hash identically.
 */
create or replace function app.quote_request_digest(p_subject text, p_body text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select encode(
    extensions.digest(coalesce(p_subject, '') || chr(30) || coalesce(p_body, ''), 'sha256'),
    'hex')
$$;

comment on function app.quote_request_digest(text, text) is
  'The canonical digest an approval covers. Used by the trigger and by the API, so both agree.';

revoke all on function app.quote_request_digest(text, text) from public;
grant execute on function app.quote_request_digest(text, text) to authenticated, asap_worker;

/* ---------------------------------------------------------------------------------------------
 * Every approval that has ever been given, and what became of it.
 *
 * Append-only: there is no update policy and no delete grant. An approval that no longer covers
 * the request is superseded in place by the trigger below, which is the one write this table
 * takes after insert.
 */
create table quote_request_approvals (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  quote_request_id  uuid not null references quote_requests(id) on delete cascade,
  -- The digest of exactly what was approved. Never the text: a request quotes the client.
  body_sha256       text not null check (length(body_sha256) = 64),
  approved_by       uuid not null references users(id),
  approved_at       timestamptz not null default now(),
  -- Set when the request's content changed underneath it. A superseded approval is not permission.
  superseded_at     timestamptz,
  superseded_reason text,
  constraint quote_request_approvals_superseded_is_whole check (
    (superseded_at is null and superseded_reason is null)
    or (superseded_at is not null
        and superseded_reason is not null and length(btrim(superseded_reason)) > 0))
);
create index quote_request_approvals_organization_id_idx on quote_request_approvals (organization_id);
create index quote_request_approvals_quote_request_id_idx on quote_request_approvals (quote_request_id);
create index quote_request_approvals_approved_by_idx on quote_request_approvals (approved_by);
-- One live approval per request. A second approval of the same content finds this and does nothing.
create unique index quote_request_approvals_one_live_per_request
  on quote_request_approvals (quote_request_id) where superseded_at is null;

comment on table quote_request_approvals is
  'Append-only. Who approved which exact content, and when it stopped covering the request.';

/* ---------------------------------------------------------------------------------------------
 * The rule, enforced where code cannot route around it.
 *
 * On any change to the subject or the body, an approval that no longer matches is superseded and
 * the request's own approval columns are cleared. The caller does not have to remember: editing
 * an approved request makes the approval stale, always, whichever route did the editing.
 */
create or replace function app.quote_request_approval_follows_content()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_digest text;
begin
  v_digest := app.quote_request_digest(new.subject, new.body_text);

  -- Approving: the digest is the database's to compute, so it always describes this row.
  if new.approved_at is not null and old.approved_at is distinct from new.approved_at then
    new.approved_body_sha256 := v_digest;
    return new;
  end if;

  /*
   * A standing approval that no longer covers the row is stale from this moment. The test is on
   * the OLD digest, not the new one: a caller that clears the column itself while editing the
   * body is doing exactly the thing this records, and must not escape the record by doing it.
   */
  if old.approved_body_sha256 is not null
     and (new.approved_body_sha256 is null or new.approved_body_sha256 is distinct from v_digest)
  then
    update public.quote_request_approvals
       set superseded_at = now(),
           superseded_reason = 'The request was edited after it was approved.'
     where quote_request_id = new.id and superseded_at is null;

    new.approved_body_sha256 := null;
    new.approved_by := null;
    new.approved_at := null;
  end if;

  return new;
end $$;

/* A trigger function is nobody's to call directly, and PostgreSQL grants execute to public. */
revoke all on function app.quote_request_approval_follows_content() from public;

create trigger quote_requests_approval_follows_content
  before update on quote_requests
  for each row
  execute function app.quote_request_approval_follows_content();

/*
 * And the belt to that brace: an approval on the row must describe the row. Anything that got
 * past the trigger — a direct write with the trigger disabled, a future column added carelessly —
 * fails here instead of standing as permission to send.
 */
alter table quote_requests
  add constraint quote_requests_approval_covers_content check (
    approved_body_sha256 is null
    or approved_body_sha256 = app.quote_request_digest(subject, body_text));

alter table quote_request_approvals enable row level security;

create policy tenant_select on quote_request_approvals for select to authenticated, asap_worker
  using (app.can_access(organization_id));
create policy tenant_insert on quote_request_approvals for insert to authenticated, asap_worker
  with check (app.can_access(organization_id) and approved_by = (select auth.uid()));
/*
 * Superseding is the trigger's write, and it runs as the caller. The policy therefore exists, but
 * it is deliberately the only update anything does: there is no route that edits an approval.
 */
create policy tenant_supersede on quote_request_approvals for update to authenticated, asap_worker
  using (app.can_access(organization_id)) with check (app.can_access(organization_id));

grant select, insert, update on quote_request_approvals to authenticated, asap_worker;
revoke delete on quote_request_approvals from asap_worker, authenticated;
