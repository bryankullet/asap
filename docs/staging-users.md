# Staging users

Staging holds synthetic data only (D-003). Its users are the fixture users from `supabase/seed.sql`, and every one of them signs in with the same documented password. This applies to **staging and local stacks only**: the script that sets the password refuses to run when `APP_ENV` is `production`, and refuses when `APP_ENV` is unset (D-052).

## Password

```
asap-staging-2026
```

Set by `pnpm db:seed:passwords` (`scripts/seed-set-passwords.mjs`) through the Supabase Auth admin API, after the seed has been applied. `SEED_PASSWORD` overrides it for a private stack; the minimum is 12 characters (D-005).

## Users

Two brokerages, seven people. The consultant is deliberately a member of both, with a different role in each. Owner means the membership that created the brokerage.

| Email | Name | Brokerage | Role | Owner |
|---|---|---|---|---|
| `admin@acme-brokers.test` | Amina Otieno | Acme Insurance Brokers | Brokerage administrator (`brokerage_admin`) | yes |
| `ae@acme-brokers.test` | Brian Kamau | Acme Insurance Brokers | Account executive (`account_executive`) | |
| `finance@acme-brokers.test` | Cynthia Wanjiru | Acme Insurance Brokers | Finance officer (`finance_officer`) | |
| `admin@beta-risk.test` | David Mwangi | Beta Risk Partners | Brokerage administrator (`brokerage_admin`) | yes |
| `ae@beta-risk.test` | Esther Njeri | Beta Risk Partners | Account executive (`account_executive`) | |
| `finance@beta-risk.test` | Felix Odhiambo | Beta Risk Partners | Finance officer (`finance_officer`) | |
| `shared@consultant.test` | Grace Achieng | Acme Insurance Brokers | Read only (`read_only`) | |
| `shared@consultant.test` | Grace Achieng | Beta Risk Partners | Account executive (`account_executive`) | |

## Running it

```bash
# staging (service key from the deployment's server-side env, never from a laptop's shell history)
APP_ENV=staging SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=... pnpm db:seed:passwords

# local, after supabase db reset (reads .env.local)
APP_ENV=local pnpm db:seed:passwords
```

The script updates the seven users by id, so it is safe to run again after a reseed. A user it cannot update is reported by email and the exit code is non-zero.
