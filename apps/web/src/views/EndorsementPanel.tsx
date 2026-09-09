import {
  ENDORSEMENT_KIND_LABELS,
  EndorsementKind,
  TRANSFER_NEEDS_POLICYHOLDER,
  type EndorsementAction,
  type EndorsementDetail,
} from "@asap/schema";
import { Button, Card, CardTitle, Field, Input, Notice, Select, cn } from "@asap/ui";
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
    <div className="flex flex-col gap-5">
      <Card className="flex flex-col gap-3">
        <CardTitle>Change requested</CardTitle>
        <p className="text-sm leading-relaxed text-ink">{e.request_text}</p>
        <p className="text-sm leading-relaxed text-ink-muted">
          {e.kind ? ENDORSEMENT_KIND_LABELS[e.kind] : "Kind not yet classified"} · requested by{" "}
          {e.requested_by === "policyholder"
            ? "the policyholder"
            : `${e.requested_by_name ?? "someone other than the policyholder"}`}
          {e.effective_on ? ` · effective ${e.effective_on}` : " · effective date not set"}
        </p>
        {transferBlocked && (
          <Notice tone="error">
            {TRANSFER_NEEDS_POLICYHOLDER}{" "}
            {e.requested_by === "other"
              ? `This request came from ${e.requested_by_name ?? "someone else"}; it is recorded, not acted on.`
              : ""}
          </Notice>
        )}
        {e.instruction_reference && (
          <p className="text-sm leading-relaxed text-ink-secondary">
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
          <Notice tone="waiting">Still needed: {detail.missing.join("; ")}.</Notice>
        )}
        <Link
          to="/r/$recordId"
          params={{ recordId: e.policy_id }}
          className="self-start text-sm font-semibold text-accent-green underline-offset-2 hover:underline"
        >
          Open the policy ({detail.versions.length} version{detail.versions.length === 1 ? "" : "s"}
          )
        </Link>
        {!e.applied_version_id && (
          <div className="flex flex-wrap items-end gap-3 rounded-control border border-line-soft bg-wash p-4">
            <Field label="Kind" htmlFor="endorsement-kind" className="min-w-[14rem]">
              <Select
                id="endorsement-kind"
                value={kind}
                onChange={(ev) => setKind(ev.target.value as EndorsementKind)}
              >
                {EndorsementKind.options.map((k) => (
                  <option key={k} value={k}>
                    {ENDORSEMENT_KIND_LABELS[k]}
                  </option>
                ))}
              </Select>
            </Field>
            <Button
              size="compact"
              variant="outline"
              disabled={pending}
              onClick={() => onAct({ action: "classify", kind })}
            >
              Set kind
            </Button>
            <Field label="Effective on" htmlFor="endorsement-effective-on">
              <Input
                id="endorsement-effective-on"
                type="date"
                value={effectiveOn}
                onChange={(ev) => setEffectiveOn(ev.target.value)}
              />
            </Field>
            <Button
              size="compact"
              variant="outline"
              disabled={pending || !effectiveOn}
              onClick={() => onAct({ action: "set_details", effectiveOn })}
            >
              Set date
            </Button>
          </div>
        )}
        {!e.applied_version_id && (
          <div className="flex flex-wrap items-end gap-3 rounded-control border border-line-soft bg-wash p-4">
            <Input
              className="w-48"
              placeholder="Instruction reference"
              value={instruction.reference}
              onChange={(ev) => setInstruction({ ...instruction, reference: ev.target.value })}
            />
            <Select
              className="w-56"
              value={instruction.from}
              onChange={(ev) =>
                setInstruction({ ...instruction, from: ev.target.value as typeof instruction.from })
              }
            >
              <option value="policyholder">From the policyholder</option>
              <option value="other">From someone else</option>
            </Select>
            {instruction.from === "other" && (
              <Input
                className="w-40"
                placeholder="Who"
                value={instruction.fromName}
                onChange={(ev) => setInstruction({ ...instruction, fromName: ev.target.value })}
              />
            )}
            <Button
              size="compact"
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

      <Card className="flex flex-col gap-3">
        <CardTitle>Items — each with its own decision</CardTitle>
        {e.items.length === 0 && <p className="text-sm text-ink-muted">No items yet.</p>}
        <ul className="flex flex-col">
          {e.items.map((i) => (
            <li
              key={i.id}
              className="flex flex-col gap-2 border-b border-line-soft py-3 text-sm last:border-b-0"
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                <span className="font-semibold text-ink">{i.label}</span>
                <span className="text-ink-muted">
                  {i.before ?? "—"} → {i.after ?? "—"}
                </span>
                <span
                  className={cn(
                    "rounded-pill px-2.5 py-1 text-xs font-semibold",
                    i.decision === "accepted"
                      ? "bg-accent-green-soft text-accent-green-ink"
                      : i.decision === "rejected"
                        ? "bg-accent-red-soft text-accent-red-ink"
                        : "bg-accent-gold-soft text-accent-gold-ink",
                  )}
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
                    size="compact"
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
                    size="compact"
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
          <div className="flex flex-wrap items-end gap-2 rounded-control border border-line-soft bg-wash p-4">
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
              size="compact"
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
