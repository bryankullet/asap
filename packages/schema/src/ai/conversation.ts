import { z } from "zod";
import { uuidSchema } from "../api/common.js";
import { SpaceView } from "../spaces/plan.js";
import { UiIntent } from "../intent.js";

/**
 * Ask ASAP's conversation model.
 *
 * A conversation belongs to one brokerage and one person, and carries a *scope*: the brokerage,
 * one client, or one record. That scope is what "context" means here — it is resolved server-side
 * from ids the caller can already read, never from something a model asserted.
 *
 * Architecture §45 rule 14: chat history is not the database. Nothing in a conversation is a
 * business fact. Every value a person sees is read from a record by id at render time; the
 * messages are a transcript of asking, not a store of answers.
 */
export const AskScopeKind = z.enum(["brokerage", "client", "record"]);
export type AskScopeKind = z.infer<typeof AskScopeKind>;

export const askScopeSchema = z.object({
  kind: AskScopeKind,
  /** Null for a brokerage-wide conversation; otherwise the client or record it is about. */
  id: uuidSchema.nullable(),
  /** What a person sees on the context chip. Read from the row, never composed by a model. */
  label: z.string().min(1).max(200),
});
export type AskScope = z.infer<typeof askScopeSchema>;

export const ConversationMessageRole = z.enum(["person", "asap"]);

/**
 * One turn. An `asap` turn carries what was said, the intent it resolved to, the tools it ran and
 * the citations behind any fact it named — so an answer can always be checked against its sources.
 */
export const conversationMessageSchema = z.object({
  id: uuidSchema,
  conversation_id: uuidSchema,
  organization_id: uuidSchema,
  seq: z.number().int(),
  role: ConversationMessageRole,
  body: z.string(),
  /** The resolved intent for an `asap` turn. Validated server-side before it was stored. */
  intent: UiIntent.nullable(),
  /** Which declared tools ran, and against what. Never free-form SQL; never a write. */
  tools_used: z
    .array(z.object({ name: z.string(), arguments: z.record(z.string(), z.unknown()) }))
    .default([]),
  /** Where each named fact came from. An answer with no citation is an abstention, not a claim. */
  citations: z
    .array(
      z.object({
        label: z.string(),
        /** The record the fact was read from, so it can be opened. */
        recordId: uuidSchema.nullable(),
        recordKind: z.string(),
        reference: z.string().nullable(),
        /** Page and region arrive with extraction; null until then, and said to be null. */
        page: z.number().int().nullable(),
      }),
    )
    .default([]),
  /** Null when a person asked; set when ASAP could not answer, and why. */
  abstained: z
    .object({ reason: z.string(), missing: z.array(z.string()).max(10) })
    .nullable()
    .default(null),
  /** Which provider and model produced it, for the evaluation set and the audit row. */
  served_by: z.string().nullable(),
  created_at: z.string(),
});
export type ConversationMessage = z.infer<typeof conversationMessageSchema>;

export const conversationSchema = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  created_by: uuidSchema,
  title: z.string(),
  scope_kind: AskScopeKind,
  scope_id: uuidSchema.nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Conversation = z.infer<typeof conversationSchema>;

export const CONVERSATION_COLUMNS =
  "id, organization_id, created_by, title, scope_kind, scope_id, created_at, updated_at";
export const CONVERSATION_MESSAGE_COLUMNS =
  "id, conversation_id, organization_id, seq, role, body, intent, tools_used, citations, abstained, served_by, created_at";

/** `POST /ask` — one question, in a conversation, in a scope. */
export const askRequestSchema = z.object({
  question: z.string().trim().min(1).max(1000),
  /** Continue a conversation, or start one when null. */
  conversationId: uuidSchema.nullable().default(null),
  scope: z
    .object({ kind: AskScopeKind, id: uuidSchema.nullable() })
    .default({ kind: "brokerage", id: null }),
});
export type AskRequest = z.infer<typeof askRequestSchema>;

/**
 * What Ask returns. `answer` is what was said; `plan` is what to render, already validated against
 * the component registry; `suggestions` are follow-ups a person can click.
 *
 * `state` is the honest part. `answered` means a grounded answer. `abstained` means the evidence
 * was not there and Ask said so. `not_configured` means no model is configured on the server —
 * shown as a configuration state, never as "nothing found".
 */
export const askStateSchema = z.enum([
  "answered",
  "abstained",
  "clarify",
  "not_configured",
  "unavailable",
]);
export type AskState = z.infer<typeof askStateSchema>;

export const askResponseV2Schema = z.object({
  state: askStateSchema,
  conversationId: uuidSchema.nullable(),
  scope: askScopeSchema,
  message: conversationMessageSchema.nullable(),
  /** A validated Space plan when the answer is a workspace rather than a sentence. */
  planRecordId: uuidSchema.nullable(),
  planView: SpaceView.nullable(),
  /** When `state` is `clarify`: what is ambiguous and the choices, read from real rows. */
  clarify: z
    .object({
      question: z.string(),
      options: z
        .array(z.object({ id: uuidSchema, label: z.string(), hint: z.string().nullable() }))
        .max(8),
    })
    .nullable()
    .default(null),
  suggestions: z.array(z.string().max(120)).max(4).default([]),
});
export type AskResponseV2 = z.infer<typeof askResponseV2Schema>;
