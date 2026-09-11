import { z } from "zod";
import { uuidSchema } from "./common.js";

/**
 * The people at a client (D-070).
 *
 * A client had a name and nothing else until 0039. These are the people a brokerage actually
 * deals with — and the reason an arriving email can be attached to the client it concerns rather
 * than sitting in a list nobody has connected to anything.
 *
 * A contact is not a user. Nobody here can sign in, hold a role or see anything: these are the
 * client's people, recorded by the brokerage, and they exist only as records.
 */
export const clientContactSchema = z.object({
  id: uuidSchema,
  clientId: uuidSchema,
  fullName: z.string(),
  /** What this person is to the client, in the brokerage's own words. Never an enum. */
  roleLabel: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  /** Who the brokerage writes to by default. Exactly one per client, held by the database. */
  isPrimary: z.boolean(),
  source: z.enum(["manual", "import", "email", "seed"]),
  notes: z.string().nullable(),
  createdAt: z.string(),
});
export type ClientContact = z.infer<typeof clientContactSchema>;

export const contactsResponseSchema = z.object({ contacts: z.array(clientContactSchema) });
export type ContactsResponse = z.infer<typeof contactsResponseSchema>;

/**
 * A contact as somebody types it.
 *
 * `email` is optional because a real one often has only a phone number, and refusing to record
 * the person until an address exists loses the person. What it will not accept is something that
 * is not an address at all in the address field — that is how "n/a" ends up being emailed.
 */
export const createContactRequestSchema = z.object({
  clientId: uuidSchema,
  fullName: z.string().trim().min(1).max(200),
  roleLabel: z.string().trim().max(120).nullable().default(null),
  email: z
    .string()
    .trim()
    .max(320)
    .refine((v) => v === "" || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), {
      message: "That does not look like an email address",
    })
    .nullable()
    .default(null),
  phone: z.string().trim().max(40).nullable().default(null),
  isPrimary: z.boolean().default(false),
  notes: z.string().trim().max(2000).nullable().default(null),
});
export type CreateContactRequest = z.input<typeof createContactRequestSchema>;

export const updateContactRequestSchema = createContactRequestSchema
  .omit({ clientId: true })
  .partial();
export type UpdateContactRequest = z.input<typeof updateContactRequestSchema>;

export const contactResponseSchema = z.object({ contact: clientContactSchema });
export type ContactResponse = z.infer<typeof contactResponseSchema>;

export const CLIENT_CONTACT_COLUMNS =
  "id, organization_id, client_id, full_name, role_label, email, phone, is_primary, source, notes, created_by, created_at, updated_at, deleted_at";
