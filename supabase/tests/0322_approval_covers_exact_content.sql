-- pgTAP: an approval covers one exact request, and going stale is recorded (0049).
--
-- This is the last gate before a message leaves the brokerage, so the things it proves are all
-- ways that gate could be walked around:
--
--   * the digest is the database's, computed from the row, not a number a caller handed in;
--   * an approval that no longer matches the text cannot sit on the row at all;
--   * editing an approved request makes the approval stale, whichever write did the editing —
--     including one that clears the columns itself while editing;
--   * a stale approval is kept, dated and reasoned, not erased;
--   * approving the same text twice changes nothing;
--   * re-approval after an edit covers the new text and is a second, separate record;
--   * the log stores a digest and never the request text;
--   * nothing can be deleted, and one brokerage sees none of another's.
begin;
select plan(19);

create or replace function pg_temp.login(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Shape.

select has_table('public', 'quote_request_approvals', 'quote_request_approvals exists');
select has_function('app', 'quote_request_digest', array['text','text'],
  'the canonical digest is a database function, so the API and the constraint agree');
select is(
  (select relrowsecurity from pg_class where oid = 'public.quote_request_approvals'::regclass),
  true, 'row level security is enabled on it');

select is_empty($$
  select grantee from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'quote_request_approvals'
    and privilege_type = 'DELETE' and grantee in ('authenticated','asap_worker','anon')
$$, 'an approval, standing or stale, cannot be deleted by anybody');

-- The log is a record of consent, not a second copy of the client's information.
select hasnt_column('public', 'quote_request_approvals', 'subject',
  'the log keeps no subject line');
select hasnt_column('public', 'quote_request_approvals', 'body_text',
  'and no request body: a digest is the whole record');

/* Separated, so a subject ending "x" over body "y" is not the same as "x" over "y…". */
select isnt(
  app.quote_request_digest('ab', 'c'), app.quote_request_digest('a', 'bc'),
  'the digest separates the subject from the body');

-- ---------------------------------------------------------------------------------------------
-- A brokerage, a quotation, an insurer to approach.

insert into work_items (id, organization_id, kind, title, task_status)
values ('e1000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
        'new_business', 'Quotation work', 'needs_you');
insert into insurers (id, organization_id, name)
values ('e2000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a', 'Approval Insurer');

select pg_temp.login('a0000000-0000-4000-8000-000000000001');

insert into opportunities (id, organization_id, client_id, work_item_id, title, class_of_business, created_by)
values ('e3000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
        (select id from clients where organization_id = '10000000-0000-4000-8000-00000000000a' limit 1),
        'e1000000-0000-4000-8000-00000000000a', 'Fleet quotation — 2027', 'Commercial motor',
        'a0000000-0000-4000-8000-000000000001');
insert into opportunity_insurers (id, organization_id, opportunity_id, insurer_id, added_by)
values ('e5000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
        'e3000000-0000-4000-8000-00000000000a', 'e2000000-0000-4000-8000-00000000000a',
        'a0000000-0000-4000-8000-000000000001');
insert into quote_requests (id, organization_id, opportunity_id, opportunity_insurer_id,
                            subject, body_text, prepared_by)
values ('e6000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
        'e3000000-0000-4000-8000-00000000000a', 'e5000000-0000-4000-8000-00000000000a',
        'Quotation request', 'We invite terms for commercial motor cover.',
        'a0000000-0000-4000-8000-000000000001');

-- ---------------------------------------------------------------------------------------------
-- A digest a caller made up does not become permission.

/* A digest handed in with the approval is not trusted; the row's own replaces it. */
update quote_requests
   set approved_by = 'a0000000-0000-4000-8000-000000000001',
       approved_at = now(),
       approved_body_sha256 = repeat('0', 64)
 where id = 'e6000000-0000-4000-8000-00000000000a';
select is(
  (select approved_body_sha256 = app.quote_request_digest(subject, body_text)
     from quote_requests where id = 'e6000000-0000-4000-8000-00000000000a'),
  true, 'a digest a caller made up is discarded: the database computes it from the row');

/* And one written on its own, over an unapproved request, does not stand at all. */
update quote_requests set approved_at = null, approved_by = null, approved_body_sha256 = null
 where id = 'e6000000-0000-4000-8000-00000000000a';
select throws_ok(
  $$update quote_requests set approved_body_sha256 = repeat('0', 64)
     where id = 'e6000000-0000-4000-8000-00000000000a'$$,
  '23514', null, 'and a digest written on its own, approving nothing, is refused');

-- ---------------------------------------------------------------------------------------------
-- Approving, and what the log holds.

update quote_requests
   set approved_by = 'a0000000-0000-4000-8000-000000000001', approved_at = now()
 where id = 'e6000000-0000-4000-8000-00000000000a';
insert into quote_request_approvals (organization_id, quote_request_id, body_sha256, approved_by)
select organization_id, id, approved_body_sha256, approved_by
  from quote_requests where id = 'e6000000-0000-4000-8000-00000000000a';

select is(
  (select count(*)::int from quote_request_approvals
    where quote_request_id = 'e6000000-0000-4000-8000-00000000000a' and superseded_at is null),
  1, 'one standing approval is recorded');

-- Approving the same text again is nothing new, and the index says so rather than the caller.
select throws_ok(
  $$insert into quote_request_approvals (organization_id, quote_request_id, body_sha256, approved_by)
    select organization_id, id, approved_body_sha256, approved_by
      from quote_requests where id = 'e6000000-0000-4000-8000-00000000000a'$$,
  '23505', null, 'a second standing approval of the same request is refused, so double approval is idempotent');

-- ---------------------------------------------------------------------------------------------
-- Editing it. This is the rule the whole migration exists for.

update quote_requests set body_text = 'We invite terms for commercial motor cover, fleet of 14.'
 where id = 'e6000000-0000-4000-8000-00000000000a';

select is(
  (select approved_at is null and approved_by is null and approved_body_sha256 is null
     from quote_requests where id = 'e6000000-0000-4000-8000-00000000000a'),
  true, 'editing an approved request leaves it unapproved: a stale approval is not permission to send');

select isnt(
  (select superseded_at from quote_request_approvals
    where quote_request_id = 'e6000000-0000-4000-8000-00000000000a'),
  null, 'the approval that was given is kept, and dated as stale');

select isnt(
  (select superseded_reason from quote_request_approvals
    where quote_request_id = 'e6000000-0000-4000-8000-00000000000a'),
  null, 'and says why it went stale');

-- ---------------------------------------------------------------------------------------------
-- Re-approval covers the new text, and is its own record.

update quote_requests
   set approved_by = 'a0000000-0000-4000-8000-000000000001', approved_at = now()
 where id = 'e6000000-0000-4000-8000-00000000000a';
insert into quote_request_approvals (organization_id, quote_request_id, body_sha256, approved_by)
select organization_id, id, approved_body_sha256, approved_by
  from quote_requests where id = 'e6000000-0000-4000-8000-00000000000a';

select is(
  (select body_sha256 = app.quote_request_digest(q.subject, q.body_text)
     from quote_request_approvals a join quote_requests q on q.id = a.quote_request_id
    where a.quote_request_id = 'e6000000-0000-4000-8000-00000000000a' and a.superseded_at is null),
  true, 're-approval covers the new exact content');

select is(
  (select count(*)::int from quote_request_approvals
    where quote_request_id = 'e6000000-0000-4000-8000-00000000000a'),
  2, 'and both approvals are on the record, not one overwritten by the other');

/*
 * The write a careless route would make: clear the columns and change the body in one statement.
 * Testing the old digest rather than the new one is what catches it.
 */
update quote_requests
   set body_text = 'Rewritten without asking anyone.',
       approved_at = null, approved_by = null, approved_body_sha256 = null
 where id = 'e6000000-0000-4000-8000-00000000000a';
select is(
  (select count(*)::int from quote_request_approvals
    where quote_request_id = 'e6000000-0000-4000-8000-00000000000a' and superseded_at is null),
  0, 'clearing the approval yourself while editing still supersedes it, rather than erasing it');

-- ---------------------------------------------------------------------------------------------
-- Tenancy.

select pg_temp.login('b0000000-0000-4000-8000-000000000001');
select is(
  (select count(*)::int from quote_request_approvals
    where quote_request_id = 'e6000000-0000-4000-8000-00000000000a'),
  0, 'another brokerage sees none of these approvals');

select throws_ok(
  $$delete from quote_request_approvals$$,
  '42501', null, 'and no signed-in person may delete one');

select * from finish();
rollback;
