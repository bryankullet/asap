/**
 * The connected API as a server, for the browser end-to-end run (scripts/test-e2e.sh).
 *
 * The same wiring the connected tests use — the real API, supabase-js, PostgREST, RLS and every
 * grant — listening on a local port so a real browser can drive it. The one stand-in remains
 * Supabase Auth's token lookup, answered from the same signed token PostgREST verifies. Refuses
 * to start against anything but a local database.
 */
import { serve } from "@hono/node-server";
import postgres from "postgres";
import { buildApp, newApiKey, OWNER } from "./_harness.js";

if (!/127\.0\.0\.1|localhost/.test(OWNER ?? "")) throw new Error("e2e serve: refusing a non-local database");
const port = Number(process.env["CONNECTED_API_PORT"] ?? 3398);
const web = process.env["E2E_WEB_ORIGIN"] ?? "http://127.0.0.1:5199";
const key = newApiKey();
const sql = postgres(OWNER, { max: 1, onnotice: () => {} });
await sql`insert into app.api_keys (key_hash, label) values (encode(extensions.digest(${key}, 'sha256'), 'hex'), 'e2e-serve')`;
await sql.end();
serve({ fetch: buildApp(key, [], web).fetch, port, hostname: "127.0.0.1" });
process.stdout.write(`e2e api listening on ${port}\n`);
