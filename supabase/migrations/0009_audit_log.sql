-- 0009 — audit_log
-- Insert-only. A denied action is still an audit row, with result = 'denied'.
create table audit_log (
  id                  bigint generated always as identity primary key,
  organization_id     uuid not null references organizations(id) on delete cascade,
  actor_type          text not null
                      constraint audit_log_actor_type_check
                      check (actor_type in ('user','ai','automation','system')),
  actor_user_id       uuid references users(id),
  action              text not null,          -- 'membership.created','role.updated', ...
  object_type         text not null,
  object_id           uuid,
  previous_state      jsonb,
  new_state           jsonb,
  evidence            jsonb,                  -- document/chunk refs, Phase 3 onward
  approval_id         uuid,                   -- Phase 6
  automation_run_id   uuid,                   -- Phase 12
  result              text not null default 'success'
                      constraint audit_log_result_check
                      check (result in ('success','failure','denied')),
  failure_reason      text,
  ip_address          inet,
  user_agent          text,
  occurred_at         timestamptz not null default now()
);

create index audit_log_organization_id_occurred_at_idx
  on audit_log (organization_id, occurred_at desc);
create index audit_log_organization_id_object_type_object_id_idx
  on audit_log (organization_id, object_type, object_id);
create index audit_log_organization_id_actor_user_id_occurred_at_idx
  on audit_log (organization_id, actor_user_id, occurred_at desc);

-- No application role gets update or delete. (asap_worker is revoked in 0013 once it exists.)
revoke update, delete, truncate on audit_log from authenticated, anon;
