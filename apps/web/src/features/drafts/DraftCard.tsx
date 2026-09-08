import type { DraftRow, Step, WorkItemRow } from "@asap/schema";
import { Button, Card, Input, Notice } from "@asap/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, describeApiError } from "../../lib/api.js";
import { reviewSend } from "./draft.js";

/** A draft the person copies and sends themselves. "I sent this" needs a confirmation and evidence. */
export function DraftCard({
  draft,
  item,
  step,
}: {
  draft: DraftRow;
  item: WorkItemRow;
  step: Step;
}) {
  const qc = useQueryClient();
  const [review, setReview] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [evidence, setEvidence] = useState("");
  const [unknown, setUnknown] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["work_item_full", item.id] });
    void qc.invalidateQueries({ queryKey: ["work_items"] });
  };
  const copied = useMutation({
    mutationFn: async () => {
      await navigator.clipboard
        ?.writeText(`To: ${draft.to_address}\nSubject: ${draft.subject}\n\n${draft.body}`)
        .catch(() => undefined);
      return api.markDraftCopied(draft.id);
    },
    onSuccess: invalidate,
  });
  const send = useMutation({
    mutationFn: (input: { evidence: string; outcomeUnknown: boolean }) =>
      api.act(item.id, {
        stepId: step.id,
        verb: "record_send",
        version: item.version,
        evidence: input.evidence,
        party: draft.to_address,
        draftId: draft.id,
        outcomeUnknown: input.outcomeUnknown,
      }),
    onSuccess: (res) => {
      if (res.outcome === "blocked") {
        setError(res.reason);
        return;
      }
      setReview(false);
      invalidate();
    },
  });

  function save() {
    const decision = reviewSend(draft, { confirmed, evidence, outcomeUnknown: unknown });
    if (!decision.ok) {
      setError(decision.reason);
      return;
    }
    setError(null);
    send.mutate({ evidence: decision.evidence, outcomeUnknown: decision.outcomeUnknown });
  }

  return (
    <Card className="flex flex-col gap-2 border border-line-soft p-4">
      <p className="text-xs text-ink-muted">Draft to {draft.to_address || "—"}</p>
      <p className="text-sm font-medium text-ink">{draft.subject}</p>
      <pre className="whitespace-pre-wrap font-sans text-sm text-ink-secondary">{draft.body}</pre>
      <p className="text-xs text-ink-muted">
        {draft.sent_at
          ? `Recorded as sent: ${draft.sent_evidence}${draft.outcome_unknown ? " (outcome unknown — retry disabled until checked)" : ""}`
          : draft.copied_at
            ? "Copied. Copying is not sending."
            : "Not copied yet."}
      </p>
      {!draft.sent_at && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={copied.isPending}
            onClick={() => copied.mutate()}
          >
            Copy
          </Button>
          <Button
            size="sm"
            variant="accent"
            onClick={() => setReview((v) => !v)}
            disabled={step.state !== "now"}
          >
            I sent this
          </Button>
        </div>
      )}
      {review && !draft.sent_at && (
        <div
          className="flex flex-col gap-2 rounded-card bg-wash p-3"
          role="dialog"
          aria-label="Record a send"
        >
          <label className="flex items-center gap-2 text-sm">
            <input
              id="sendCheck"
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            I sent this from my own email
          </label>
          <Input
            id="sendEvidence"
            value={evidence}
            onChange={(e) => setEvidence(e.target.value)}
            placeholder="Sent folder message 42"
            aria-label="Evidence"
          />
          <label className="flex items-center gap-2 text-xs text-ink-secondary">
            <input
              type="checkbox"
              checked={unknown}
              onChange={(e) => setUnknown(e.target.checked)}
            />
            I could not confirm it arrived
          </label>
          {error && (
            <p id="modalError" className="text-sm text-accent-red">
              {error}
            </p>
          )}
          {send.isError && <Notice tone="error">{describeApiError(send.error)}</Notice>}
          <div className="flex gap-2">
            <Button size="sm" variant="accent" onClick={save} disabled={send.isPending}>
              Record the send
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setReview(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
