# Migration preflight — 0037 → 0043 against the hosted database

Read-only. **No hosted change was made.** Every hosted fact below came from read-only SQL through
the Supabase MCP connection; every test ran on disposable local databases.

Date: 16 September 2026 · Repository state: `claude/ui-integration` @ `a43e22f`

---

## 1. Environment

| | |
|---|---|
| Project | **Asap** · ref `abdkpcppmlqnwvxloqsb` · org `acbxswfndldzyweswcop` |
| Region / engine | ap-south-1 · PostgreSQL 17.6.1.166 · `ACTIVE_HEALTHY` · created 2026-09-04 |
| Migration version | **0036** (`20260911013301_0036_automations`), 36 applied |
| Labelled | staging (`APP_ENV=staging` on `asap-api`) |
| **Actually** | **The only database this project has.** `list_projects` returns exactly one. There is no separate production project, so it is simultaneously the staging *and* the live database. |

### Connected services

| Service | Connects how | Branch | Commit |
|---|---|---|---|
| `asap-api` | `DATABASE_URL`, `SUPABASE_URL`, service-role key | `main` | `586fa85` (live) |
| `asap-web` | `VITE_PUBLIC_SUPABASE_URL` + browser anon key only | `main` | `586fa85` |
| `asap-extractor` | **does not connect to the database at all** | `main` | `586fa85` |
| `asap-worker` | does not exist | — | — |

### Is there data worth protecting? Yes.

`APP_ENV=staging` does not mean the database is disposable, and it is not:

| Table | Rows | What it is |
|---|---|---|
| organizations | **5** | The seed supplies 2 (Acme Insurance Brokers, Beta Risk Partners). The other **3 were created through the application** — among them *Kezzy's Brokerage* and *Silent Spender*. |
| users | **10** | Seven seeded `.test` addresses plus a real `gmail.com` account |
| clients | 4 | one with `source='manual'` — created by a person, not seeded |
| work_items | 8 | |
| audit_log | **20** | the record of what was done, which cannot be regenerated |
| events | 7 | |
| policies / policy_periods | 2 / 2 | |
| claims / endorsements / automations | 1 / 1 / 1 | |
| documents / document_fields | 0 / 0 | nothing has ever been uploaded here |

Not third-party PII at scale — but three brokerages, a real account and twenty audit rows are not
re-creatable from the seed. **Treat it as production.**

### API compatibility: the deployed API is *ahead* of the database

`asap-api` runs `586fa85`, which is `main`'s head. Code on `main` references objects that migrations
0039–0042 create:

| Pending object | Files on `main` that use it |
|---|---|
| `client_contacts` | 2 |
| `import_batches` / `import_rows` | 2 / 2 |
| `policy_period_record_premium` | 2 |
| `app.claim_pending_events` | 1 |
| `app.mark_event_processed` | 1 |
| `policy_periods.premium_*` | 4 |

**So three shipped features are broken on the hosted database right now**: import, premium
recording, and worker event dispatch. Batch A does not introduce risk — it removes an existing
mismatch.

---

## 2 & 3. Migration history vs actual schema

### The schema at 0036 matches a clean 0036 build exactly

A disposable database was built from `0001…0036` + seed and compared with the hosted schema:

| Comparison | Result |
|---|---|
| Public tables | **identical** — 43 on both. The only local extras are `pg_all_foreign_keys` and `tap_funky`, which are pgTAP's own views. |
| RLS policies | **identical** — 140 on both, fingerprint `bc17362edc61cc97e5e1ec4d88e3a38d` on each side |
| Tenant tables without RLS | **none** |

### Nothing from 0037–0043 was applied outside history

Every object those migrations create is **absent** from the hosted database: `client_contacts`,
`import_batches`, `import_rows`, `document_applications`, all eight `policy_periods.premium_*` /
`commission_*` columns, `policy_period_record_premium`, `document_apply_to_record`,
`app.text_to_amount`, `app.claim_pending_events`, `app.mark_event_processed`,
`app.mark_event_attempted`.

**One apparent exception, explained:** `public.policy_create` **does** exist. It was created by
**0028**, which is applied. 0038 adds a *second overload* with different argument names
(`p_insurer_name, p_class_of_business` versus 0028's `p_insurer_id, p_class, p_items, p_source`).
0038 does not drop the old one, so after Batch A **two overloads coexist**. PostgREST resolves RPC
by argument names, which differ completely, so the call is unambiguous — but the 0028 overload
remains callable and is now dead code. Flagged, not blocking.

### File integrity

- **No migration ≤ 0036 has had its content edited after introduction.** Sixteen files show two
  commits each; in fifteen the second commit is a pure rename (`R100`) to ledger versions.
- **`0013` is the one real edit** (`R083` — content changed in the rename commit, "drop role-level
  GUC default"). The hosted database has **no role-level GUC default** on `asap_worker`, which is
  the *post-edit* state. History and schema agree.
- Versions: 43 files, 43 unique versions, ascending; sequence `0001…0043` complete, no gaps or
  duplicates.
- No pending migration contains a `drop table`, `drop column`, `alter column … type`, `rename`, or
  any `update`/`delete` outside a function body.

### Security of the new functions

| Function | Kind | search_path | anon | authenticated | asap_worker |
|---|---|---|---|---|---|
| `app.claim_pending_events` | DEFINER | fixed | no | **no** | yes |
| `app.mark_event_processed` | DEFINER | fixed | no | **no** | yes |
| `app.mark_event_attempted` | DEFINER | fixed | no | **no** | yes |
| `app.text_to_amount` | invoker | fixed | no | no | no |
| `public.policy_period_record_premium` | DEFINER | fixed | no | yes | no |
| `public.document_apply_to_record` | DEFINER | fixed | no | yes | no |

Every definer function has a pinned `search_path`; none is executable by `anon`; the worker's three
are executable by `asap_worker` **only**. New tenant tables (`client_contacts`, `import_batches`,
`import_rows`, `document_applications`) all enable RLS with brokerage-scoped policies, and the
foreign-key index rule is enforced by pgTAP `0203`, which caught a missing index on 0043 during
development.

### Drizzle

`db:verify`'s drift step reports **27 differences, every one of them "exists in database, missing
from Drizzle"** — Drizzle is behind, never ahead. **Sixteen predate 0037** (`component_definitions`
0031, `conversations`/`conversation_messages` 0032, `work_item_pins` 0033, documents 0034, mailboxes
and email 0035, automations 0036), so this backlog is already true of the hosted database. Batch A
adds 3 tables and 8 columns to it; 0043 adds one more table.

The worker is Drizzle's only consumer and touches exactly `events` and `event_deliveries` — **both
present in the Drizzle schema.** Drizzle being behind cannot produce a wrong query; it only means
those tables have no typed access.

---

## 4. Non-destructive migration commands

**`supabase migration list` and `supabase db push --dry-run` could not be run.** Three reasons,
all environmental:

1. The Supabase CLI is **not installed** in this session (`which supabase` → nothing).
2. The project is **not linked** here (no `supabase/.temp`).
3. Both commands need a direct database connection, and this session's egress policy answers
   **403 to `CONNECT`** for `db.abdkpcppmlqnwvxloqsb.supabase.co` — the same block that stops
   `*.onrender.com`. The MCP tools work because they travel a different path.

Substituted with the read-only equivalents reported in §2–3: history read from
`supabase_migrations.schema_migrations`, and the schema compared object-by-object against a clean
local 0036 build. `migration repair` was not used and is not proposed — history and schema agree.

---

## 5. Both migration paths, tested

### Clean build — every migration from nothing through 0043

| Check | Result |
|---|---|
| 43 migrations + `seed.sql` | applied clean |
| pgTAP (`test:rls`) | **485 assertions, 23 files, PASS** |
| API tests | **346 pass** |
| Web tests | **154 pass** |
| Schema tests | **102 pass** |
| db package | 2 pass |
| Extractor (Python) | 15 pass |
| Worker integration (real Postgres) | 10 pass |
| typecheck / lint / secret-scan | 9/9 · 9/9 · clean over 432 files |
| Drizzle drift | **FAILS — 27 items, all Drizzle-behind (see §3)** |

### Upgrade path — a disposable copy of the hosted database at 0036

Built at 0036 with the seed plus representative synthetic rows mirroring the hosted shape: 5
organizations (3 created "through the app"), a real-looking owner user and membership, a manually
created client, a document with a page and an accepted extracted field, and extra events. **No
hosted data was copied.**

Baseline: 51 business rows, fingerprint `475412434cddeb02ea3ce253bcae37bb` across organizations,
users, clients, policies, periods, work items, documents, pages, fields, events, claims,
endorsements, audit rows, memberships and insurers.

| Migration | Time | Result |
|---|---|---|
| 0037 revoke_touch_conversation | 51 ms | ok |
| 0038 policy_create | 54 ms | ok |
| 0039 client_contacts_and_premium | 80 ms | ok |
| 0040 imports | 76 ms | ok |
| 0041 record_premium | 53 ms | ok |
| 0042 claim_events | 57 ms | ok |
| 0043 document_applications | 67 ms | ok |
| **total** | **438 ms** | |

**After: fingerprint `475412434cddeb02ea3ce253bcae37bb`, 51 rows — identical. No existing business
row was altered and every id is stable.**

Functional probes on the upgraded copy:

| Check | Result |
|---|---|
| pgTAP, including cross-organisation isolation | **485 assertions PASS** |
| 0039 — contact on an existing client | inserted |
| 0040 — import batch and rows | accepted |
| 0041 — `policy_period_record_premium` on an existing period | wrote `250000.00 KES gross` |
| 0042 — `app.claim_pending_events` as `asap_worker` | claimed **5 events across 2 brokerages**; payload column not returned |
| 0042 — grants | `authenticated` **false**, `anon` **false**, `asap_worker` true |
| 0043 — apply a reviewed field to a real record | wrote `100000.00`, `source=document`, evidence document linked |
| 0043 — apply twice with one key | `repeat=true`, **1 receipt**, no duplicate |
| Re-running 0037–0043 a second time | 4 re-ran clean (function replacements), 3 refused `already exists` — **business fingerprint unchanged**, nothing duplicated |

### Locks and rewrites

0039 adds a `NOT NULL` column with a constant default (`premium_source default 'manual'`). Measured
`policy_periods.relfilenode` before and after: **unchanged (205410 → 205410) — no table rewrite.**
PostgreSQL 11+ stores a constant default in the catalogue, so the `ACCESS EXCLUSIVE` lock is
catalogue-only and momentary. Every other pending migration is `create table`, `create index`,
`create or replace function`, `grant` or `revoke` — none rewrites an existing table.

**The one place existing rows gain a value:** every existing `policy_period` will read
`premium_source = 'manual'` after 0039. That is the column's intended meaning — a figure the
brokerage's old system claimed, unverified — and `premium_amount` stays null.

---

## 6. Backups

**I could not create backup files, and I will not pretend otherwise.** `pg_dump` needs a direct
connection to `db.abdkpcppmlqnwvxloqsb.supabase.co:5432`, which this session's egress policy
refuses (403 on `CONNECT`), and I do not hold the database password.

**Nor could I confirm Supabase's managed backups or PITR.** No MCP tool exposes backup state, and
retention depends on the project's plan. Check it yourself at
**Dashboard → Database → Backups** — note the timestamp of the latest daily backup, and whether
Point-in-Time Recovery is enabled. If PITR is off and the latest daily backup is older than the
data you care about, that is a stop condition on its own.

Run these from your own machine, with the connection string from
**Project Settings → Database → Connection string** in the environment as `PGURL`:

```bash
mkdir -p ~/asap-backups && cd ~/asap-backups
STAMP=$(date -u +%Y%m%dT%H%M%SZ)

# 1. Roles (cluster-level; Supabase may restrict this — if it fails, note it and move on)
pg_dumpall --roles-only -d "$PGURL" > roles-$STAMP.sql

# 2. Schema only, every schema that matters
pg_dump -d "$PGURL" --schema-only \
  --schema=public --schema=app --schema=storage --schema=supabase_migrations \
  > schema-$STAMP.sql

# 3. Data only, excluding Supabase-managed internals
pg_dump -d "$PGURL" --data-only --schema=public --schema=app \
  > data-$STAMP.sql

# 4. Migration history on its own, so it can be restored independently
pg_dump -d "$PGURL" --schema=supabase_migrations --data-only \
  > history-$STAMP.sql

# 5. And a single restorable custom-format dump
pg_dump -d "$PGURL" -Fc -f full-$STAMP.dump

sha256sum *-$STAMP.* > checksums-$STAMP.txt
ls -lh
```

**Do not commit any of these.** `.gitignore` does not cover `*.sql` dumps, and a data dump contains
every brokerage's records. Keep them outside the repository.

---

## 7. The release, in two batches

### Batch A — 0037 … 0042

Everything `main`'s deployed API already expects. Additive throughout: 3 new tables, 8 new columns
on `policy_periods`, 6 new or replaced functions, no data touched.

Verify after applying:

1. `asap-api` still boots — its `/health` responds and the boot log shows the API key registered
2. Sign in works, and existing records are readable
3. Import accepts a file and previews rows *(broken before Batch A — this is the fix)*
4. A premium can be recorded on a policy period *(also broken before)*
5. `app.claim_pending_events` exists, and `authenticated` still cannot execute it
6. pgTAP passes against the hosted database, or at minimum the isolation files
7. **No worker is running** — `asap-worker` still does not exist

### Batch B — 0043

**0043 is backward-compatible with the API on `main`:** nothing on `main` references
`document_applications`, `document_apply_to_record` or `app.text_to_amount` — verified by
`git grep` against `origin/main`. It is invisible to the deployed code and could go in Batch A
safely.

Keeping it separate is still the better choice, for one reason: it is the only batch whose *purpose*
is unreachable without the `claude/ui-integration` API and web code. Applying it with its code keeps
one question — "did this release work?" — instead of two.

---

## 8. The worker — prepared, not executed

**SQL to give the existing role a login, preserving everything else:**

```sql
alter role asap_worker with login password '<a long random password>'
  nobypassrls noinherit;
```

`nobypassrls noinherit` is restated deliberately: it is what keeps RLS applying to the worker. The
repository has this as `pnpm db:worker-password` (`scripts/set-worker-password.sh`), which passes the
password as a psql variable so it never enters shell history or a SQL string.

**Its grants are already sufficient and need no addition.** As applied, `asap_worker` holds
`SELECT/INSERT/UPDATE/DELETE` on the tenant tables (RLS decides what it sees), `SELECT, INSERT` on
`audit_log`, and execute on six `app.*` helpers. After 0042 it gains execute on exactly
`claim_pending_events`, `mark_event_processed`, `mark_event_attempted`. **No broad grant is added,
and `asap_worker` never receives execute on `document_apply_to_record` or
`policy_period_record_premium`** — those are the API's, gated on a person's session.

**Render configuration, ready to create when you approve:**

| Field | Value |
|---|---|
| Type | Background Worker |
| Name | `asap-worker` |
| Language / Branch / Region | Node · `main` · Oregon |
| Root directory | *(empty)* |
| Build | `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @asap/workers... build` |
| Start | `node apps/workers/dist/index.js` |
| Instance | Starter |

| Environment variable | Value |
|---|---|
| `NODE_VERSION` | `22.22.2` |
| `APP_ENV` | `staging` |
| `WORKER_DATABASE_URL` | the Supabase connection string with user `asap_worker` and that password. The env schema **rejects** the `postgres` role by design. |
| `API_BASE_URL` | `https://asap-api-wx0m.onrender.com` |
| `API_INTERNAL_KEY` | copied from `asap-api` — they must match or every call is refused |
| `ENCRYPTION_KEY` | copied from `asap-api` — unused by the worker today, but a different value becomes a bug the moment mailbox tokens arrive |
| `SENTRY_DSN` | required: the env schema refuses to start when `APP_ENV` is not `local` |
| `EVENT_POLL_MS` | `2000` |

The worker stays absent until Batch A succeeds, 0042 is verified, the API is healthy, the restricted
connection is proven, and you say so.

---

## 9. Stop conditions

Stop the release if any of these is true:

1. A supposedly pending object already exists with a different definition — **checked: none does**
2. History and real schema disagree — **checked: they agree, fingerprint-identical**
3. A migration would delete or overwrite data — **checked: none does**
4. RLS or grants become broader — **checked: they do not**
5. `db:verify` fails — **CURRENTLY TRUE at the Drizzle drift step (see §3 and the recommendation)**
6. Clean-build or upgrade-path tests fail — **checked: both pass**
7. The backup cannot be completed — **OPEN: I cannot create it; you must**
8. The current API is incompatible with Batch A — **checked: the API needs Batch A**
9. Any migration requires guessing how to repair existing data — **checked: none does**

---

## 10. Recommendation

**Batch A is safe to apply, subject to two things that are yours and not mine:**

1. **Take the backup** (§6), and confirm PITR or the latest daily backup timestamp.
2. **Decide the `db:verify` drift.** It fails today, before any change. All 27 items are
   Drizzle-behind-database and 16 already describe the hosted database. It cannot cause a wrong
   query, and the worker's two tables are both present. Either accept it as known debt for this
   release, or let me regenerate the Drizzle schema first — an hour of work, no hosted change.

Everything else that could have stopped this came back clean: history matches schema exactly, no
object pre-exists, no data is touched, existing rows come through byte-identical, both paths test
green, the locks are catalogue-only, and the deployed API is *waiting* for these migrations rather
than threatened by them.

**No hosted change has been made. Awaiting explicit approval.**
