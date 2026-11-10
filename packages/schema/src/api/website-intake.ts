import { z } from "zod";

/**
 * Website intake (D-173): what the brokerage's public website hands ASAP when a visitor asks for
 * something — a quote, a claim, a change to a policy, a renewal, or anything else.
 *
 * The website is not a browser session. It is a server (the landing site's own back end) that
 * already saved the enquiry, emailed the visitor and told the brokerage's staff. It forwards the
 * enquiry here, server to server, with a shared secret, so the brokerage sees it as Work in ASAP.
 *
 * Deliberately absent: an organization id. The brokerage is the deployment's configuration, never
 * something a caller names (§45 rule 5). Also absent: KRA PIN, ID and policy numbers. The website
 * keeps those; ASAP gets the contact and what the visitor wants, and a person collects the rest
 * through the client file, where the brokerage's due-diligence rules apply.
 */
export const WEBSITE_ENQUIRY_KINDS = ["quote", "claim", "policy_change", "renewal", "other"] as const;
export type WebsiteEnquiryKind = (typeof WEBSITE_ENQUIRY_KINDS)[number];

/** How a work item says what a website enquiry is, in the brokerage's own words. */
export const WEBSITE_ENQUIRY_LABELS: Record<WebsiteEnquiryKind, string> = {
  quote: "quote request",
  claim: "claim",
  policy_change: "policy change",
  renewal: "renewal",
  other: "enquiry",
};

const text = (max: number) => z.string().trim().min(1).max(max);
/** A detail value the website reports. Flat on purpose: ASAP shows it, it does not interpret it. */
const detailValue = z.union([z.string().trim().max(500), z.number().finite(), z.boolean(), z.null()]);

export const websiteEnquirySchema = z
  .object({
    /** The website's own reference, e.g. "ASAP-MTR-20261110-AB12CD". The idempotency key. */
    reference: z
      .string()
      .trim()
      .min(6)
      .max(60)
      .regex(/^[A-Za-z0-9][A-Za-z0-9_-]+$/, "A reference is letters, digits, dashes and underscores"),
    kind: z.enum(WEBSITE_ENQUIRY_KINDS),
    /** "motor", "health", "travel", … — the website's words, shown as the class of business. */
    classOfBusiness: z.string().trim().min(3).max(100).nullable().default(null),
    contact: z.object({
      name: text(120),
      /** Optional: the fast lane asks for a phone number only. */
      email: z.string().trim().toLowerCase().email().max(160).nullable().default(null),
      phone: z.string().trim().min(7).max(30),
    }),
    /** What the visitor told the website, as label → value. Shown on the work item, verbatim. */
    details: z
      .record(z.string().trim().min(1).max(60), detailValue)
      .refine((d) => Object.keys(d).length <= 30, "At most 30 details")
      .default({}),
    notes: z.string().trim().max(2000).nullable().default(null),
    /** When the visitor agreed to be contacted. Required: no consent, no record. */
    consentAt: z.iso.datetime({ offset: true }),
    /** Where they came from — the page and any campaign tags on the link (a reel, an ad). */
    source: z
      .object({
        page: z.string().trim().max(300).nullable().default(null),
        utmSource: z.string().trim().max(100).nullable().default(null),
        utmMedium: z.string().trim().max(100).nullable().default(null),
        utmCampaign: z.string().trim().max(100).nullable().default(null),
        utmContent: z.string().trim().max(100).nullable().default(null),
      })
      .partial()
      .default({}),
  })
  .strict();
export type WebsiteEnquiry = z.infer<typeof websiteEnquirySchema>;

export const websiteEnquiryResponseSchema = z.object({
  workItemId: z.string().uuid(),
  clientId: z.string().uuid(),
  /** True when the visitor was already a client (matched by email, then phone). */
  existingClient: z.boolean(),
  /** True when this reference had already been received: nothing new was created. */
  duplicate: z.boolean(),
});
export type WebsiteEnquiryResponse = z.infer<typeof websiteEnquiryResponseSchema>;
