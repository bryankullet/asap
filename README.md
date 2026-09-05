# ASAP

A multi-tenant AI operating system for insurance brokerages. Read `CLAUDE.md` first; the controlling reference is `docs/ASAP-Architecture-v3.0.md`.

## Status

Phase 1 — secure brokerage workspace. Work items 1–3 (monorepo, environment separation, schema and migrations) are in place. Work items 4–9 follow. See `docs/PHASE-1-WORK-ORDER.md`.

## Layout

```
apps/web         React PWA (Vite, Tailwind, shadcn conventions)
apps/api         Hono API
apps/workers     Node/TS queue consumers (connect as asap_worker)
apps/extractor   Python extraction service (stub)
packages/schema  Zod: env, API contracts
packages/db      Drizzle schema mirroring supabase/migrations
packages/ui      Component library
supabase/        migrations, seed, config, pgTAP tests
docs/            architecture, work order, schema, secrets, decisions
scripts/         checks and operational scripts
```

## Getting started

```bash
pnpm install
cp .env.example .env.local           # fill in; never commit
supabase start                       # local stack (needs Docker)
supabase db reset                    # migrations + seed
pnpm db:worker-password              # sets the asap_worker password from WORKER_DB_PASSWORD
pnpm dev
```

No Docker? `pnpm db:verify:local` applies the migrations and seed to a plain PostgreSQL 16 (see `docs/DECISIONS.md` D-013).

## Checks

```bash
pnpm build          # includes the web bundle check
pnpm typecheck
pnpm lint           # eslint + secret scan
pnpm test           # vitest
pnpm test:rls       # pgTAP isolation suite (work item 5)
pnpm db:drift       # Drizzle ↔ database agreement (needs DATABASE_URL)
pnpm db:migrations:immutable
```
