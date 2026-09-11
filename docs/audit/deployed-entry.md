# The deployed entry path: what was wrong, and what to check next

Two separate failures were reported from `https://asap-web.onrender.com/discover`. The first is
fixed in the code. The second is a deployment fact that cannot be read from this repository, so what
follows is the diagnosis narrowed as far as it can be narrowed from here, plus the exact checks that
resolve it.

## 1. The demonstration asked strangers to sign in — fixed

`/discover` → `/sign-in?next=%2Fdiscover` was not a routing accident: `VITE_PUBLIC_DEMO_MODE`
changed what the screens showed and nothing about what stood in front of them, so `RequireSession`
and `RequireMembership` mounted above the shell in demo mode too. See **D-065** for the fix and the
tests that hold it shut.

What this also explains: after signing in, the visitor reached `RequireMembership`, which called
`/me` — a call the demonstration should never make — and showed its single error sentence when that
failed. With the boundary in place the public demo no longer touches any of this. The `/me` failure
below is now a production-only concern, which is the point: **the public demo does not depend on
fixing it.**

## 2. `/me` failed for a signed-in visitor — narrowed, not closed

I cannot reach Render from this environment (`api.render.com` and `dashboard.render.com` are both
refused at the CONNECT by the egress proxy), so I have verified nothing about the live services. The
error message itself was the obstacle to diagnosis: one sentence for five different causes. That is
fixed — the guard now names the failure class and the reference code appears on the screen — so the
next reproduction identifies its own cause.

Run through these in order. The first two are far and away the most likely.

| # | Check | How | What it would mean |
|---|---|---|---|
| 1 | **CORS** | In the browser console on `/discover`, look for `No 'Access-Control-Allow-Origin'`. The new screen says *"We cannot reach the ASAP service"* with reference `api_unreachable`. | `WEB_BASE_URL` on **asap-api** must equal the browser's origin exactly — scheme, host, no trailing slash. A mismatch makes every authenticated call fail in a way indistinguishable from the service being down. |
| 2 | **Same Supabase project on both services** | Compare `SUPABASE_URL` (asap-api) with `VITE_PUBLIC_SUPABASE_URL` (asap-web); and `SUPABASE_JWT_SECRET` with that project's JWT secret. | A token minted by one project and verified against another is rejected: reference `invalid_session`, *"Your session is no longer valid"*. |
| 3 | **API is up and on the expected build** | `GET https://asap-api.onrender.com/health` → `{"status":"ok","version":…,"commit":…}` | No response at all is `api_unreachable`. A `commit` older than `main` means the API was not redeployed with the web build; if the contracts moved, the new screen says *"different builds"* (`response_unrecognised`). |
| 4 | **`VITE_PUBLIC_API_BASE_URL`** | On **asap-web**, it must be the API's *public* `https://….onrender.com`, never a private-network host (see the comment in `render.yaml`). It is baked in at build time, so changing it requires a redeploy. | A wrong value is `api_unreachable`. |
| 5 | **Migrations applied** | Compare `supabase/migrations/` with the project's applied list. | A missing migration now answers 503 `schema_behind`: *"This deployment is part-upgraded"*. |
| 6 | **Profile and membership rows** | For the signed-in user: a row in `public.users`, and an `active` row in `organization_memberships`. | No profile is `profile_missing`. Zero memberships is not an error — it goes to `/onboarding` to create or join a brokerage. A suspended or removed membership is `permission_denied`. |

## 3. How the demonstration is verified

`node apps/web/parity/demo-entry.mjs` drives the **production build** in a fresh browser context with
no cookies and no storage — an incognito window — and fails if any destination redirects to sign-in,
renders no shell, shows no presenter bar, or calls out to any service (the webfont stylesheet
excepted). It can be pointed at the live site:

```bash
DEMO_BASE=https://asap-web.onrender.com node apps/web/parity/demo-entry.mjs
```

Locally, against a build made with `VITE_PUBLIC_DEMO_MODE=on` and **no Supabase or API variables at
all**:

```
  /                     → /discover                 ok
  /discover             → /discover                 ok
  /ask                  → /ask                      ok
  /work                 → /work                     ok
  /work?view=waiting    → /work                     ok
  /jobs                 → /jobs                     ok
  /automations          → /automations              ok
  /search               → /search                   ok
  /new                  → /new                      ok
  /email                → /email                    ok
  /documents            → /documents                ok
  /audit                → /audit                    ok
  /settings/connections → /settings/connections     ok
  /work/w-acme-kdn      → /work/w-acme-kdn          ok
  /jobs/j-meridian-confirm  → /jobs/j-meridian-confirm  ok
  /automations/a-servicing  → /automations/a-servicing  ok
  reload /work          → /work                     ok

Every demo destination opened with no session, no cookie and no API call.
```

## 4. What to do on Render

- **asap-web**: keep `VITE_PUBLIC_DEMO_MODE=on` and redeploy from the SHA reported with this change.
  The three production variables are no longer required while demo mode is on; leaving them set does
  no harm, since nothing in demo mode reads them.
- **asap-api**: no change is needed for the public demo. Work through the table in §2 for the
  authenticated deployment, and reproduce once afterwards — the screen now names its own cause.
