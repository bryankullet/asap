import type { AiProvider } from "@asap/schema";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Logger } from "pino";
import { z } from "zod";

/**
 * The exception helper (D-146): when a run could not finish, ASAP looks into why and writes ONE
 * suggested fix with the evidence it rests on — a proposal on the exception, which a person
 * accepts or rejects.
 *
 * What it reads, it reads only from the run's own brokerage: every query below filters on the
 * run's organization. The declared Ask tools are not used here because they rely on a person's
 * session for tenancy (RLS); on the engine's connection they would read across brokerages, which
 * §45 rule 1 forbids. The model sees only the evidence gathered here and may only point at it.
 *
 * Accepting can do one thing from a fixed list — record an insurer address that appeared in the
 * brokerage's own correspondence — through the person's ordinary path, as the person. With no model
 * configured, nothing is written and the exception shows as it always has.
 */
export type Evidence = { ref: string; label: string; detail: string };

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const reply = z.object({
  suggestion: z.string().min(10).max(600),
  evidence: z.array(z.string()).max(5),
  action: z.object({ type: z.literal("record_insurer_contact"), email: z.string().email() }).nullable(),
  confidence: z.number().min(0).max(1),
});

function firstJson(text: string): unknown {
  const s = text.indexOf("{");
  const e = text.lastIndexOf("}");
  if (s < 0 || e <= s) return null;
  try {
    return JSON.parse(text.slice(s, e + 1));
  } catch {
    return null;
  }
}

/** What ASAP can show a person about why this run stopped, from the run's own brokerage only. */
export async function gatherEvidence(db: SupabaseClient, organizationId: string, runId: string): Promise<{ evidence: Evidence[]; insurer: { id: string; name: string } | null; exception: { code: string; message: string; needs?: string } | null; workflow: string }> {
  const r = await db.from("workflow_runs").select("workflow, current_step, exception, facts, organization_id").eq("id", runId).eq("organization_id", organizationId).maybeSingle();
  const run = r.data as { workflow: string; current_step: string | null; exception: { code: string; message: string; needs?: string } | null; facts: Record<string, unknown> } | null;
  if (!run) return { evidence: [], insurer: null, exception: null, workflow: "" };
  const evidence: Evidence[] = [{ ref: "run", label: `The ${run.workflow} run stopped at ${run.current_step ?? "a step"}`, detail: `${run.exception?.message ?? ""} ${run.exception?.needs ?? ""}`.trim() }];
  const partyName = typeof run.facts["withParty"] === "string" ? (run.facts["withParty"] as string) : null;
  let insurer: { id: string; name: string } | null = null;
  if (partyName) {
    const i = await db.from("insurers").select("id, name").eq("organization_id", organizationId).eq("name", partyName).is("deleted_at", null).maybeSingle();
    insurer = (i.data as { id: string; name: string } | null) ?? null;
  }
  if (insurer) {
    const c = await db.from("insurer_contacts").select("email").eq("organization_id", organizationId).eq("insurer_id", insurer.id).is("retired_at", null);
    const verified = ((c.data ?? []) as { email: string }[]).map((x) => x.email);
    evidence.push({ ref: "verified_addresses", label: `Verified addresses for ${insurer.name}`, detail: verified.length ? verified.join(", ") : "None on file" });
    // Addresses that wrote to this brokerage mentioning the insurer — candidates only, never trusted until a person records one.
    const m = await db.from("email_messages").select("id, from_address, subject, sent_at").eq("organization_id", organizationId).eq("direction", "inbound").ilike("body_text", `%${insurer.name.split(" ")[0]}%`).order("sent_at", { ascending: false }).limit(20);
    const seen = new Map<string, { id: string; subject: string; sent_at: string }>();
    for (const x of (m.data ?? []) as { id: string; from_address: string; subject: string; sent_at: string }[]) {
      const domain = x.from_address.split("@")[1] ?? "";
      if (!verified.includes(x.from_address) && !/gmail|yahoo|outlook|hotmail/.test(domain) && !seen.has(x.from_address)) seen.set(x.from_address, x);
    }
    for (const [address, x] of [...seen.entries()].slice(0, 3)) evidence.push({ ref: `email:${x.id}`, label: `${address} wrote about ${insurer.name}`, detail: `“${x.subject}”, ${x.sent_at.slice(0, 10)}` });
  }
  return { evidence, insurer, exception: run.exception, workflow: run.workflow };
}

export async function suggestFix(db: SupabaseClient, provider: AiProvider | null, logger: Logger, event: { id: string; organization_id: string; entity_id: string | null }): Promise<"suggested" | "none" | "already"> {
  if (!provider || !event.entity_id) return "none";
  const existing = await db.from("exception_suggestions").select("id").eq("event_id", event.id).maybeSingle();
  if (existing.data) return "already";
  const g = await gatherEvidence(db, event.organization_id, event.entity_id);
  if (!g.exception) return "none";
  let parsed: z.infer<typeof reply> | null = null;
  let model: string;
  try {
    const res = await provider.complete({
      system: [
        "A piece of work at a Kenyan insurance brokerage stopped and needs a person. Suggest ONE fix, in one or two plain sentences.",
        "Use only the evidence given. Cite it by its ref. Never decide or suggest a claim or coverage decision.",
        "If the fix is to record an insurer's address that appears in the evidence, set action to {\"type\":\"record_insurer_contact\",\"email\":…}; otherwise null.",
        "Reply with JSON only: {\"suggestion\": …, \"evidence\": [refs], \"action\": … or null, \"confidence\": 0 to 1}.",
      ].join("\n"),
      messages: [{ role: "user", content: JSON.stringify({ exception: g.exception, workflow: g.workflow, evidence: g.evidence }) }],
      tools: [],
      responseSchema: null,
      maxOutputTokens: 400,
    });
    model = `${res.servedBy.provider}:${res.servedBy.model}`;
    const p = reply.safeParse(firstJson(res.text));
    parsed = p.success ? p.data : null;
  } catch (err) {
    logger.warn({ err }, "exception helper: the model could not be asked; the exception shows as it is");
    return "none";
  }
  if (!parsed) return "none";
  // Code decides: cited evidence must exist; a proposed address must be one the evidence shows.
  const cited = g.evidence.filter((e) => parsed!.evidence.includes(e.ref));
  const shown = new Set(g.evidence.flatMap((e) => `${e.label} ${e.detail}`.match(EMAIL) ?? []).map((a) => a.toLowerCase()));
  const action = parsed.action && g.insurer && shown.has(parsed.action.email.toLowerCase()) ? { type: "record_insurer_contact", insurerId: g.insurer.id, insurerName: g.insurer.name, email: parsed.action.email.toLowerCase() } : null;
  const ins = await db.from("exception_suggestions").insert({
    organization_id: event.organization_id, run_id: event.entity_id, event_id: event.id, exception_code: g.exception.code,
    suggestion: parsed.suggestion, evidence: cited.length ? cited : g.evidence.slice(0, 1), action, confidence: parsed.confidence, model,
  });
  if (ins.error) return ins.error.code === "23505" ? "already" : "none";
  await db.from("audit_log").insert({ organization_id: event.organization_id, actor_type: "automation", action: "workflow.suggestion_proposed", object_type: "workflow_run", object_id: event.entity_id, new_state: { code: g.exception.code, action: action?.type ?? null } });
  return "suggested";
}
