import type { StepContext } from "./engine.js";

/**
 * Emails the inbound router filed to this run while it waits on this step (D-144), not yet dealt
 * with. A waiting step asks a person to record what arrived before it chases again: ASAP never
 * chases an insurer whose answer is sitting unread in the brokerage's own inbox.
 */
export type FiledEmail = { messageId: string; from: string; subject: string; at: string; kind: string | null; party: string | null; step: string | null; acknowledged: boolean };

export function filedEmails(ctx: StepContext, still: (e: FiledEmail) => boolean = () => true): FiledEmail[] {
  const all = (ctx.run.facts["inbound"] as FiledEmail[] | undefined) ?? [];
  return all.filter((e) => !e.acknowledged && e.step === ctx.step.step_key && still(e));
}

const human = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Nairobi" });

/** The Work for the oldest filed email, in the words a person acts on. */
export function recordFiledWork(e: FiledEmail, what: string): Record<string, unknown> {
  return {
    task_status: "needs_you", task_party: null, task_since: null,
    required_action: `Record ${what} from ${e.party ?? e.from} — it arrived ${human(e.at)}`,
    reason: `ASAP filed the email “${e.subject || "(no subject)"}” from ${e.from} here. It reads nothing into it: a person records what it says.`,
  };
}
