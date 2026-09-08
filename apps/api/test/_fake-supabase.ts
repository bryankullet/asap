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
  order() {
    return this;
  }
  maybeSingle() {
    this.single = true;
    return this;
  }
  then<T>(resolve: (v: { data: unknown; error: null }) => T) {
    let rows = (this.db.tables[this.table] ?? []).filter((r) => this.filters.every((f) => f(r)));
    if (this.max !== null) rows = rows.slice(0, this.max);
    void this.selectSpec;
    return Promise.resolve(resolve({ data: this.single ? (rows[0] ?? null) : rows, error: null }));
  }
}

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
        insert: async (row: Record<string, unknown>) => {
          db.inserts.push({ table, row });
          return { error: null };
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
