-- 0012 — Storage
-- Private bucket. Path: organization_id/entity_type/entity_id/document_id/filename
-- Storage RLS is the second line; the API still checks permission before issuing a signed URL.
insert into storage.buckets (id, name, public)
values ('insurance-documents', 'insurance-documents', false)
on conflict (id) do nothing;

create policy doc_read on storage.objects
  for select using (
    bucket_id = 'insurance-documents'
    and app.can_access((storage.foldername(name))[1]::uuid)
  );

create policy doc_write on storage.objects
  for insert with check (
    bucket_id = 'insurance-documents'
    and app.can_access((storage.foldername(name))[1]::uuid)
  );

create policy doc_delete on storage.objects
  for delete using (
    bucket_id = 'insurance-documents'
    and app.can_access((storage.foldername(name))[1]::uuid)
  );
