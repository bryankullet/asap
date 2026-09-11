#!/usr/bin/env node
/**
 * A development stand-in for Supabase, backed by the real local PostgreSQL.
 *
 * It speaks the small part of PostgREST and GoTrue that the API actually uses, and every read and
 * write goes to a real, fully migrated, seeded database. That makes it possible to run the whole
 * product on a machine without Docker — `scripts/db-verify-local.sh` builds the database, this
 * serves it, and the real Hono API and the real React bundle run unchanged on top.
 *
 * **What it does not do, and must never be trusted for:**
 *
 *  - **No real tokens.** A bearer token is a seeded user's email, not a verified JWT. Anyone who
 *    can reach this port is any user they name, which is why it binds to loopback and refuses to
 *    run outside `APP_ENV=local`.
 *  - **RLS is exercised, but this is not what proves it.** A request carrying a user's token runs
 *    in a transaction as `authenticated` with that user's claims, so policies apply exactly as
 *    they do in the deployed stack — which is what makes the engine's SECURITY DEFINER wrappers
 *    work at all here. What *proves* isolation is `pnpm test:rls`: 395 pgTAP assertions against
 *    this same database. Never conclude from a green harness run that isolation holds.
 *
 * It therefore refuses to start unless `APP_ENV=local`, and binds to loopback only.
 *
 *   pnpm --filter @asap/db dev:stub           # DATABASE_URL, STUB_PORT (default 54399)
 *
 * It lives in `packages/db` because that is where the PostgreSQL driver is a dependency.
 */
import http from "node:http";
import postgres from "postgres";

if ((process.env.APP_ENV ?? "local") !== "local") {
  console.error("dev-supabase-stub: refuses to run outside APP_ENV=local");
  process.exit(1);
}

const PORT = Number(process.env.STUB_PORT ?? 54399);
const sql = postgres(
  process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/asap_verify",
  {
    max: 4,
    transform: { undefined: null },
    /*
     * PostgREST exposes one schema — `public` here, which is where the wrappers live — and the
     * functions they call live in `app`. Calling unqualified with both on the path resolves each
     * one the way the deployed stack does.
     */
    connection: { search_path: "public, app" },
    /*
     * PostgREST serialises int8 as a JSON number; the driver returns it as a string by default,
     * which made every `bigint` id fail its contract at the API. Matching PostgREST here keeps the
     * harness honest — the API must see what it will see in production.
     */
    types: {
      bigint: { to: 20, from: [20], serialize: (x) => String(x), parse: (x) => Number(x) },
      /*
       * A `date` is a day, not an instant. PostgREST returns "2026-01-01"; the driver would hand
       * back a Date that JSON-serialises to a timestamp, and every contract that says a date is
       * ten characters long would fail against a harness that is wrong rather than a product that
       * is. The same reasoning as bigint above: the API must see what it will see in production.
       */
      date: { to: 1082, from: [1082], serialize: (x) => String(x), parse: (x) => String(x) },
    },
  },
);

/** PostgREST's filter grammar, as far as the API uses it. */
const OPERATORS = {
  eq: (c, v) => sql`${sql(c)} = ${v}`,
  neq: (c, v) => sql`${sql(c)} <> ${v}`,
  gt: (c, v) => sql`${sql(c)} > ${v}`,
  gte: (c, v) => sql`${sql(c)} >= ${v}`,
  lt: (c, v) => sql`${sql(c)} < ${v}`,
  lte: (c, v) => sql`${sql(c)} <= ${v}`,
  is: (c, v) => (v === "null" ? sql`${sql(c)} is null` : sql`${sql(c)} is not null`),
  in: (c, v) => sql`${sql(c)} = any(${v.replace(/^\(|\)$/g, "").split(",").map((s) => s.replace(/^"|"$/g, ""))})`,
  like: (c, v) => sql`${sql(c)} like ${v.replaceAll("*", "%")}`,
  ilike: (c, v) => sql`${sql(c)} ilike ${v.replaceAll("*", "%")}`,
};

/**
 * `select=` with PostgREST's embedded resources: `id, role:roles ( id, name )`.
 *
 * Only the shape the API asks for is supported — an embed resolved by this row's own `<name>_id`
 * column — which is every embed in the codebase. Anything else is better rejected loudly than
 * answered wrongly.
 */
function parseSelect(select) {
  const columns = [];
  const embeds = [];
  let depth = 0;
  let buffer = "";
  for (const ch of `${select ?? "*"},`) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      const part = buffer.trim();
      buffer = "";
      if (!part) continue;
      const m = /^([\w]+)\s*:\s*([\w]+)\s*\(([\s\S]*)\)$/.exec(part) ?? /^([\w]+)\s*\(([\s\S]*)\)$/.exec(part);
      if (m) {
        const alias = m[1];
        const table = m.length === 4 ? m[2] : m[1];
        const inner = m.length === 4 ? m[3] : m[2];
        embeds.push({ alias, table, select: parseSelect(inner) });
      } else {
        columns.push(part);
      }
      continue;
    }
    buffer += ch;
  }
  return { columns, embeds };
}

async function resolveEmbeds(rows, embeds, db = sql) {
  for (const embed of embeds) {
    const fk = `${embed.alias}_id`;
    const ids = [...new Set(rows.map((r) => r[fk]).filter((v) => v !== null && v !== undefined))];
    const related = ids.length
      ? await db`select * from ${db(embed.table)} where id = any(${ids})`
      : [];
    const byId = new Map(related.map((r) => [r.id, r]));
    for (const row of rows) {
      const found = byId.get(row[fk]) ?? null;
      row[embed.alias] = found ? project(found, embed.select) : null;
      if (found) await resolveEmbeds([row[embed.alias]], embed.select.embeds, db);
    }
  }
  return rows;
}

function project(row, select) {
  if (select.columns.includes("*") || select.columns.length === 0) return { ...row };
  const out = {};
  for (const col of select.columns) out[col] = row[col];
  return out;
}

/**
 * Run one request's work as the caller.
 *
 * PostgREST hands every request to PostgreSQL with `request.jwt.claims` set and the role switched
 * to `authenticated`, and the whole engine depends on it: `auth.uid()` is how the SECURITY DEFINER
 * wrappers know who is acting, and every RLS policy reads it. Doing the same here is what makes a
 * write through this harness behave like a write in the deployed stack.
 *
 * The service key keeps owner rights, as the service role does, for the few boot-time calls the
 * API makes with it.
 */
async function asCaller(token, headers, run) {
  if (!token || token === process.env.SUPABASE_SERVICE_ROLE_KEY) return run(sql);
  const [user] = await sql`select id from users where email = ${token}`;
  if (!user) return { unauthorized: true };
  return sql.begin(async (tx) => {
    const claims = JSON.stringify({ sub: user.id, role: "authenticated" });
    await tx`select set_config('request.jwt.claims', ${claims}, true)`;
    /*
     * PostgREST hands the request's headers to PostgreSQL as `request.headers`, and the engine
     * depends on it: `app.is_api_caller()` reads `x-asap-api-key` from there to refuse a write
     * that came from a browser holding the anon key rather than from the API. Without it every
     * engine write fails with `api_only`.
     */
    await tx`select set_config('request.headers', ${JSON.stringify(headers)}, true)`;
    await tx`set local role authenticated`;
    return run(tx);
  });
}

const body = (req) =>
  new Promise((resolve) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => resolve(raw ? JSON.parse(raw) : null));
  });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const send = (status, payload) => {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    });
    res.end(payload === undefined ? "" : JSON.stringify(payload));
  };
  if (req.method === "OPTIONS") return send(204);

  try {
    const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    // Header names arrive lower-cased from Node, which is what PostgREST passes on too.
    const headers = Object.fromEntries(
      Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(",") : (v ?? "")]),
    );

    // GoTrue, as far as the API reads it: a bearer token is a seeded user's email address.
    if (url.pathname === "/auth/v1/user") {
      const [user] = await sql`select id, email from users where email = ${token}`;
      if (!user) return send(401, { message: "invalid token" });
      return send(200, {
        id: user.id,
        email: user.email,
        aud: "authenticated",
        role: "authenticated",
      });
    }
    if (url.pathname === "/auth/v1/token") {
      const input = await body(req);
      const [user] = await sql`select id, email from users where email = ${input?.email ?? ""}`;
      if (!user) return send(400, { error: "invalid_grant" });
      return send(200, {
        access_token: user.email,
        token_type: "bearer",
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: user.email,
        user: { id: user.id, email: user.email, aud: "authenticated", role: "authenticated" },
      });
    }

    if (url.pathname.startsWith("/rest/v1/rpc/")) {
      const fn = url.pathname.slice("/rest/v1/rpc/".length);
      const args = (await body(req)) ?? {};
      /*
       * Named arguments, as supabase-js sends them, written as literals rather than bound
       * parameters: a bound parameter arrives as `unknown` and PostgreSQL cannot then resolve
       * which overload of a function like `app.work_item_apply` was meant. Literals are coerced
       * to the declared parameter types, which is how psql calls the same functions.
       *
       * These are values from a local development database, escaped here; nothing about this file
       * runs in a deployment (it refuses to start outside APP_ENV=local).
       */
      const literal = (v) => {
        if (v === null || v === undefined) return "null";
        if (typeof v === "number" || typeof v === "boolean") return String(v);
        if (typeof v === "object") return `'${JSON.stringify(v).replaceAll("'", "''")}'`;
        return `'${String(v).replaceAll("'", "''")}'`;
      };
      const names = Object.keys(args);
      const call = names.map((n) => `${n} => ${literal(args[n])}`).join(", ");
      const out = await asCaller(token, headers, async (db) => {
        const [row] = await db.unsafe(`select ${fn}(${call}) as result`);
        return row?.result ?? null;
      });
      if (out?.unauthorized) return send(401, { message: "invalid token" });
      return send(200, out ?? null);
    }

    const table = /^\/rest\/v1\/([\w]+)$/.exec(url.pathname)?.[1];
    if (!table) return send(404, { message: `dev-supabase-stub: no route ${url.pathname}` });

    const select = parseSelect(url.searchParams.get("select") ?? "*");
    const single = (req.headers.accept ?? "").includes("vnd.pgrst.object");

    /*
     * `select("id", { count: "exact", head: true })` asks PostgREST for a count and no rows: a
     * HEAD request whose answer is the `content-range` header. Without it a caller that only
     * wanted a number gets nothing, and the screen degrades for no reason.
     */
    if (req.method === "HEAD" || (req.headers.prefer ?? "").includes("count=")) {
      const filters = [];
      for (const [key, value] of url.searchParams) {
        if (["select", "order", "limit", "offset"].includes(key)) continue;
        const [op, ...rest] = value.split(".");
        const build = OPERATORS[op];
        if (!build) return send(400, { message: `dev-supabase-stub: operator ${op}` });
        filters.push(build(key, rest.join(".")));
      }
      const counted = await asCaller(token, headers, async (db) => {
        let query = db`select count(*)::int as n from ${db(table)}`;
        for (const [i, f] of filters.entries())
          query = db`${query} ${i === 0 ? db`where` : db`and`} ${f}`;
        const [row] = await query;
        return row?.n ?? 0;
      });
      if (counted?.unauthorized) return send(401, { message: "invalid token" });
      res.writeHead(req.method === "HEAD" ? 200 : 206, {
        "Content-Type": "application/json",
        "Content-Range": `0-${Math.max(0, counted - 1)}/${counted}`,
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Expose-Headers": "content-range",
      });
      return res.end(req.method === "HEAD" ? "" : "[]");
    }

    if (req.method === "GET") {
      const filters = [];
      for (const [key, value] of url.searchParams) {
        if (["select", "order", "limit", "offset"].includes(key)) continue;
        const [op, ...rest] = value.split(".");
        const build = OPERATORS[op];
        if (!build) return send(400, { message: `dev-supabase-stub: operator ${op}` });
        filters.push(build(key, rest.join(".")));
      }
      const rows = await asCaller(token, headers, async (db) => {
        let query = db`select * from ${db(table)}`;
        for (const [i, f] of filters.entries())
          query = db`${query} ${i === 0 ? db`where` : db`and`} ${f}`;
        const order = url.searchParams.get("order");
        if (order) {
          const [col, dir] = order.split(".");
          query = db`${query} order by ${db(col)} ${dir === "desc" ? db`desc` : db`asc`}`;
        }
        const limit = url.searchParams.get("limit");
        if (limit) query = db`${query} limit ${Number(limit)}`;
        return resolveEmbeds([...(await query)].map((r) => ({ ...r })), select.embeds, db);
      });
      if (rows?.unauthorized) return send(401, { message: "invalid token" });
      const projected = rows.map((r) => {
        const out = project(r, select);
        for (const e of select.embeds) out[e.alias] = r[e.alias];
        return out;
      });
      if (single) return send(200, projected[0] ?? null);
      return send(200, projected);
    }

    if (req.method === "POST") {
      const input = await body(req);
      const rows = Array.isArray(input) ? input : [input];
      const inserted = await asCaller(token, headers, async (db) => {
        const out = [];
        for (const row of rows) {
          const [written] = await db`insert into ${db(table)} ${db(row)} returning *`;
          out.push(written);
        }
        return out;
      });
      if (inserted?.unauthorized) return send(401, { message: "invalid token" });
      const projected = inserted.map((r) => project(r, select));
      return send(201, single ? (projected[0] ?? null) : projected);
    }

    if (req.method === "PATCH") {
      const input = await body(req);
      const filters = [];
      for (const [key, value] of url.searchParams) {
        if (["select", "order", "limit", "offset"].includes(key)) continue;
        const [op, ...rest] = value.split(".");
        filters.push(OPERATORS[op](key, rest.join(".")));
      }
      const updated = await asCaller(token, headers, async (db) => {
        let query = db`update ${db(table)} set ${db(input)}`;
        for (const [i, f] of filters.entries())
          query = db`${query} ${i === 0 ? db`where` : db`and`} ${f}`;
        return db`${query} returning *`;
      });
      if (updated?.unauthorized) return send(401, { message: "invalid token" });
      const projected = [...updated].map((r) => project(r, select));
      return send(200, single ? (projected[0] ?? null) : projected);
    }

    return send(405, { message: `dev-supabase-stub: ${req.method}` });
  } catch (e) {
    // The database's own message, verbatim: this is a development tool and the message is the point.
    return send(400, { message: e instanceof Error ? e.message : String(e), code: e?.code ?? null });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`dev-supabase-stub: 127.0.0.1:${PORT} → real PostgreSQL (RLS on for user tokens, no real JWTs)`);
});
