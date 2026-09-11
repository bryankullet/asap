-- 0039 — the two things a brokerage's own book needs before it can be imported at all.
--
-- 1. `client_contacts` — the people at a client. A client has had a name and nothing else since
--    0006: no email, no phone, nobody to write to. That is why nothing in the product could say
--    "email this client", and why a book cannot be imported without losing most of what is in it.
--
--    A table rather than columns on `clients`, because a corporate client has several people —
--    a finance contact who receives invoices and an operations contact who reports claims are
--    routinely different, and flattening them into one email address loses the distinction the
--    brokerage actually works with.
--
-- 2. Premium and commission on a period — the smallest honest place for the money columns of a
--    brokerage's spreadsheet to land. This is **not** the money model (D-070 defers that):
--    no invoices, no receipts, no levies, no WHT, no reconciliation. It is what an import would
--    otherwise drop on the floor, recorded with its basis and its evidence state so that a later,
--    fuller model can trust or re-derive it.

create table client_contacts (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  client_id        uuid not null references clients(id) on delete cascade,
  full_name        text not null check (length(btrim(full_name)) > 0),
  -- What this person is to the client, in the brokerage's words. Not an enum: every brokerage
  -- names these differently and a migration is the wrong price for a job title.
  role_label       text,
  -- Deliberately permissive: a real book carries addresses this check would not have predicted,
  -- and refusing to import one is worse than storing it. It only insists on the shape of an
  -- address at all, so that "n/a" and a phone number do not end up in the email column.
  email            text check (email is null or position('@' in email) > 1),
  phone            text,
  -- Exactly one primary per client, enforced below: "who do we write to" must have one answer.
  is_primary       boolean not null default false,
  source           text not null default 'manual' check (source in ('manual','import','email','seed')),
  notes            text,
  created_by       uuid references users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);

create index client_contacts_organization_id_idx on client_contacts (organization_id);
create index client_contacts_client_id_idx on client_contacts (client_id) where deleted_at is null;
-- Matching an arriving email to the client it concerns is a lookup on this column, so it is
-- indexed on the lower-cased value the matcher will actually use.
create index client_contacts_email_idx on client_contacts (organization_id, lower(email))
  where email is not null and deleted_at is null;
-- The same person twice on one client is a duplicate, not a second contact.
create unique index client_contacts_client_id_email_key
  on client_contacts (client_id, lower(email)) where email is not null and deleted_at is null;
-- One primary contact per client. A partial unique index rather than a trigger: the database
-- refuses the second one rather than a code path remembering to clear the first.
-- Every foreign key carries a covering index (0203 hygiene): an unindexed key makes a delete on
-- the parent scan this table, and `users` is deleted from at offboarding.
create index client_contacts_created_by_idx on client_contacts (created_by);
create unique index client_contacts_one_primary
  on client_contacts (client_id) where is_primary and deleted_at is null;

alter table client_contacts enable row level security;

create policy tenant_select on client_contacts for select to authenticated, asap_worker
  using (app.can_access(organization_id));
create policy tenant_insert on client_contacts for insert to authenticated, asap_worker
  with check (app.can_access(organization_id));
create policy tenant_update on client_contacts for update to authenticated, asap_worker
  using (app.can_access(organization_id)) with check (app.can_access(organization_id));
create policy tenant_delete on client_contacts for delete to authenticated, asap_worker
  using (app.can_access(organization_id));

grant select, insert, update, delete on client_contacts to authenticated, asap_worker;

-- Premium as recorded, never as computed ------------------------------------------------------
--
-- `premium_basis` is the point of this block. A brokerage's "premium" column is either the gross
-- premium before statutory levies or the total the client actually pays, and the two differ by
-- the training levy and the policyholder compensation fund. Storing one as the other is silent
-- and only surfaces later as commission that does not reconcile — so the basis is recorded with
-- the number, and the importer must say which it has rather than defaulting to a guess.
--
-- Rate and amount are independent and both nullable. Given levies, commission cannot be safely
-- derived from the other one, so whichever the brokerage does not have stays **missing** rather
-- than being computed into a number nobody verified (§36: abstention is a state, not a blank).
alter table policy_periods
  add column premium_amount    numeric(14,2) check (premium_amount is null or premium_amount >= 0),
  add column premium_currency  text check (premium_currency is null or premium_currency ~ '^[A-Z]{3}$'),
  add column premium_basis     text check (premium_basis in ('gross','total_payable')),
  add column commission_rate   numeric(6,4) check (commission_rate is null or (commission_rate >= 0 and commission_rate <= 1)),
  add column commission_amount numeric(14,2) check (commission_amount is null or commission_amount >= 0),
  -- Where the figure came from and whether a document backs it. An imported figure is a claim by
  -- the brokerage's old system until a schedule or a debit note proves it.
  add column premium_source    text not null default 'manual'
                               check (premium_source in ('manual','import','document','seed')),
  add column premium_verified_at timestamptz,
  add column premium_evidence_document_id uuid references documents(id) on delete set null;

-- A figure cannot be verified by nothing: claiming verification requires naming the document.
alter table policy_periods
  add constraint policy_periods_verified_has_evidence
  check (premium_verified_at is null or premium_evidence_document_id is not null);

-- An amount without a currency is not an amount, and a basis without an amount describes nothing.
alter table policy_periods
  add constraint policy_periods_premium_is_complete
  check (
    (premium_amount is null and premium_currency is null and premium_basis is null)
    or (premium_amount is not null and premium_currency is not null and premium_basis is not null)
  );

create index policy_periods_premium_evidence_document_id_idx
  on policy_periods (premium_evidence_document_id);

comment on column policy_periods.premium_basis is
  'gross = before statutory levies; total_payable = what the client pays. Recorded, never inferred.';
comment on column policy_periods.commission_rate is
  'A fraction of premium (0.125 = 12.5%). Null when the brokerage recorded only an amount.';
