import type { ActRequest, ActResponse, DraftRow, Step, WorkItemRow } from "@asap/schema";
import { Button, Field, Input, Notice } from "@asap/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { api, describeApiError } from "../../lib/api.js";
import { useMe } from "../../lib/me.js";
import { DraftCard } from "../drafts/DraftCard.js";

type ExceptionKind = NonNullable<ActRequest["exceptionKind"]>;

/**
 * The buttons on a record are exactly the step's actions (Part 5.2: nothing else is a button).
 * A guard that fails is shown as a reason, not a refusal (Screen Map v3 Part 7 check 7).
 */
export function ActionPanel({
  item,
  step,
  drafts,
  onRunStarted,
  hideDrafts = false,
  candidatePeriods = [],
}: {
  item: WorkItemRow;
  step: Step;
  drafts: DraftRow[];
  onRunStarted: (runId: string) => void;
  /** Part 14: the record page renders drafts as their own section below the focus card. */
  hideDrafts?: boolean;
  candidatePeriods?: {
    period: { id: string; period_start: string; period_end: string };
    policy: { class_of_business: string; policy_number: string | null };
    insurerName: string;
  }[];
}) {
  const qc = useQueryClient();
  const me = useMe();
  const isPrincipal =
    me.data?.memberships.find((m) => m.organization.id === me.data?.active_organization?.id)?.role
      .key === "brokerage_admin";
  const [blocked, setBlocked] = useState<{ guard: string; reason: string } | null>(null);
  const [form, setForm] = useState<ActRequest["verb"] | null>(null);
  const [evidence, setEvidence] = useState("");
  const [party, setParty] = useState("");
  const [exceptionKind, setExceptionKind] = useState<ExceptionKind>("lapse");
  const [reason, setReason] = useState("");
  const [told, setTold] = useState("");
  const [override, setOverride] = useState("");
  const [inception, setInception] = useState("");
  const [periodId, setPeriodId] = useState(
    // One candidate is not a choice: preselect it so the only possible answer is not a question.
    candidatePeriods.length === 1 ? candidatePeriods[0]!.period.id : "",
  );
  const [evidenceKind, setEvidenceKind] = useState<"document" | "call_note">("document");

  const act = useMutation({
    mutationFn: (input: ActRequest) => api.act(item.id, input),
    onSuccess: (res: ActResponse) => {
      if (res.outcome === "blocked") {
        setBlocked({ guard: res.guard, reason: res.reason });
        return;
      }
      setBlocked(null);
      setForm(null);
      setEvidence("");
      void qc.invalidateQueries({ queryKey: ["work_item_full", item.id] });
      void qc.invalidateQueries({ queryKey: ["work_items"] });
      void qc.invalidateQueries({ queryKey: ["runs"] });
      if (res.run) onRunStarted(res.run.id);
    },
  });

  const base = (verb: ActRequest["verb"]): ActRequest => ({
    stepId: step.id,
    verb,
    version: item.version,
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    if (form === "exception") {
      act.mutate({
        ...base("exception"),
        exceptionKind,
        reason,
        clientToldEvidence: told || undefined,
      });
    } else {
      act.mutate({
        ...base(form),
        evidence,
        party: party || undefined,
        inceptionAt:
          step.id === "cover_confirmed" && inception
            ? new Date(inception).toISOString()
            : undefined,
        // The claim match step cannot be satisfied without it: apply.ts requires the period a
        // person chose, and the guard re-checks that it contains the incident date.
        policyPeriodId: needsPeriod && periodId ? periodId : undefined,
        evidenceKind:
          item.kind === "claim" && step.id === "response" && form === "record_evidence"
            ? evidenceKind
            : undefined,
      });
    }
  }

  const stepDrafts = drafts.filter((d) => d.step_id === step.id);
  /** The claim match step is the one place a policy period is chosen; the select is required there. */
  const needsPeriod = item.kind === "claim" && step.id === "match";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {step.actions.map((a) => (
          <Button
            key={a.verb}
            variant={a.verb === "prepare" ? "green" : "outline"}
            size="compact"
            disabled={act.isPending || a.disabledReason !== null}
            title={a.disabledReason ?? undefined}
            onClick={() => {
              setBlocked(null);
              if (a.verb === "prepare" || a.verb === "draft" || a.verb === "complete")
                act.mutate(base(a.verb));
              else setForm(a.verb);
            }}
          >
            {a.label}
          </Button>
        ))}
      </div>

      {blocked && (
        <Notice tone="waiting">
          <strong>Not yet:</strong> {blocked.reason}
          {blocked.guard === "client_file_cleared" && item.client_id && (
            <>
              {" "}
              <Link
                to="/files/$clientId"
                params={{ clientId: item.client_id }}
                className="underline"
              >
                Open the client's file
              </Link>
            </>
          )}
        </Notice>
      )}
      {blocked?.guard === "client_file_cleared" && me.data?.active_organization && isPrincipal && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            act.mutate({ ...base("approve"), override: { reason: override } });
          }}
          className="flex flex-col gap-3 rounded-card border border-accent-red/25 bg-accent-red-soft p-4"
        >
          <p className="text-sm text-ink">
            Principal-officer override. It is audited permanently and lands on your Today.
          </p>
          <Field label="Reason, in your words" htmlFor="override">
            <Input id="override" value={override} onChange={(e) => setOverride(e.target.value)} />
          </Field>
          <Button
            type="submit"
            variant="destructive"
            size="compact"
            disabled={act.isPending || !override.trim()}
          >
            Approve anyway
          </Button>
        </form>
      )}
      {act.isError && <Notice tone="error">{describeApiError(act.error)}</Notice>}

      {form && form !== "exception" && (
        <form
          onSubmit={submit}
          className="flex flex-col gap-3 rounded-card border border-line-strong bg-wash p-4"
        >
          <Field label={step.evidence[0]?.label ?? "What are you relying on?"} htmlFor="evidence">
            <Input
              id="evidence"
              value={evidence}
              onChange={(e) => setEvidence(e.target.value)}
              placeholder="Message id, sent-folder reference, document name"
            />
          </Field>
          {needsPeriod && form === "record_evidence" && (
            <Field
              label={
                candidatePeriods.length > 1
                  ? `${candidatePeriods.length} policy periods contain the incident date — choose which`
                  : "Policy period"
              }
              htmlFor="period"
            >
              {candidatePeriods.length === 0 ? (
                <p className="text-sm text-ink-secondary">
                  No policy period on file contains the incident date. Add the policy first.
                </p>
              ) : (
                <select
                  id="period"
                  required
                  className="rounded-control border border-line-strong bg-paper px-3 py-2 text-sm"
                  value={periodId}
                  onChange={(e) => setPeriodId(e.target.value)}
                >
                  <option value="">Choose…</option>
                  {candidatePeriods.map((p) => (
                    <option key={p.period.id} value={p.period.id}>
                      {p.policy.class_of_business} with {p.insurerName}
                      {p.policy.policy_number ? ` (${p.policy.policy_number})` : ""} ·{" "}
                      {p.period.period_start} to {p.period.period_end}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}
          {item.kind === "claim" && step.id === "response" && form === "record_evidence" && (
            <Field label="What is this?" htmlFor="evidenceKind">
              <select
                id="evidenceKind"
                className="rounded-control border border-line-strong bg-paper px-3 py-2 text-sm"
                value={evidenceKind}
                onChange={(e) => setEvidenceKind(e.target.value as typeof evidenceKind)}
              >
                <option value="document">Their email or letter</option>
                <option value="call_note">
                  A call note (ours — cannot stand in for their words)
                </option>
              </select>
            </Field>
          )}
          {step.id === "cover_confirmed" && form === "record_evidence" && (
            <Field
              label="Inception date (cover becomes Active cover from this date, by date)"
              htmlFor="inception"
            >
              <Input
                id="inception"
                type="date"
                value={inception}
                onChange={(e) => setInception(e.target.value)}
              />
            </Field>
          )}
          {form === "record_send" && (
            <Field label="Sent to" htmlFor="party">
              <Input
                id="party"
                value={party}
                onChange={(e) => setParty(e.target.value)}
                placeholder={step.party ?? "Who received it"}
              />
            </Field>
          )}
          <div className="flex gap-2">
            <Button type="submit" variant="accent" size="compact" disabled={act.isPending}>
              Record
            </Button>
            <Button type="button" variant="ghost" size="compact" onClick={() => setForm(null)}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {form === "exception" && (
        <form
          onSubmit={submit}
          className="flex flex-col gap-3 rounded-card border border-line-strong bg-wash p-4"
        >
          <Field label="What happened" htmlFor="kind">
            <select
              id="kind"
              className="rounded-control border border-line-strong bg-paper px-3 py-2 text-sm"
              value={exceptionKind}
              onChange={(e) => setExceptionKind(e.target.value as ExceptionKind)}
            >
              <option value="lapse">Lapse — no instruction by the period end</option>
              <option value="loss">Lost to another broker</option>
              <option value="cancellation">Cancelled</option>
              <option value="no_bid">No insurer would quote</option>
              <option value="complaint">Complaint</option>
            </select>
          </Field>
          <Field label="Reason, in your words" htmlFor="reason">
            <Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          {exceptionKind === "lapse" && (
            <Field label="Where is the record that the client was told in writing?" htmlFor="told">
              <Input id="told" value={told} onChange={(e) => setTold(e.target.value)} />
            </Field>
          )}
          <div className="flex gap-2">
            <Button type="submit" variant="accent" size="compact" disabled={act.isPending}>
              Record
            </Button>
            <Button type="button" variant="ghost" size="compact" onClick={() => setForm(null)}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {!hideDrafts &&
        stepDrafts.map((d) => <DraftCard key={d.id} draft={d} item={item} step={step} />)}
    </div>
  );
}
