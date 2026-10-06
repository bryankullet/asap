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
import { startStorageStandIn } from "./storage-standin.js";

if (!/127\.0\.0\.1|localhost/.test(OWNER ?? "")) throw new Error("e2e serve: refusing a non-local database");
const port = Number(process.env["CONNECTED_API_PORT"] ?? 3398);
const web = process.env["E2E_WEB_ORIGIN"] ?? "http://127.0.0.1:5199";
const key = newApiKey();
const sql = postgres(OWNER, { max: 1, onnotice: () => {} });
await sql`insert into app.api_keys (key_hash, label) values (encode(extensions.digest(${key}, 'sha256'), 'hex'), 'e2e-serve')`;
await sql.end();
const app = buildApp(key, [], web);
serve({ fetch: app.fetch, port, hostname: "127.0.0.1" });
process.stdout.write(`e2e api listening on ${port}\n`);

// Storage stand-in (opt-in: E2E_STORAGE_PORT), shared with the connected suite.
const storagePort = Number(process.env["E2E_STORAGE_PORT"] ?? 0);
if (storagePort) startStorageStandIn(storagePort);

/*
 * The worker's event dispatch, for the browser run (opt-in: E2E_DISPATCH=1): every two seconds,
 * each unprocessed event goes to the API's internal dispatch route, exactly as asap-worker sends it,
 * so "document.received" reaches the extractor.
 */
if (process.env["E2E_DISPATCH"]) {
  const db = postgres(OWNER, { max: 1, onnotice: () => {} });
  const tick = async () => {
    const due = await db<{ id: string }[]>`select id from events where processed_at is null and processing_attempts < 5 order by occurred_at limit 20`.catch(() => []);
    for (const e of due) {
      const r = await app.request(`/internal/events/${e.id}/dispatch`, { method: "POST", headers: { "x-asap-internal-key": key } });
      const body = (await r.json().catch(() => ({}))) as { results?: { result: string; consumer: string; detail?: string }[] };
      const failed = (body.results ?? []).filter((x) => x.result === "failure");
      if (r.ok && !failed.length) await db`select app.mark_event_processed(${e.id})`;
      else await db`select app.mark_event_attempted(${e.id}, ${failed.map((f) => f.consumer + ": " + (f.detail ?? "")).join("; ") || "dispatch " + r.status})`;
    }
  };
  setInterval(() => void tick().catch(() => {}), 2000);
}
