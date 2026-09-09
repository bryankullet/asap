import { HOLDER_LABELS, type ClaimAction, type ClaimDetail } from "@asap/schema";
import { Button, Card, CardTitle, Input } from "@asap/ui";
import { useState } from "react";

/**
 * The claim beside its steps (S10). Settlement offered, client accepted and payment received are
 * three rows and stay three rows. Call notes are ours, labelled so. The clock says why it is not
 * running until it can. Cover is a review, never a decision.
 */
export function ClaimPanel({
  detail,
  onAct,
  pending,
}: {
  detail: ClaimDetail;
  onAct: (a: ClaimAction) => void;
  pending: boolean;
}) {
  const c = detail.claim;
  const [docLabel, setDocLabel] = useState("");
  const [holder, setHolder] = useState<ClaimAction extends { holder: infer H } ? H : never>(
    "client" as never,
  );
  const [ref, setRef] = useState<Record<string, string>>({});
  const [note, setNote] = useState({ spokeWith: "", body: "" });
  const [clock, setClock] = useState({
    clauseReference: "",
    clausePage: "",
    clauseDays: "",
    startEvent: "incident" as "incident" | "client_aware" | "notified_to_us",
    startOn: "",
    startEvidence: "",
  });
  const fact = (label: string, reference: string | null, at: string | null) => (
    <li className="flex flex-wrap items-baseline gap-2 text-sm">
      <span className="w-40 font-medium text-ink">{label}</span>
      {reference ? (
        <span className="text-ink">
          {reference}{" "}
          <span className="text-ink-muted">
            · {new Date(at!).toLocaleDateString("en-KE", { day: "numeric", month: "short" })}
          </span>
        </span>
      ) : (
        <span className="text-ink-muted">Not recorded</span>
      )}
    </li>
  );
  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-2">
        <CardTitle>Claim</CardTitle>
        <p className="text-sm text-ink">
          Incident on {c.incident_on}: {c.incident_summary}
        </p>
        <p className="text-sm text-ink-secondary">
          {c.status === "draft"
            ? `Draft claim${c.source === "email" ? " captured from email" : ""} — not registered until a person matches it to a policy period.`
            : `Registered${c.registered_at ? ` on ${new Date(c.registered_at).toLocaleDateString("en-KE", { day: "numeric", month: "short" })}` : ""}${c.insurer_reference ? ` · insurer reference ${c.insurer_reference}` : ""}.`}
        </p>
        {c.cover_review && (
          <p className="text-sm text-ink-secondary">
            <span className="font-medium text-ink">Cover review:</span> {c.cover_review}
          </p>
        )}
      </Card>

      <Card className="flex flex-col gap-2">
        <CardTitle>Notification clock</CardTitle>
        {detail.clock.started ? (
          <p className="text-sm text-ink">
            {detail.clock.days} days from {detail.clock.startEvent.replaceAll("_", " ")} on{" "}
            {detail.clock.startOn} ({detail.clock.clause}, page {detail.clock.page}). Due{" "}
            {detail.clock.dueOn}; today is day {detail.clock.dayOf}.
          </p>
        ) : (
          <>
            <p className="text-sm text-accent-red">{detail.clock.reason}</p>
            <div className="grid grid-cols-2 gap-2 rounded-card bg-wash p-3 text-xs">
              <Input
                placeholder="Wording clause (e.g. Condition 3)"
                value={clock.clauseReference}
                onChange={(e) => setClock({ ...clock, clauseReference: e.target.value })}
              />
              <Input
                placeholder="Page"
                inputMode="numeric"
                value={clock.clausePage}
                onChange={(e) => setClock({ ...clock, clausePage: e.target.value })}
              />
              <Input
                placeholder="Days allowed"
                inputMode="numeric"
                value={clock.clauseDays}
                onChange={(e) => setClock({ ...clock, clauseDays: e.target.value })}
              />
              <select
                className="rounded-control border border-line-strong bg-paper px-2 py-1 text-sm"
                value={clock.startEvent}
                onChange={(e) =>
                  setClock({ ...clock, startEvent: e.target.value as typeof clock.startEvent })
                }
              >
                <option value="incident">Counts from the incident</option>
                <option value="client_aware">Counts from when the client became aware</option>
                <option value="notified_to_us">Counts from notification to us</option>
              </select>
              <Input
                type="date"
                value={clock.startOn}
                onChange={(e) => setClock({ ...clock, startOn: e.target.value })}
              />
              <Input
                placeholder="Evidence of the start event"
                value={clock.startEvidence}
                onChange={(e) => setClock({ ...clock, startEvidence: e.target.value })}
              />
              <Button
                size="sm"
                variant="outline"
                className="col-span-2"
                disabled={
                  pending ||
                  !clock.clauseReference ||
                  !clock.clausePage ||
                  !clock.clauseDays ||
                  !clock.startOn ||
                  !clock.startEvidence
                }
                onClick={() =>
                  onAct({
                    action: "set_clock",
                    clauseReference: clock.clauseReference,
                    clausePage: Number(clock.clausePage),
                    clauseDays: Number(clock.clauseDays),
                    startEvent: clock.startEvent,
                    startOn: clock.startOn,
                    startEvidence: clock.startEvidence,
                  })
                }
              >
                Start the clock (all six are needed)
              </Button>
            </div>
          </>
        )}
      </Card>

      <Card className="flex flex-col gap-2">
        <CardTitle>Documents</CardTitle>
        {detail.documents.length === 0 && (
          <p className="text-sm text-ink-muted">None listed yet.</p>
        )}
        <ul className="flex flex-col gap-1 text-sm">
          {detail.documents.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-2">
              {d.received_at ? (
                <span className="text-ink">
                  ✓ {d.label} <span className="text-ink-muted">· {d.reference}</span>
                </span>
              ) : (
                <>
                  <span className="text-ink-secondary">
                    ○ {d.label} — outstanding, with {HOLDER_LABELS[d.holder]}
                  </span>
                  <Input
                    className="w-48"
                    placeholder="Reference when received"
                    value={ref[d.id] ?? ""}
                    onChange={(e) => setRef({ ...ref, [d.id]: e.target.value })}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending || !(ref[d.id] ?? "").trim()}
                    onClick={() =>
                      onAct({ action: "receive_document", documentId: d.id, reference: ref[d.id]! })
                    }
                  >
                    Received
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-end gap-2 rounded-card bg-wash p-3">
          <Input
            className="w-56"
            placeholder="Document (police abstract…)"
            value={docLabel}
            onChange={(e) => setDocLabel(e.target.value)}
          />
          <select
            className="rounded-control border border-line-strong bg-paper px-2 py-1 text-sm"
            value={holder as string}
            onChange={(e) => setHolder(e.target.value as never)}
          >
            {Object.entries(HOLDER_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                held by {v}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant="outline"
            disabled={pending || !docLabel.trim()}
            onClick={() => {
              onAct({ action: "add_document", label: docLabel.trim(), holder: holder as never });
              setDocLabel("");
            }}
          >
            Add outstanding document
          </Button>
        </div>
      </Card>

      <Card className="flex flex-col gap-2">
        <CardTitle>Settlement — three facts</CardTitle>
        <ul className="flex flex-col gap-1">
          {fact("Settlement offered", c.offer_reference, c.offer_recorded_at)}
          {fact("Client accepted", c.acceptance_reference, c.acceptance_recorded_at)}
          {fact("Payment received", c.payment_reference, c.payment_recorded_at)}
        </ul>
        <p className="text-xs text-ink-muted">
          An offer is not an acceptance, and an acceptance is not money received. Each is recorded
          on its own step.
        </p>
      </Card>

      <Card className="flex flex-col gap-2">
        <CardTitle>Our call notes</CardTitle>
        <p className="text-xs text-ink-muted">
          Our record of conversations. Never the insurer's words; their response is their email or
          letter.
        </p>
        <ul className="flex flex-col gap-1 text-sm">
          {detail.notes.map((n) => (
            <li key={n.id} className="text-ink-secondary">
              <span className="font-medium text-ink">
                {n.kind === "call_note" ? `Call with ${n.spoke_with ?? "—"}` : "Note"}
              </span>{" "}
              ·{" "}
              {new Date(n.noted_at).toLocaleDateString("en-KE", { day: "numeric", month: "short" })}
              : {n.body}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-end gap-2 rounded-card bg-wash p-3">
          <Input
            className="w-48"
            placeholder="Spoke with"
            value={note.spokeWith}
            onChange={(e) => setNote({ ...note, spokeWith: e.target.value })}
          />
          <Input
            className="w-72"
            placeholder="What was said, as we heard it"
            value={note.body}
            onChange={(e) => setNote({ ...note, body: e.target.value })}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={pending || !note.spokeWith.trim() || !note.body.trim()}
            onClick={() => {
              onAct({
                action: "add_call_note",
                spokeWith: note.spokeWith.trim(),
                body: note.body.trim(),
              });
              setNote({ spokeWith: "", body: "" });
            }}
          >
            Add call note
          </Button>
        </div>
      </Card>
    </div>
  );
}
