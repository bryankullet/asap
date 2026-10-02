/**
 * The connected API as a server, for the browser end-to-end run (scripts/test-e2e.sh).
 *
 * The same wiring the connected tests use — the real API, supabase-js, PostgREST, RLS and every
 * grant — listening on a local port so a real browser can drive it. The one stand-in remains
 * Supabase Auth's token lookup, answered from the same signed token PostgREST verifies. Refuses
 * to start against anything but a local database.
 */
import { createServer } from "node:http";
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
const app = buildApp(key, [], web);
serve({ fetch: app.fetch, port, hostname: "127.0.0.1" });
process.stdout.write(`e2e api listening on ${port}\n`);

/*
 * Storage stand-in (opt-in: E2E_STORAGE_PORT). Answers the Supabase Storage REST calls the API makes
 * — sign an upload, sign a read, download — and the browser's PUT to the signed upload URL, holding
 * the bytes in memory. It is the only way a local run can file a real document; the hosted path uses
 * Supabase Storage itself. Not a security boundary: test-only, local-only.
 */
const storagePort = Number(process.env["E2E_STORAGE_PORT"] ?? 0);
if (storagePort) {
  const objects = new Map<string, { body: Buffer; type: string }>();
  const cors = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,PUT,OPTIONS", "access-control-allow-headers": "authorization,content-type,x-upsert,apikey,x-client-info,cache-control" };
  createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://local");
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const send = (status: number, body: unknown, type = "application/json") => {
        res.writeHead(status, { ...cors, "content-type": type });
        res.end(Buffer.isBuffer(body) ? body : JSON.stringify(body));
      };
      if (req.method === "OPTIONS") return send(204, "");
      const m = /^\/storage\/v1\/object\/(upload\/sign|sign|authenticated|public)?\/?(.+)$/.exec(decodeURIComponent(u.pathname));
      if (!m) return send(404, { statusCode: "404", error: "not_found", message: "no such route" });
      const [, kind, key] = m;
      if (kind === "upload/sign" && req.method === "POST") return send(200, { url: `/object/upload/sign/${key}?token=local` });
      if (kind === "upload/sign" && req.method === "PUT") {
        objects.set(key!, { body: Buffer.concat(chunks), type: String(req.headers["content-type"] ?? "application/octet-stream") });
        return send(200, { Key: key });
      }
      if (kind === "sign" && req.method === "POST") return objects.has(key!) ? send(200, { signedURL: `/object/sign/${key}?token=local` }) : send(400, { statusCode: "404", error: "not_found", message: "Object not found" });
      const o = objects.get(key!);
      if (req.method === "GET" && o) return send(200, o.body, o.type);
      return send(400, { statusCode: "404", error: "not_found", message: "Object not found" });
    });
  }).listen(storagePort, "127.0.0.1");
  process.stdout.write(`e2e storage stand-in on ${storagePort}\n`);
}

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
