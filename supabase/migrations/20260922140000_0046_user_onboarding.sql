-- 0046 — What a person has already done when they first arrive.
--
-- First-use onboarding is four short steps, and the reason it is a table rather than component
-- state is the smallest one: a refresh must not undo a step somebody completed. Two more follow
-- from that:
--
--  - **Nobody is walked through it twice.** Completion is a row, so an existing person opening
--    `/onboarding` is shown what is already set up rather than being asked to set it up again.
--  - **A skip is a decision, not an absence.** "I do not want to connect a mailbox yet" and "I
--    have not got that far" are different facts, and a product that cannot tell them apart nags
--    people who already answered. Each choice is recorded with what they chose.
--
-- It is per person *per brokerage*, not per person: somebody who joins a second brokerage has a
-- first day there too, and the state of their first one says nothing about it.
--
-- There is no company-details column here. The company is `organizations`, it already exists by
-- the time this row does, and a second copy of a brokerage's own name is a second thing to get
-- wrong. Whoever joins an existing brokerage changes nothing about it from here.

create table user_onboarding (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  user_id          uuid not null references users(id) on delete cascade,
  -- Which step they are on, so a refresh returns them to it. Bounded so a typo cannot park
  -- somebody on step 9 with nothing to render.
  step             integer not null default 1 check (step between 1 and 4),
  -- What they chose to do about records, and about their mailbox. Null means not yet answered;
  -- 'skip' means answered, and answered "no".
  records_choice   text check (records_choice in ('upload','import','skip')),
  mailbox_choice   text check (mailbox_choice in ('connect','skip')),
  completed_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- One row per person per brokerage. This is what makes finishing twice finish once.
  constraint user_onboarding_organization_id_user_id_key unique (organization_id, user_id)
);
create index user_onboarding_organization_id_idx on user_onboarding (organization_id);
create index user_onboarding_user_id_idx on user_onboarding (user_id);

comment on table user_onboarding is
  'One row per person per brokerage. A skip is a recorded answer, not a missing one.';

alter table user_onboarding enable row level security;

/*
 * A person's own row, and only their own.
 *
 * Deliberately narrower than the usual tenant policy: whether a colleague has finished their first
 * day is not something their colleagues need to read, and `app.can_access` alone would have made
 * it readable across the brokerage for no purpose.
 */
create policy own_select on user_onboarding for select to authenticated, asap_worker
  using (app.can_access(organization_id) and user_id = (select auth.uid()));
create policy own_insert on user_onboarding for insert to authenticated, asap_worker
  with check (app.can_access(organization_id) and user_id = (select auth.uid()));
create policy own_update on user_onboarding for update to authenticated, asap_worker
  using (app.can_access(organization_id) and user_id = (select auth.uid()))
  with check (app.can_access(organization_id) and user_id = (select auth.uid()));

grant select, insert, update on user_onboarding to authenticated, asap_worker;
