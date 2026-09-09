-- 0030: the audit log survives organization deletion (D-054).
--
-- 0009 declared audit_log.organization_id ON DELETE CASCADE, so deleting a brokerage silently
-- erased its whole history. Screen Map v1 C05 (Audit log and event detail): "never rewrite
-- historical outcomes". Deleting audit rows by cascade is rewriting them to nothing. With
-- RESTRICT, a brokerage that has audit rows cannot be deleted at all, and every brokerage has
-- audit rows from the moment it is created (organization.created, membership.created), so this
-- makes deletion impossible without a deliberate, separately audited offboarding path.
-- pgTAP 0307 proves it.

alter table audit_log drop constraint audit_log_organization_id_fkey;
alter table audit_log
  add constraint audit_log_organization_id_fkey
  foreign key (organization_id) references organizations(id) on delete restrict;
