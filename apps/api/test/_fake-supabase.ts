/**
 * A small in-memory stand-in for the parts of supabase-js the API uses: auth.getUser, from().select
 * chains, and rpc(). Enough to exercise routing, auth, permission handling and error mapping
 * without a database. Database behaviour itself is proven by pgTAP (supabase/tests).
 */
import type { SupabaseFactory } from "../src/supabase.js";

export type FakeTable = Record<string, unknown>[];

export type FakeDb = {
  tables: Record<string, FakeTable>;
  rpc: Record<
    string,
    (args: Record<string, unknown>) => { data?: unknown; error?: { code: string; message: string } }
  >;
  users: Record<string, { id: string; email: string }>; // token -> auth user
  inserts: { table: string; row: Record<string, unknown> }[];
};

class Query {
  private filters: ((row: Record<string, unknown>) => boolean)[] = [];
  private single = false;
  private max: number | null = null;
  private sort: { col: string; ascending: boolean } | null = null;
  constructor(
    private readonly db: FakeDb,
    private readonly table: string,
    private readonly selectSpec: string,
  ) {}
  eq(col: string, v: unknown) {
    this.filters.push((r) => r[col] === v);
    return this;
  }
  neq(col: string, v: unknown) {
    this.filters.push((r) => r[col] !== v);
    return this;
  }
  gt(col: string, v: number) {
    this.filters.push((r) => Number(r[col]) > v);
    return this;
  }
  in(col: string, vs: unknown[]) {
    this.filters.push((r) => vs.includes(r[col]));
    return this;
  }
  is(col: string, v: unknown) {
    this.filters.push((r) => r[col] === v);
    return this;
  }
  ilike(col: string, pattern: string) {
    // %term% only, unescaped — enough for the Ask route's contains-search.
    const needle = pattern
      .replace(/^%|%$/g, "")
      .replace(/\\([\\%_])/g, "$1")
      .toLowerCase();
    this.filters.push((r) =>
      String(r[col] ?? "")
        .toLowerCase()
        .includes(needle),
    );
    return this;
  }
  limit(n: number) {
    this.max = n;
    return this;
  }
  order(col?: string, opts?: { ascending?: boolean }) {
    // Ordering matters to the ranked endpoints, so the stand-in sorts rather than ignoring it.
    if (col) this.sort = { col, ascending: opts?.ascending !== false };
    return this;
  }
  maybeSingle() {
    this.single = true;
    return this;
  }
  then<T>(resolve: (v: { data: unknown; error: null }) => T) {
    let rows = (this.db.tables[this.table] ?? []).filter((r) => this.filters.every((f) => f(r)));
    if (this.sort) {
      const { col, ascending } = this.sort;
      rows = [...rows].sort((a, b) => {
        const x = String(a[col] ?? "");
        const y = String(b[col] ?? "");
        return ascending ? x.localeCompare(y) : y.localeCompare(x);
      });
    }
    if (this.max !== null) rows = rows.slice(0, this.max);
    void this.selectSpec;
    return Promise.resolve(resolve({ data: this.single ? (rows[0] ?? null) : rows, error: null }));
  }
}

/** Deterministic ids and timestamps: a test that depends on the clock is a flaky test. */
let idCounter = 0;
const nextId = () =>
  `f0000000-0000-4000-8000-${String((idCounter += 1)).padStart(12, "0")}`;
const STAMP = "2026-09-11T00:00:00.000Z";

export function fakeFactory(db: FakeDb): SupabaseFactory {
  const client = (token: string | null) =>
    ({
      auth: {
        getUser: async (t: string) => {
          const u = db.users[t ?? token ?? ""];
          return u
            ? { data: { user: u }, error: null }
            : { data: { user: null }, error: { message: "bad" } };
        },
      },
      from: (table: string) => ({
        select: (spec: string) => new Query(db, table, spec),
        insert: (row: Record<string, unknown>) => {
          db.inserts.push({ table, row });
          const stored = { id: nextId(), created_at: STAMP, updated_at: STAMP, ...row };
          (db.tables[table] ??= []).push(stored);
          // Awaitable on its own, and chainable as .select(...).single() — both shapes the API
          // uses. Returning the stored row matters: a route that reads back what it wrote must
          // see the same row a real insert would have returned.
          const result = { data: stored, error: null };
          return {
            then: (resolve: (v: { error: null }) => unknown) => Promise.resolve(resolve({ error: null })),
            select: () => ({
              single: async () => result,
              maybeSingle: async () => result,
            }),
          };
        },
      }),
      rpc: async (name: string, args: Record<string, unknown>) => {
        const fn = db.rpc[name];
        if (!fn) return { data: null, error: { code: "42883", message: `no rpc ${name}` } };
        const r = fn(args);
        return { data: r.data ?? null, error: r.error ?? null };
      },
    }) as unknown as ReturnType<SupabaseFactory["forUser"]>;
  return {
    anon: () => client(null),
    forUser: (t) => client(t),
    service: () => client(null),
  };
}
