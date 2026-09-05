# Secrets

Where every ASAP secret comes from, who holds it, where it is allowed to appear, and how to rotate it.

Pairs with the account checklist (which accounts to register) and `.env.example` at the repository root (what the variables are called).

---

## The three rules

1. **No secret in git.** Not in a commit, not in a comment, not in a test fixture, not in a `.md` file. CI runs a secret scan and fails the build.
2. **No server secret in the browser.** Only `VITE_PUBLIC_*` variables reach the web bundle. Anything else appearing there is a shipped credential.
3. **Every secret has a named owner and a rotation procedure.** A secret nobody knows how to rotate never gets rotated.

---

## Where secrets live

| Environment | Storage | Who can read |
|---|---|---|
| Local | `.env.local`, git-ignored | The developer |
| Staging | Hosting provider environment variables | Developer |
| Production | Hosting provider environment variables | Named owner only |
| Recovery | Password manager vault | Named owner |

There is no shared `.env` file passed between people. A new machine gets values from the vault, not from a colleague's chat message.

---

## Inventory

### Supabase

| Secret | Sensitivity | Allowed in | Notes |
|---|---|---|---|
| `SUPABASE_ANON_KEY` | Low | Browser, API | Public by design. Safe **only** because RLS is correct — treat every RLS gap as an exposure of all tenant data. |
| `SUPABASE_SERVICE_ROLE_KEY` | Critical | `apps/api` server-side only | Bypasses RLS entirely. Never in `apps/web`. Never used in workers for tenant data. |
| `SUPABASE_JWT_SECRET` | Critical | `apps/api` | Signs and verifies sessions. Rotating invalidates every session. |
| `DATABASE_URL` | Critical | Migrations and pgTAP only | Postgres superuser-equivalent. |
| `WORKER_DATABASE_URL` / `WORKER_DB_PASSWORD` | High | `apps/workers` | The `asap_worker` role. Does not bypass RLS, which is the point. |

**Rotate:** Supabase dashboard → Settings → API → roll key. Update staging first, verify, then production. Rolling the service role key breaks the API until redeployed — do it in a maintenance window.

**Worker password rotation:** set `WORKER_DB_PASSWORD` to the new value and run `pnpm db:worker-password` against that environment (never in a migration — see `docs/DECISIONS.md` D-006), then update `WORKER_DATABASE_URL` in the same deploy. Old connections stay alive until they cycle, so drain workers first.

---

### AI providers

| Secret | Sensitivity | Allowed in | Notes |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | High | `apps/api` gateway only | Never in workers directly — workers call the gateway. |
| `OPENAI_API_KEY` | High | `apps/api` gateway only | Same. |

Both are billing-attached. A leaked key is a bill, not just a breach.

Keep separate keys per environment so a staging leak does not touch production spend, and set a spend cap on the staging key.

**Rotate:** provider console → create new key → deploy → delete old key. Do not delete first; the gateway will start failing before the new key is live.

**Never** send brokerage documents to a hosted extraction API (§45). Model calls carry text as part of a reasoning request; that is different from handing a document to a third party to index and store. If a proposed integration blurs that line, stop and ask.

---

### Email

| Secret | Sensitivity | Allowed in | Notes |
|---|---|---|---|
| `GOOGLE_OAUTH_CLIENT_SECRET` | High | `apps/api` | App-level, not per-brokerage. |
| `MICROSOFT_OAUTH_CLIENT_SECRET` | High | `apps/api` | Microsoft expires these — calendar the expiry. |
| `POSTMARK_SERVER_TOKEN` | Medium | `apps/api` | Platform mail only: invitations, resets, system notices. |

**Per-brokerage OAuth refresh tokens are the sharpest edge in the system.** Each one is standing access to a brokerage's entire mailbox. They live in the database, encrypted with `ENCRYPTION_KEY`, never in environment variables, never in logs, never in an audit payload, never in an error message. A crash trace containing a refresh token is a reportable incident.

---

### Application

| Secret | Sensitivity | Allowed in | Notes |
|---|---|---|---|
| `ENCRYPTION_KEY` | Critical | `apps/api`, `apps/workers` | 32 bytes base64. Encrypts stored OAuth refresh tokens. |
| `EXTRACTOR_SHARED_SECRET` | Medium | `apps/api`, `apps/extractor` | Service-to-service auth. |

**`ENCRYPTION_KEY` cannot be casually rotated.** Everything encrypted with the old key becomes unreadable. Rotation requires a re-encryption migration that reads with the old key and writes with the new one, with both keys present during the window. Generate it once, correctly, and back it up:

```bash
openssl rand -base64 32
```

Losing this key means every brokerage has to reconnect their mailbox. Back it up in the vault the day it is created, not later.

---

### Monitoring

| Secret | Sensitivity | Allowed in | Notes |
|---|---|---|---|
| `SENTRY_DSN` | Low | Browser and server | Public by design. |
| `POSTHOG_API_KEY` | Low | Browser and server | Public by design. |

Low sensitivity as credentials, high risk as pipes. Both send data outward. Scrub payloads before they leave: no document text, no client names in error messages, no email bodies in breadcrumbs. Configure Sentry's `beforeSend` to strip request bodies on any route touching documents or email.

---

## Rotation schedule

| Secret | Cadence | Trigger |
|---|---|---|
| AI provider keys | Quarterly | Also on any suspected leak |
| `EXTRACTOR_SHARED_SECRET` | Quarterly | |
| `WORKER_DB_PASSWORD` | Twice yearly | |
| OAuth client secrets | At provider expiry | Microsoft expires these — set a reminder |
| `SUPABASE_SERVICE_ROLE_KEY` | Annually | Also on any team change |
| `SUPABASE_JWT_SECRET` | Only on incident | Rotating logs everyone out |
| `ENCRYPTION_KEY` | Only on incident | Requires a re-encryption migration |

Any person leaving the project triggers rotation of everything they could read, regardless of schedule.

---

## If a secret leaks

1. Rotate first. Investigate second. The order matters.
2. If it was `SUPABASE_SERVICE_ROLE_KEY` or `DATABASE_URL`, assume all tenant data was readable for the exposure window and check `audit_log` and Supabase logs for access in that period.
3. If it was a brokerage OAuth refresh token, revoke it at Google or Microsoft, force that brokerage to reconnect, and tell them. This is their mailbox, not yours.
4. Record the incident, the window, the rotation and the finding in `docs/INCIDENTS.md`.

---

## Before Phase 1 begins

- [ ] 2FA on every account in `ASAP-Account-Checklist.pdf`
- [ ] Recovery codes for all of them in the vault, not on the laptop
- [ ] `ENCRYPTION_KEY` generated and backed up
- [ ] Separate AI provider keys per environment, with a spend cap on staging
- [ ] Secret scanning enabled in CI and in GitHub push protection
- [ ] `.env.local`, `.env.*.local` and `*.pem` in `.gitignore`
- [x] Decision recorded: staging holds **synthetic data only** (`docs/DECISIONS.md` D-003). The seed fixture is the only data staging receives.
