import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { createdAt, deletedAt, updatedAt, uuidPrimaryKey } from "./_shared.js";
import { organizations } from "./organizations.js";
import { users } from "./users.js";

export const CONVERSATION_SCOPE_KINDS = ["brokerage", "client", "record"] as const;
export const CONVERSATION_ROLES = ["person", "asap"] as const;

/**
 * Migration 0032. Ask ASAP conversations.
 *
 * Chat history is not the database (§45 rule 14). These rows are the transcript of what was said,
 * kept so a conversation can be reopened and linked — never the system of record for a business
 * fact. Anything that matters is a row in its own table with its own audit trail.
 */
export const conversations = pgTable(
  "conversations",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    title: text("title").notNull(),
    /** A brokerage-wide conversation has no subject; any other scope names one. */
    scopeKind: text("scope_kind").notNull(),
    scopeId: uuid("scope_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    check("conversations_title_check", sql`length(btrim(${t.title})) > 0`),
    check(
      "conversations_scope_kind_check",
      sql`${t.scopeKind} in ('brokerage','client','record')`,
    ),
    check(
      "conversations_scope_id_matches_kind",
      sql`(${t.scopeKind} = 'brokerage' and ${t.scopeId} is null)
          or (${t.scopeKind} <> 'brokerage' and ${t.scopeId} is not null)`,
    ),
    index("conversations_organization_id_updated_at_idx").on(t.organizationId, t.updatedAt.desc()),
    index("conversations_scope_idx").on(t.organizationId, t.scopeKind, t.scopeId),
    index("conversations_created_by_idx").on(t.createdBy),
  ],
);

/**
 * One turn. `seq` is unique per conversation, so a replayed request cannot interleave a turn.
 *
 * A person's turn is plain text and nothing else: the intent envelope, the abstention, the tools
 * and the citations all belong to what ASAP answered, and the constraint refuses a row that
 * attributes any of them to a person.
 */
export const conversationMessages = pgTable(
  "conversation_messages",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    role: text("role").notNull(),
    body: text("body").notNull(),
    /** The validated result envelope, never markup and never a business value. */
    intent: jsonb("intent"),
    toolsUsed: jsonb("tools_used")
      .notNull()
      .default(sql`'[]'::jsonb`),
    citations: jsonb("citations")
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** Abstention is a state, not a blank (§36). */
    abstained: jsonb("abstained"),
    /** Which model answered, for the evaluation record. */
    servedBy: text("served_by"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("conversation_messages_conversation_id_seq_key").on(t.conversationId, t.seq),
    check("conversation_messages_seq_check", sql`${t.seq} >= 1`),
    check("conversation_messages_role_check", sql`${t.role} in ('person','asap')`),
    check(
      "conversation_messages_person_turn_is_plain",
      sql`${t.role} <> 'person'
          or (${t.intent} is null and ${t.abstained} is null
              and ${t.toolsUsed} = '[]'::jsonb and ${t.citations} = '[]'::jsonb)`,
    ),
    index("conversation_messages_conversation_id_seq_idx").on(t.conversationId, t.seq),
    index("conversation_messages_organization_id_idx").on(t.organizationId),
  ],
);

export type Conversation = typeof conversations.$inferSelect;
export type ConversationMessage = typeof conversationMessages.$inferSelect;
