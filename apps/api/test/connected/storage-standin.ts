import { createServer } from "node:http";

/**
 * Storage stand-in. Answers the Supabase Storage REST calls the API makes — sign an upload, sign a
 * read, download, and a direct upload from the server (an email's attachment, D-153) — and the
 * browser's PUT to a signed upload URL, holding the bytes in memory. The only way a local run can
 * file a real document; the hosted path uses Supabase Storage itself. Not a security boundary:
 * test-only, local-only.
 */
export function startStorageStandIn(port: number) {
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
      if ((kind === "upload/sign" && req.method === "PUT") || (kind === undefined && (req.method === "POST" || req.method === "PUT"))) {
        if (kind === undefined && objects.has(key!) && req.headers["x-upsert"] !== "true") return send(400, { statusCode: "409", error: "Duplicate", message: "The resource already exists" });
        objects.set(key!, { body: Buffer.concat(chunks), type: String(req.headers["content-type"] ?? "application/octet-stream") });
        return send(200, { Key: key, Id: key });
      }
      if (kind === "sign" && req.method === "POST") return objects.has(key!) ? send(200, { signedURL: `/object/sign/${key}?token=local` }) : send(400, { statusCode: "404", error: "not_found", message: "Object not found" });
      const o = objects.get(key!);
      if (req.method === "GET" && o) return send(200, o.body, o.type);
      return send(400, { statusCode: "404", error: "not_found", message: "Object not found" });
    });
  }).listen(port, "127.0.0.1");
  process.stdout.write(`storage stand-in on ${port}\n`);
}

// Run directly: `tsx storage-standin.ts <port>` (the connected suite starts it this way).
if (process.argv[1]?.endsWith("storage-standin.ts")) startStorageStandIn(Number(process.argv[2] ?? 3398));
