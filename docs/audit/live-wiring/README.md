# The approved screens, on real records

Evidence that Discover, Work, Jobs and Automations render rows from a real, fully migrated,
seeded PostgreSQL — not fixtures — when demo mode is off (D-066).

The screenshots beside this file were taken from a **production-mode build** (`VITE_PUBLIC_DEMO_MODE=off`)
driven against the **real Hono API**, which read a real database. Every client name, count, badge,
reason and percentage in them came out of a row.

| Screen | What is real in it |
|---|---|
| `Discover.png` | The five ranked cards are `GET /attention`: the engine's signals decided the order, the engine's `reason` is the sentence, the client names come from `clients`, the elapsed times from `task_since` against the server's clock, and the date from `generatedAt`. "ASAP noticed" counts the answer — it does not generate an insight. |
| `Work-active.png`, `Work-waiting.png` | `GET /work?view=` — the tabs are the API's own views (`needs`/`with`/`review`/`done`/`recent`), the counts come back with the rows so a number cannot disagree with its list, and the badge reads the task's status, its exception, or a run that could not finish. |
| `Jobs.png` | `GET /runs` — grouped by what each run is waiting on, with progress derived from the steps of the work it is advancing, and "Open Work" leading to what a person owns. |
| `Automations.png` | `GET /automations` — the brokerage's standing instructions; the seed has none, so the screen says so rather than showing an example. |

## What this proves, and what it does not

- **It proves** the wiring: real HTTP, the real API, real SQL, the real bundle, and the approved
  design rendering what came back — including every designed state (loading, partial read, error,
  empty) rather than a blank.
- **It does not prove RLS.** The stand-in below connects as the database owner, so row-level
  security is not exercised. What proves isolation is `pnpm test:rls`: 395 pgTAP assertions
  against this same database, as `authenticated` and as `asap_worker`. Never read these
  screenshots as evidence of tenant isolation.
- **It does not prove Supabase Auth.** The bearer token is a seeded user's email, not a verified
  JWT. `scripts/verify-live.sh` is what exercises GoTrue, against a hosted project.

## Bringing it up

Four processes, none of which needs Docker:

```bash
# 1. a real database: every migration, then the seed
service postgresql start
PG_SUPER_URL=postgresql://postgres:postgres@127.0.0.1:5432/postgres scripts/db-verify-local.sh

# 2. the PostgREST/GoTrue stand-in over it (refuses to run outside APP_ENV=local)
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/asap_verify \
  pnpm --filter @asap/db dev:stub

# 3. the real API against the stand-in
pnpm --filter "@asap/api..." build
APP_ENV=local API_PORT=8788 SUPABASE_URL=http://127.0.0.1:54399 \
  WEB_BASE_URL=http://127.0.0.1:4179 … node apps/api/dist/server.js

# 4. a production-mode bundle, and the harness
VITE_PUBLIC_DEMO_MODE=off VITE_PUBLIC_API_BASE_URL=http://127.0.0.1:8788 … \
  pnpm --filter @asap/web exec vite build --outDir dist-live
node apps/web/parity/live-wiring.mjs
```

The harness fails — it does not merely report — if any screen shows one of the failure states
(`We cannot reach the ASAP service`, `Your session is no longer valid`, `This deployment is
part-upgraded`, different builds, or a startup failure), if the presenter bar appears in a live
build, or if a fictional fixture name reaches the screen.

## Two notes on running these together

- **The API mutates the database on boot.** It recovers runs whose boot token is not its own, which
  is correct behaviour and does change seeded run rows. Run `scripts/db-verify-local.sh` again
  before `pnpm test:rls` if the API has been pointed at the same database, or one recovery
  assertion will fail on state the API itself created.
- **`scripts/db-verify-local.sh` ends with a Drizzle drift check that currently fails**: the
  Drizzle schema in `packages/db` has not been extended for migrations 0032–0036 (conversations,
  pins, documents, mailboxes, automations). Drizzle is used only by the workers, so nothing in the
  shell or the API depends on it, but the gap is real and is not closed by this work.

## Two things it found

- **CORS, immediately.** The first run showed "We cannot reach the ASAP service … Reference:
  `api_unreachable`" on every screen, because the API's `WEB_BASE_URL` named a different port from
  the one the browser was on. That is exactly the failure class reported from Render, and the new
  error screen named it in one line instead of "We could not load your account".
- **A grant leak, through the database suite.** Running the pgTAP isolation suite against this
  database for the first time in this environment showed `anon` holding EXECUTE on
  `app.touch_conversation()` — a SECURITY DEFINER trigger function created without revoking the
  default PUBLIC grant. Migration 0037 revokes it. A second failure was the suite's own bug: two
  seed-wide assertions ran inside a signed-in RLS context and were counting rows RLS had already
  hidden.
