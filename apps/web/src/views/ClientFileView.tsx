import { DocumentKind, type ClientFileAction, type ClientFileResponse } from "@asap/schema";
import { Button, Card, CardTitle, Input, Notice } from "@asap/ui";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { ClientHeader } from "../components/ClientHeader.js";

const KIND_LABEL: Record<(typeof DocumentKind.options)[number], string> = {
  identity: "Identity",
  beneficial_ownership: "Beneficial ownership",
  source_of_funds: "Source of funds",
  other: "Other",
};

/** K02 — a client's file: collect, verify and decide, in one place. ASAP prepares; it never clears. */
export function ClientFileView({
  file,
  onAct,
  pending,
  blocked,
}: {
  file: ClientFileResponse;
  onAct: (a: ClientFileAction) => void;
  pending: boolean;
  blocked: { guard: string; reason: string } | null;
}) {
  const [kind, setKind] = useState<(typeof DocumentKind.options)[number]>("identity");
  const [label, setLabel] = useState("");
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [interval, setInterval] = useState(365);
  const c = file.client;
  const received = file.documents.filter((d) => d.received_at);
  const requested = file.documents.filter((d) => !d.received_at);
  return (
    <article className="flex flex-col gap-6">
      <ClientHeader client={c} status={file.effective_status} />
      {file.blocking.length > 0 && (
        <Notice tone="waiting">
          This file is blocking:{" "}
          {file.blocking.map((b) => (
            <Link key={b.id} to="/r/$recordId" params={{ recordId: b.id }} className="underline">
              {b.title}
            </Link>
          ))}
        </Notice>
      )}
      {blocked && (
        <Notice tone="waiting">
          <strong>Not yet:</strong> {blocked.reason}
        </Notice>
      )}

      <Card className="flex flex-col gap-3">
        <CardTitle>Documents</CardTitle>
        {received.length === 0 && requested.length === 0 && (
          <p className="text-sm text-ink-secondary">Nothing on file.</p>
        )}
        <ul className="flex flex-col gap-1 text-sm">
          {received.map((d) => (
            <li key={d.id} className="text-ink">
              ✓ {KIND_LABEL[d.kind]} — {d.label}{" "}
              <span className="text-ink-muted">
                · {d.reference} ·{" "}
                {new Date(d.received_at!).toLocaleDateString("en-KE", {
                  day: "numeric",
                  month: "short",
                })}
              </span>
            </li>
          ))}
          {requested.map((d) => (
            <li key={d.id} className="text-ink-secondary">
              ○ {KIND_LABEL[d.kind]} — {d.label}{" "}
              <span className="text-ink-muted">· requested, not received</span>
            </li>
          ))}
        </ul>
        {file.missing.length > 0 && (
          <p className="text-sm text-accent-red">
            Still needed before clearing: {file.missing.join("; ")}.
          </p>
        )}
        <div className="flex flex-wrap items-end gap-2 rounded-card bg-wash p-3">
          <label className="flex flex-col gap-1 text-xs">
            Kind
            <select
              className="rounded-control border border-line-strong bg-paper px-2 py-1 text-sm"
              value={kind}
              onChange={(e) => setKind(e.target.value as typeof kind)}
            >
              {DocumentKind.options.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            Document
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="National ID, certificate of incorporation…"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            What was received (reference)
            <Input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Scan received 8 Sep"
            />
          </label>
          <Button
            size="sm"
            variant="outline"
            disabled={pending || !label.trim()}
            onClick={() => onAct({ action: "request_document", kind, label })}
          >
            Request (draft, you send it)
          </Button>
          <Button
            size="sm"
            variant="accent"
            disabled={pending || !label.trim() || !reference.trim()}
            onClick={() => onAct({ action: "record_document", kind, label, reference })}
          >
            Record received
          </Button>
        </div>
      </Card>

      <Card className="flex flex-col gap-2">
        <CardTitle>Screening</CardTitle>
        <p className="text-sm text-ink-secondary">
          Cannot be screened yet. {file.screening.reason}
        </p>
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => onAct({ action: "screen" })}
        >
          Run screening
        </Button>
      </Card>

      <Card className="flex flex-col gap-3">
        <CardTitle>Decision</CardTitle>
        {c.file_status === "cleared" ? (
          <p className="text-sm text-ink">
            Cleared on{" "}
            {new Date(c.file_decided_at!).toLocaleDateString("en-KE", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
            : {c.file_decision_reason}. Refresh due{" "}
            {new Date(c.refresh_due_at!).toLocaleDateString("en-KE", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
            .
          </p>
        ) : (
          <p className="text-sm text-ink-secondary">
            Not cleared. Clearing is a named decision with a reason; ASAP never clears a file.
          </p>
        )}
        <div className="flex flex-wrap items-end gap-2">
          {(c.file_status === "incomplete" || c.file_status === "not_started") && (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => onAct({ action: "start_review" })}
            >
              Start review
            </Button>
          )}
          {c.file_status !== "cleared" && (
            <>
              <label className="flex flex-col gap-1 text-xs">
                Reason for clearing
                <Input value={reason} onChange={(e) => setReason(e.target.value)} />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                Refresh after (days)
                <Input
                  type="number"
                  min={30}
                  max={1825}
                  value={interval}
                  onChange={(e) => setInterval(Number(e.target.value))}
                />
              </label>
              <Button
                size="sm"
                variant="accent"
                disabled={pending || !reason.trim()}
                onClick={() => onAct({ action: "clear", reason, refreshIntervalDays: interval })}
              >
                Clear this file
              </Button>
            </>
          )}
          {(c.file_status === "cleared" || file.effective_status === "refresh_due") && (
            <>
              <label className="flex flex-col gap-1 text-xs">
                Reason for reopening
                <Input value={reason} onChange={(e) => setReason(e.target.value)} />
              </label>
              <Button
                size="sm"
                variant="outline"
                disabled={pending || !reason.trim()}
                onClick={() => onAct({ action: "reopen", reason })}
              >
                Reopen
              </Button>
            </>
          )}
        </div>
      </Card>
    </article>
  );
}
