import { createHash, timingSafeEqual } from "node:crypto";
import {
  WEBSITE_ENQUIRY_LABELS,
  websiteEnquiryResponseSchema,
  websiteEnquirySchema,
  type WebsiteEnquiry,
  type WebsiteEnquiryKind,
} from "@asap/schema";
import { Hono } from "hono";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Logger } from "pino";
import { HttpError, mapDatabaseError, sendError } from "../errors.js";
import { parseBody } from "./_parse.js";

/**
 * Website intake (D-173). The brokerage's public website forwards an enquiry it has already saved;
 * ASAP files the visitor as a client (or finds them) and opens one Work item for a person.
 *
 * Who may call: only a server holding `WEBSITE_INTAKE_KEY`. It is never a browser, so CORS is not
 * opened for it. Which brokerage: `WEBSITE_INTAKE_ORGANIZATION_ID`, the deployment's own setting —
 * the caller cannot name one (§45 rule 5). Without both settings the route is not mounted at all.
 *
 * What it does not do: price, choose insurers, or send anything. It is the same shape as an
 * Unsorted email (D-144): a `kind: inbound` Work item that says what arrived and what a person
 * should do next. The quotation, claim or change is then opened through its own governed path.
 *
 * Idempotent on the website's reference: the second delivery of the same enquiry finds the first
 * Work item and creates nothing (a unique index on source + reason backs this, 0055).
 */
export const WEBSITE_SOURCE_TYPE = "website_enquiry";

const REASON_CODES: Record<WebsiteEnquiryKind, string> = {
  quote: "website_quote",
  claim: "website_claim",
  policy_change: "website_policy_change",
  renewal: "website_renewal",
  other: "website_enquiry",
};

const NEXT_ACTION: Record<WebsiteEnquiryKind, (name: string, cls: string | null) => string> = {
  quote: (n, cls) => `Start the ${cls ? `${cls} ` : ""}quotation for ${n}`,
  claim: (n) => `Open the claim for ${n} and ask for the claim documents`,
  policy_change: (n) => `Open the policy change for ${n}`,
  renewal: (n) => `Open the renewal for ${n}`,
  other: (n) => `Reply to ${n}`,
};

/**
 * The enquiry's source id: a UUID derived from the brokerage and the website's reference, so the
 * same reference always lands on the same Work item and two brokerages' references never collide.
 */
export function enquirySourceId(organizationId: string, reference: string): string {
  const h = createHash("sha256").update(`website:${organizationId}:${reference.toUpperCase()}`).digest("hex");
  // Shaped as a version-4 / variant-1 UUID so it satisfies any uuid parser.
  const v = ((parseInt(h.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${v}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Kenyan numbers arrive as 07…, 7…, 254… or +254…; compare them in one form. */
export function normalizePhone(input: string): string {
  const d = input.replace(/[^0-9]/g, "");
  if (d.startsWith("254")) return `+${d}`;
  if (d.startsWith("0")) return `+254${d.slice(1)}`;
  if (d.length === 9 && d.startsWith("7")) return `+254${d}`;
  return `+${d}`;
}

const label = (k: string) => k.replace(/[_-]+/g, " ").replace(/^./, (c) => c.toUpperCase());
const shown = (v: string | number | boolean | null) =>
  v === null ? "—" : typeof v === "boolean" ? (v ? "Yes" : "No") : typeof v === "number" ? v.toLocaleString("en-KE") : v;

/** What the person reads on the Work item: who, what they asked, and where they came from. */
export function enquiryReason(e: WebsiteEnquiry): string {
  const lines = [
    `Website ${WEBSITE_ENQUIRY_LABELS[e.kind]} ${e.reference} from ${e.contact.name} (${[e.contact.phone, e.contact.email].filter(Boolean).join(", ")}).`,
    ...Object.entries(e.details).map(([k, v]) => `${label(k)}: ${shown(v)}`),
  ];
  if (e.notes) lines.push(`Notes: ${e.notes}`);
  const campaign = [e.source.utmSource, e.source.utmCampaign, e.source.utmContent].filter(Boolean).join(" / ");
  if (campaign) lines.push(`Came from: ${campaign}`);
  return lines.join("\n").slice(0, 4000);
}

export function websiteIntakeRoutes(deps: {
  logger: Logger;
  service: () => SupabaseClient;
  intakeKey: string;
  organizationId: string;
}) {
  const app = new Hono();
  const expected = createHash("sha256").update(deps.intakeKey).digest();

  app.post("/intake/website", async (c) => {
    const offered = c.req.header("x-asap-intake-key") ?? "";
    // Compared as hashes: equal length always, so the timing says nothing about the key.
    if (!timingSafeEqual(createHash("sha256").update(offered).digest(), expected)) {
      throw new HttpError(401, "not_website", "This endpoint is reachable only by the brokerage's website.");
    }
    const e = await parseBody(c, websiteEnquirySchema);
    const db = deps.service();
    const org = deps.organizationId;
    const sourceId = enquirySourceId(org, e.reference);
    const reasonCode = REASON_CODES[e.kind];

    /* A second delivery of the same reference: hand back what the first one made. */
    const seen = await db
      .from("work_items")
      .select("id, client_id")
      .eq("organization_id", org)
      .eq("source_type", WEBSITE_SOURCE_TYPE)
      .eq("source_id", sourceId)
      .limit(1)
      .maybeSingle();
    if (seen.error) return sendError(c, mapDatabaseError(seen.error));
    if (seen.data) {
      const row = seen.data as { id: string; client_id: string };
      return c.json(websiteEnquiryResponseSchema.parse({ workItemId: row.id, clientId: row.client_id, existingClient: true, duplicate: true }));
    }

    const { clientId, existing } = await findOrFileClient(db, org, e);

    const cls = e.classOfBusiness;
    const title = `Website ${WEBSITE_ENQUIRY_LABELS[e.kind]} — ${e.contact.name}${cls ? `, ${cls}` : ""}`.slice(0, 200);
    const inserted = await db
      .from("work_items")
      .insert({
        organization_id: org,
        title,
        kind: "inbound",
        task_status: "needs_you",
        steps: [],
        client_id: clientId,
        class_of_business: cls,
        source_type: WEBSITE_SOURCE_TYPE,
        source_id: sourceId,
        reason_code: reasonCode,
        required_action: NEXT_ACTION[e.kind](e.contact.name, cls),
        reason: enquiryReason(e),
      })
      .select("id")
      .maybeSingle();
    let workItemId = (inserted.data as { id: string } | null)?.id ?? null;
    if (!workItemId) {
      /* Another delivery of the same reference won the race; the unique index refused this one. */
      const again = await db.from("work_items").select("id").eq("organization_id", org).eq("source_type", WEBSITE_SOURCE_TYPE).eq("source_id", sourceId).limit(1).maybeSingle();
      workItemId = (again.data as { id: string } | null)?.id ?? null;
      if (!workItemId) return sendError(c, mapDatabaseError(inserted.error ?? { message: "work item not created" }));
      return c.json(websiteEnquiryResponseSchema.parse({ workItemId, clientId, existingClient: existing, duplicate: true }));
    }

    await db.from("audit_log").insert({
      organization_id: org,
      actor_type: "automation",
      action: "website.enquiry_received",
      object_type: "work_item",
      object_id: workItemId,
      result: "success",
      new_state: {
        reference: e.reference,
        kind: e.kind,
        classOfBusiness: cls,
        clientId,
        existingClient: existing,
        consentAt: e.consentAt,
        source: e.source,
      },
    });
    deps.logger.info({ kind: e.kind, existing_client: existing }, "website enquiry filed");

    return c.json(websiteEnquiryResponseSchema.parse({ workItemId, clientId, existingClient: existing, duplicate: false }), 201);
  });

  return app;
}

/**
 * The visitor as a client. Matched by email, then by phone, against the brokerage's contacts — a
 * returning client's enquiry lands on their file. Otherwise a new client is filed, which lands
 * `not_started` like every client (0026), so nothing is placed for them until their file is done.
 */
async function findOrFileClient(db: SupabaseClient, org: string, e: WebsiteEnquiry): Promise<{ clientId: string; existing: boolean }> {
  const byEmail = !e.contact.email ? { data: null } : await db
    .from("client_contacts")
    .select("client_id")
    .eq("organization_id", org)
    // Exact, case-insensitive: the address's own % and _ are escaped so they match only themselves.
    .ilike("email", e.contact.email.replace(/[\\%_]/g, "\\$&"))
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();
  const emailMatch = (byEmail.data as { client_id: string } | null)?.client_id;
  if (emailMatch) return { clientId: emailMatch, existing: true };

  const phone = normalizePhone(e.contact.phone);
  const byPhone = await db
    .from("client_contacts")
    .select("client_id, phone")
    .eq("organization_id", org)
    .is("deleted_at", null)
    .limit(2000);
  const phoneMatch = ((byPhone.data ?? []) as { client_id: string; phone: string | null }[]).find((r) => r.phone && normalizePhone(r.phone) === phone);
  if (phoneMatch) return { clientId: phoneMatch.client_id, existing: true };

  /* Client names are unique per brokerage. Two different people called Jane Wanjiru are kept apart. */
  const names = [e.contact.name, `${e.contact.name} (${phone})`, ...(e.contact.email ? [`${e.contact.name} (${e.contact.email})`] : [])];
  let clientId: string | null = null;
  let lastError: { code?: string; message?: string } | null = null;
  for (const name of names) {
    const r = await db.from("clients").insert({ organization_id: org, name, kind: "individual", source: "manual" }).select("id").maybeSingle();
    if (r.data) {
      clientId = (r.data as { id: string }).id;
      break;
    }
    lastError = r.error;
    if (r.error && r.error.code !== "23505") break;
  }
  if (!clientId) throw mapDatabaseError(lastError ?? { message: "client not filed" });

  await db.from("client_contacts").insert({
    organization_id: org,
    client_id: clientId,
    full_name: e.contact.name,
    email: e.contact.email,
    phone,
    is_primary: true,
    source: "manual",
    notes: `From the website enquiry ${e.reference}.`,
  });
  await db.from("audit_log").insert({
    organization_id: org,
    actor_type: "automation",
    action: "client.created",
    object_type: "client",
    object_id: clientId,
    result: "success",
    new_state: { source: "website", reference: e.reference },
  });
  return { clientId, existing: false };
}
