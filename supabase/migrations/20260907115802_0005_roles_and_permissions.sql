-- 0005 — roles and permissions
-- roles are tenant-scoped (a brokerage may rename or add one).
-- permissions are global reference data — the same verbs exist everywhere.
create table roles (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  key              text not null,                         -- stable identifier
  name             text not null,                         -- shown to users
  description      text,
  is_system        boolean not null default false,        -- seeded template, not user-created
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint roles_organization_id_key_key unique (organization_id, key)
);

create table permissions (
  id           uuid primary key default gen_random_uuid(),
  object_type  text not null,   -- 'client','policy','claim','document','email',
                                -- 'quote','placement','invoice','payment','commission',
                                -- 'space','job','automation','report','user','role',
                                -- 'organization','audit'
  verb         text not null
               constraint permissions_verb_check
               check (verb in ('view','create','edit','approve','export',
                               'delete','send_external','ai_execute')),
  description  text,
  constraint permissions_object_type_verb_key unique (object_type, verb)
);

create table role_permissions (
  role_id        uuid not null references roles(id) on delete cascade,
  permission_id  uuid not null references permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

-- The permission catalogue is reference data every environment needs, so it lives in the
-- migration rather than in seed.sql (which does not run in production). 18 object types × 8 verbs.
-- send_external is the boundary the approval engine defends; ai_execute controls whether the user
-- may ask ASAP to perform an action rather than only answer.
insert into permissions (object_type, verb)
select o.object_type, v.verb
from unnest(array[
  'client','policy','claim','document','email',
  'quote','placement','invoice','payment','commission',
  'space','job','automation','report','user','role',
  'organization','audit'
]) as o(object_type)
cross join unnest(array[
  'view','create','edit','approve','export','delete','send_external','ai_execute'
]) as v(verb)
on conflict (object_type, verb) do nothing;

comment on table permissions is 'Global reference data: verb × object type. Seeded by migration 0005.';
comment on table roles is 'Tenant-scoped. Nine system roles are created for every organization (see seed.sql and the create-brokerage flow).';
