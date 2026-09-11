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
  /**
   * Column defaults the database would apply on insert, per table. A route that reads back what
   * it wrote sees them, as it would in Postgres — declaring them here keeps the stand-in honest
   * about the difference between "the route did not send it" and "the column has a default".
   */
  defaults?: Record<string, Record<string, unknown>>;
  /**
   * Unique constraints the database enforces, per table, as column lists. Without these a test
   * of idempotency proves nothing: the route relies on the insert *failing*, and a stand-in that
   * accepts every insert would pass while the real thing sent a second email.
   */
  uniques?: Record<string, string[][]>;
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
        // Update, for the extraction-review route. Returns the updated row so a route that reads
        // back what it wrote sees what a real update would have returned.
        update: (patch: Record<string, unknown>) => {
          const filters: [string, unknown][] = [];
          const chain = {
            eq(col: string, val: unknown) {
              filters.push([col, val]);
              return chain;
            },
            select() {
              return chain;
            },
            async single() {
              const row = (db.tables[table] ??= []).find((r) => filters.every(([c, v]) => r[c] === v));
              if (!row) return { data: null, error: { code: "PGRST116", message: "no rows" } };
              Object.assign(row, patch);
              return { data: row, error: null };
            },
            then(resolve: (v: { error: null }) => unknown) {
              for (const row of db.tables[table] ?? []) {
                if (filters.every(([c, v]) => row[c] === v)) Object.assign(row, patch);
              }
              return Promise.resolve(resolve({ error: null }));
            },
          };
          return chain;
        },
        // Upsert and delete, for the pin route. Both keep the table consistent so a test can read
        // back what it wrote rather than trusting the call's return.
        upsert: async (row: Record<string, unknown>, opts?: { onConflict?: string }) => {
          const keys = (opts?.onConflict ?? "id").split(",").map((k) => k.trim());
          const rows = (db.tables[table] ??= []);
          const found = rows.find((r) => keys.every((k) => r[k] === row[k]));
          if (found) Object.assign(found, row);
          else rows.push({ created_at: STAMP, ...row });
          db.inserts.push({ table, row });
          return { error: null };
        },
        delete: () => {
          const filters: [string, unknown][] = [];
          const chain = {
            eq(col: string, val: unknown) {
              filters.push([col, val]);
              return chain;
            },
            then(resolve: (v: { error: null }) => unknown) {
              const rows = (db.tables[table] ??= []);
              db.tables[table] = rows.filter((r) => !filters.every(([c, v]) => r[c] === v));
              return Promise.resolve(resolve({ error: null }));
            },
          };
          return chain;
        },
        insert: (row: Record<string, unknown>) => {
          db.inserts.push({ table, row });
          const stored: Record<string, unknown> = {
            id: nextId(),
            created_at: STAMP,
            updated_at: STAMP,
            ...(db.defaults?.[table] ?? {}),
            ...row,
          };
          const rows = (db.tables[table] ??= []);
          for (const cols of db.uniques?.[table] ?? []) {
            if (rows.some((r) => cols.every((c) => r[c] === stored[c]))) {
              // 23505, as Postgres would answer. The route's duplicate path depends on it.
              const conflict = { code: "23505", message: `duplicate key value violates unique constraint on ${cols.join(",")}`, details: null, hint: null };
              return {
                then: (resolve: (v: { error: unknown }) => unknown) => Promise.resolve(resolve({ error: conflict })),
                select: () => ({
                  single: async () => ({ data: null, error: conflict }),
                  maybeSingle: async () => ({ data: null, error: conflict }),
                }),
              };
            }
          }
          rows.push(stored);
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
      // Storage: signing only. No bytes move in these tests, and none should — the point of the
      // private bucket is that reads are short-lived signed URLs, which is what this returns.
      storage: {
        from: () => ({
          createSignedUrl: async (path: string, ttl: number) => ({
            data: { signedUrl: `https://stub.invalid/${path}?ttl=${ttl}` },
            error: null,
          }),
          createSignedUploadUrl: async (path: string) => ({
            data: { signedUrl: `https://stub.invalid/upload/${path}`, token: "stub-upload-token", path },
            error: null,
          }),
        }),
      },
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
