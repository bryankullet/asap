-- pgTAP: documents, pages and extracted fields (0034).
--
-- The constraints here are the ones that keep a citation honest and an extracted value humble.
-- They are asserted at the database, not only in the route, because a worker or a later feature
-- writing these rows must meet the same bar.
begin;
select plan(12);

create or replace function pg_temp.login(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

select has_table('public', 'documents', 'documents exists');
select has_table('public', 'document_pages', 'document_pages exists');
select has_table('public', 'document_fields', 'document_fields exists');
select is(
  (select count(*)::int from pg_class
   where oid in ('public.documents'::regclass,'public.document_pages'::regclass,'public.document_fields'::regclass)
     and relrowsecurity),
  3,
  'row level security is enabled on all three');
select is(
  (select count(*)::int from pg_policies
   where schemaname='public' and tablename in ('documents','document_pages','document_fields')
     and roles::text[] @> array['anon']),
  0,
  'no policy applies to anon');
-- A document is brokerage work, so nothing here is personally scoped — unlike pins and
-- conversations. What every policy must carry is the brokerage.
select is(
  (select count(*)::int from pg_policies
   where schemaname='public' and tablename in ('documents','document_pages','document_fields')
     and (coalesce(qual,'')||coalesce(with_check,'')) not like '%can_access%'),
  0,
  'every policy carries the brokerage scope');

select pg_temp.login('a0000000-0000-4000-8000-000000000001');
insert into documents (id, organization_id, kind, filename, mime_type, byte_size, storage_path,
                       content_sha256, uploaded_by)
values ('d0000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-00000000000a',
        'policy_schedule', 'schedule.pdf', 'application/pdf', 1024,
        '10000000-0000-4000-8000-00000000000a/unfiled/d1/schedule.pdf', repeat('a',64),
        'a0000000-0000-4000-8000-000000000001');
select is((select extraction_state from documents where id='d0000000-0000-4000-8000-000000000001'),
  'not_started', 'a new document has not been read yet');

-- A region without a page could never be opened, so it cannot be stored.
select throws_ok(
  $$insert into document_fields (organization_id, document_id, field_key, region_x, region_y, region_width, region_height)
    values ('10000000-0000-4000-8000-00000000000a','d0000000-0000-4000-8000-000000000001','x',1,1,1,1)$$,
  '23514', null, 'a region without a page is refused');
-- Half a rectangle is not a rectangle.
select throws_ok(
  $$insert into document_fields (organization_id, document_id, field_key, page_number, region_x)
    values ('10000000-0000-4000-8000-00000000000a','d0000000-0000-4000-8000-000000000001','y',1,5)$$,
  '23514', null, 'a partial region is refused');
-- A decision has a decider. This is what "extraction proposes, a person decides" means in the row.
select throws_ok(
  $$insert into document_fields (organization_id, document_id, field_key, state)
    values ('10000000-0000-4000-8000-00000000000a','d0000000-0000-4000-8000-000000000001','z','accepted')$$,
  '23514', null, 'a field cannot be accepted with nobody having accepted it');
-- An error message only makes sense on a failure.
select throws_ok(
  $$update documents set extraction_error = 'boom' where id = 'd0000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'an extraction error without a failure is refused');
reset role;

-- Another brokerage sees none of it.
select pg_temp.login('b0000000-0000-4000-8000-000000000001');
select is((select count(*)::int from documents
           where organization_id='10000000-0000-4000-8000-00000000000a'), 0,
  'another brokerage reads no document of Acme''s');
reset role;

select * from finish();
rollback;
