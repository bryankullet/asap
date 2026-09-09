import {
  ENDORSEMENT_KIND_LABELS,
  EndorsementKind,
  TRANSFER_NEEDS_POLICYHOLDER,
  type EndorsementAction,
  type EndorsementDetail,
} from "@asap/schema";
import { Button, Card, CardTitle, Input } from "@asap/ui";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

/** The endorsement beside its steps (S08): items with their own decisions, the instruction, the versions. */
export function EndorsementPanel({
  detail,
  onAct,
  pending,
}: {
  detail: EndorsementDetail;
  onAct: (a: EndorsementAction) => void;
  pending: boolean;
}) {
  const e = detail.endorsement;
  const [kind, setKind] = useState<EndorsementKind>(e.kind ?? "other");
  const [effectiveOn, setEffectiveOn] = useState(e.effective_on ?? "");
  const [item, setItem] = useState({ label: "", after: "", sum: "" });
  const [instruction, setInstruction] = useState({
    reference: "",
    from: "policyholder" as "policyholder" | "other",
    fromName: "",
  });
  const [decide, setDecide] = useState<Record<string, { note: string; reference: string }>>({});
  const transferBlocked =
    e.kind === "transfer_ownership" &&
    !(e.instruction_from === "policyholder" && e.instruction_reference);
  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-2">
        <CardTitle>Change requested</CardTitle>
        <p className="text-sm text-ink">{e.request_text}</p>
        <p className="text-sm text-ink-secondary">
          {e.kind ? ENDORSEMENT_KIND_LABELS[e.kind] : "Kind not yet classified"} · requested by{" "}
          {e.requested_by === "policyholder"
            ? "the policyholder"
            : `${e.requested_by_name ?? "someone other than the policyholder"}`}
          {e.effective_on ? ` · effective ${e.effective_on}` : " · effective date not set"}
        </p>
        {transferBlocked && (
          <p className="text-sm text-accent-red">
            {TRANSFER_NEEDS_POLICYHOLDER}{" "}
            {e.requested_by === "other"
              ? `This request came from ${e.requested_by_name ?? "someone else"}; it is recorded, not acted on.`
              : ""}
          </p>
        )}
        {e.instruction_reference && (
          <p className="text-sm text-ink-secondary">
            Instruction on file: {e.instruction_reference}{" "}
            <span className="text-ink-muted">
              · from{" "}
              {e.instruction_from === "policyholder"
                ? "the policyholder"
                : (e.requested_by_name ?? "someone else")}
            </span>
          </p>
        )}
        {detail.missing.length > 0 && (
          <p className="text-sm text-accent-red">Still needed: {detail.missing.join("; ")}.</p>
        )}
        <Link
          to="/r/$recordId"
          params={{ recordId: e.policy_id }}
          className="text-sm text-accent-green underline"
        >
          Open the policy ({detail.versions.length} version{detail.versions.length === 1 ? "" : "s"}
          )
        </Link>
        {!e.applied_version_id && (
          <div className="flex flex-wrap items-end gap-2 rounded-card bg-wash p-3">
            <label className="flex flex-col gap-1 text-xs">
              Kind
              <select
                className="rounded-control border border-line-strong bg-paper px-2 py-1 text-sm"
                value={kind}
                onChange={(ev) => setKind(ev.target.value as EndorsementKind)}
              >
                {EndorsementKind.options.map((k) => (
                  <option key={k} value={k}>
                    {ENDORSEMENT_KIND_LABELS[k]}
                  </option>
                ))}
              </select>
            </label>
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => onAct({ action: "classify", kind })}
            >
              Set kind
            </Button>
            <label className="flex flex-col gap-1 text-xs">
              Effective on
              <Input
                type="date"
                value={effectiveOn}
                onChange={(ev) => setEffectiveOn(ev.target.value)}
              />
            </label>
            <Button
              size="sm"
              variant="outline"
              disabled={pending || !effectiveOn}
              onClick={() => onAct({ action: "set_details", effectiveOn })}
            >
              Set date
            </Button>
          </div>
        )}
        {!e.applied_version_id && (
          <div className="flex flex-wrap items-end gap-2 rounded-card bg-wash p-3">
            <Input
              className="w-48"
              placeholder="Instruction reference"
              value={instruction.reference}
              onChange={(ev) => setInstruction({ ...instruction, reference: ev.target.value })}
            />
            <select
              className="rounded-control border border-line-strong bg-paper px-2 py-1 text-sm"
              value={instruction.from}
              onChange={(ev) =>
                setInstruction({ ...instruction, from: ev.target.value as typeof instruction.from })
              }
            >
              <option value="policyholder">From the policyholder</option>
              <option value="other">From someone else</option>
            </select>
            {instruction.from === "other" && (
              <Input
                className="w-40"
                placeholder="Who"
                value={instruction.fromName}
                onChange={(ev) => setInstruction({ ...instruction, fromName: ev.target.value })}
              />
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={pending || !instruction.reference.trim()}
              onClick={() =>
                onAct({
                  action: "record_instruction",
                  reference: instruction.reference.trim(),
                  from: instruction.from,
                  fromName: instruction.fromName || undefined,
                })
              }
            >
              Record the instruction
            </Button>
          </div>
        )}
      </Card>

      <Card className="flex flex-col gap-2">
        <CardTitle>Items — each with its own decision</CardTitle>
        {e.items.length === 0 && <p className="text-sm text-ink-muted">No items yet.</p>}
        <ul className="flex flex-col gap-2 text-sm">
          {e.items.map((i) => (
            <li key={i.id} className="flex flex-col gap-1 rounded-card border border-line-soft p-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-ink">{i.label}</span>
                <span className="text-ink-muted">
                  {i.before ?? "—"} → {i.after ?? "—"}
                </span>
                <span
                  className={
                    i.decision === "accepted"
                      ? "rounded-pill bg-accent-green-soft px-2 text-xs text-accent-green"
                      : i.decision === "rejected"
                        ? "rounded-pill bg-accent-red-soft px-2 text-xs text-accent-red"
                        : "rounded-pill bg-accent-gold-soft px-2 text-xs text-ink"
                  }
                >
                  {i.decision === "pending"
                    ? "No decision yet"
                    : i.decision === "accepted"
                      ? "Accepted by the insurer"
                      : "Rejected by the insurer"}
                </span>
                {i.note && <span className="text-ink-secondary">· {i.note}</span>}
              </div>
              {i.decision === "pending" && !e.applied_version_id && (
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    className="w-56"
                    placeholder="Their written response (reference)"
                    value={decide[i.id]?.reference ?? ""}
                    onChange={(ev) =>
                      setDecide({
                        ...decide,
                        [i.id]: { note: decide[i.id]?.note ?? "", reference: ev.target.value },
                      })
                    }
                  />
                  <Input
                    className="w-56"
                    placeholder="Their note on this item"
                    value={decide[i.id]?.note ?? ""}
                    onChange={(ev) =>
                      setDecide({
                        ...decide,
                        [i.id]: { reference: decide[i.id]?.reference ?? "", note: ev.target.value },
                      })
                    }
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending || !(decide[i.id]?.reference ?? "").trim()}
                    onClick={() =>
                      onAct({
                        action: "decide_item",
                        itemId: i.id,
                        decision: "accepted",
                        note: decide[i.id]?.note || undefined,
                        responseReference: decide[i.id]!.reference,
                      })
                    }
                  >
                    Accepted
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={pending || !(decide[i.id]?.reference ?? "").trim()}
                    onClick={() =>
                      onAct({
                        action: "decide_item",
                        itemId: i.id,
                        decision: "rejected",
                        note: decide[i.id]?.note || undefined,
                        responseReference: decide[i.id]!.reference,
                      })
                    }
                  >
                    Rejected
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
        {!e.applied_version_id && (
          <div className="flex flex-wrap items-end gap-2 rounded-card bg-wash p-3">
            <Input
              className="w-48"
              placeholder="Item (e.g. KDC 900T Isuzu FRR)"
              value={item.label}
              onChange={(ev) => setItem({ ...item, label: ev.target.value })}
            />
            <Input
              className="w-40"
              placeholder="Change (after)"
              value={item.after}
              onChange={(ev) => setItem({ ...item, after: ev.target.value })}
            />
            <Input
              className="w-32"
              placeholder="Sum insured KES"
              inputMode="numeric"
              value={item.sum}
              onChange={(ev) => setItem({ ...item, sum: ev.target.value })}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={pending || !item.label.trim()}
              onClick={() => {
                onAct({
                  action: "set_details",
                  items: [
                    ...e.items.map(({ decision: _d, note: _n, ...rest }) => rest),
                    {
                      id: `${Date.now()}`,
                      label: item.label.trim(),
                      before: null,
                      after: item.after || null,
                      sumInsuredMinor: item.sum ? Math.round(Number(item.sum) * 100) : null,
                    },
                  ],
                });
                setItem({ label: "", after: "", sum: "" });
              }}
            >
              Add item
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
