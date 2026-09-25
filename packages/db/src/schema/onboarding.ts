import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { createdAt, timestamptz, updatedAt, uuidPrimaryKey } from "./_shared.js";
import { organizations } from "./organizations.js";
import { users } from "./users.js";

export const ONBOARDING_RECORDS_CHOICES = ["upload", "import", "skip"] as const;
export const ONBOARDING_MAILBOX_CHOICES = ["connect", "skip"] as const;

/**
 * Migration 0046. A person's first day.
 *
 * One row per person *per brokerage* — joining a second brokerage is a first day there too. A
 * skip is a recorded answer rather than an absence, which is what stops the product nagging
 * somebody who already decided. Completion is a timestamp, so nobody is walked through it twice.
 *
 * Its policies are narrower than the usual tenant ones: a person sees their own row and not a
 * colleague's, because whether a colleague has finished their first day is nobody else's business.
 */
export const userOnboarding = pgTable(
  "user_onboarding",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    step: integer("step").notNull().default(1),
    recordsChoice: text("records_choice"),
    mailboxChoice: text("mailbox_choice"),
    completedAt: timestamptz("completed_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("user_onboarding_organization_id_user_id_key").on(t.organizationId, t.userId),
    check("user_onboarding_step_check", sql`${t.step} between 1 and 4`),
    check(
      "user_onboarding_records_choice_check",
      sql`${t.recordsChoice} in ('upload','import','skip')`,
    ),
    check(
      "user_onboarding_mailbox_choice_check",
      sql`${t.mailboxChoice} in ('connect','skip')`,
    ),
    index("user_onboarding_organization_id_idx").on(t.organizationId),
    index("user_onboarding_user_id_idx").on(t.userId),
  ],
);

export type UserOnboarding = typeof userOnboarding.$inferSelect;
