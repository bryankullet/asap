import { createHash } from "node:crypto";

/**
 * Reads the parts of an RFC 5322 message ASAP needs from a pasted or uploaded .eml (D-144): the
 * sender, recipients, subject, date, message id, the plain-text body, and the attachments.
 *
 * Deliberately small: unfolded headers, RFC 2047 encoded words, multipart (the first text/plain
 * part, else text/html with the tags stripped), quoted-printable and base64. Anything it cannot
 * read leaves the body empty rather than guessing.
 */
export type ParsedAttachment = { filename: string; contentType: string; content: Buffer };
export type ParsedEmail = { from: string; to: string[]; cc: string[]; subject: string; body: string; sentAt: string | null; messageId: string; attachments: ParsedAttachment[] };

function headersOf(block: string): Map<string, string> {
  const unfolded = block.replace(/\r\n/g, "\n").replace(/\n[ \t]+/g, " ");
  const out = new Map<string, string>();
  for (const line of unfolded.split("\n")) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    const key = line.slice(0, i).trim().toLowerCase();
    if (!out.has(key)) out.set(key, line.slice(i + 1).trim());
  }
  return out;
}

const qp = (s: string) => s.replace(/=\r?\n/g, "").replace(/=([0-9A-Fa-f]{2})/g, (_x, h: string) => String.fromCharCode(parseInt(h, 16)));

function decodeWords(v: string): string {
  return v.replace(/=\?([^?]+)\?([bqBQ])\?([^?]*)\?=/g, (_m, charset: string, enc: string, text: string) => {
    const buf = enc.toUpperCase() === "B" ? Buffer.from(text, "base64") : Buffer.from(qp(text.replace(/_/g, " ")), "latin1");
    return /utf-?8/i.test(charset) ? buf.toString("utf8") : buf.toString("latin1");
  });
}

const addresses = (v: string | undefined): string[] =>
  (v ?? "").split(",").map((p) => (p.match(/<([^>]+)>/)?.[1] ?? p).trim().toLowerCase()).filter((a) => /^[^@\s]+@[^@\s]+$/.test(a));

function bytesOf(body: string, encoding: string | undefined): Buffer {
  const enc = (encoding ?? "").toLowerCase();
  if (enc === "base64") return Buffer.from(body.replace(/\s+/g, ""), "base64");
  if (enc === "quoted-printable") return Buffer.from(qp(body), "latin1");
  return Buffer.from(body, "latin1");
}
const textOfBytes = (b: Buffer, charset: string) => (/utf-?8/i.test(charset) ? b.toString("utf8") : b.toString("latin1"));

const param = (header: string | undefined, name: string) => header?.match(new RegExp(`${name}="?([^";]+)"?`, "i"))?.[1];
const stripHtml = (html: string) => html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "").replace(/<br\s*\/?>|<\/p>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

type Walk = { plain: string | null; html: string | null; attachments: ParsedAttachment[] };

function walk(headers: Map<string, string>, body: string): Walk {
  const type = headers.get("content-type") ?? "text/plain";
  const charset = param(type, "charset") ?? "utf-8";
  if (/^multipart\//i.test(type)) {
    const boundary = param(type, "boundary");
    const out: Walk = { plain: null, html: null, attachments: [] };
    if (!boundary) return out;
    for (const raw of body.split(`--${boundary}`).slice(1)) {
      if (raw.startsWith("--")) break;
      const part = raw.replace(/^\r?\n/, "");
      const split = part.search(/\r?\n\r?\n/);
      if (split < 0) continue;
      const inner = walk(headersOf(part.slice(0, split)), part.slice(split).replace(/^\r?\n\r?\n/, ""));
      out.plain ??= inner.plain;
      out.html ??= inner.html;
      out.attachments.push(...inner.attachments);
    }
    return out;
  }
  const disposition = headers.get("content-disposition") ?? "";
  const filename = param(disposition, "filename") ?? param(type, "name");
  if (/attachment/i.test(disposition) || (filename && !/^text\/(plain|html)/i.test(type))) {
    return { plain: null, html: null, attachments: [{ filename: decodeWords(filename ?? "attachment"), contentType: type.split(";")[0]!.trim().toLowerCase(), content: bytesOf(body.replace(/\r?\n$/, ""), headers.get("content-transfer-encoding")) }] };
  }
  const decoded = textOfBytes(bytesOf(body, headers.get("content-transfer-encoding")), charset);
  if (/^text\/html/i.test(type)) return { plain: null, html: decoded, attachments: [] };
  if (/^text\//i.test(type)) return { plain: decoded, html: null, attachments: [] };
  return { plain: null, html: null, attachments: [] };
}

export function parseEml(raw: string): ParsedEmail {
  const text = raw.replace(/\r\n/g, "\n");
  const split = text.indexOf("\n\n");
  const headers = headersOf(split < 0 ? text : text.slice(0, split));
  const body = split < 0 ? "" : text.slice(split + 2);
  const { plain, html, attachments } = walk(headers, body);
  const date = headers.get("date");
  const parsedDate = date ? new Date(date) : null;
  const from = addresses(headers.get("from"))[0] ?? "";
  return {
    from,
    to: addresses(headers.get("to")),
    cc: addresses(headers.get("cc")),
    subject: decodeWords(headers.get("subject") ?? ""),
    body: (plain ?? (html ? stripHtml(html) : "")).trim(),
    sentAt: parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toISOString() : null,
    // A message without its own id is identified by its content, so pasting it twice is one message.
    messageId: headers.get("message-id")?.replace(/[<>]/g, "") ?? messageIdFor(from, headers.get("subject") ?? "", plain ?? html ?? "", date ?? ""),
    attachments,
  };
}

export const messageIdFor = (from: string, subject: string, body: string, date: string) =>
  `pasted-${createHash("sha256").update([from.toLowerCase(), subject, body.trim(), date].join("\n")).digest("hex").slice(0, 32)}`;
