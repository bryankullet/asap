import { DocumentKind, type ClientFileAction, type ClientFileResponse } from "@asap/schema";
import {
  Button,
  Card,
  CardTitle,
  Checklist,
  ChecklistRow,
  Field,
  Input,
  Notice,
  Select,
} from "@asap/ui";
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
    <article className="flex flex-col gap-5">
      <ClientHeader client={c} status={file.effective_status} />
      {file.blocking.length > 0 && (
        <Notice tone="waiting">
          This file is blocking:{" "}
          {file.blocking.map((b) => (
            <Link
              key={b.id}
              to="/r/$recordId"
              params={{ recordId: b.id }}
              className="font-semibold underline underline-offset-2"
            >
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
          <p className="text-sm text-ink-muted">Nothing on file.</p>
        )}
        <Checklist>
          {received.map((d) => (
            <ChecklistRow
              key={d.id}
              done
              title={`${KIND_LABEL[d.kind]} — ${d.label}`}
              detail={`${d.reference} · ${new Date(d.received_at!).toLocaleDateString("en-KE", {
                day: "numeric",
                month: "short",
              })}`}
            />
          ))}
          {requested.map((d) => (
            <ChecklistRow
              key={d.id}
              title={`${KIND_LABEL[d.kind]} — ${d.label}`}
              detail="requested, not received"
            />
          ))}
        </Checklist>
        {file.missing.length > 0 && (
          <Notice tone="waiting">Still needed before clearing: {file.missing.join("; ")}.</Notice>
        )}
        <div className="flex flex-wrap items-end gap-3 rounded-control border border-line-soft bg-wash p-4">
          <Field label="Kind" htmlFor="client-file-kind" className="min-w-[12rem]">
            <Select
              id="client-file-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as typeof kind)}
            >
              {DocumentKind.options.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Document" htmlFor="client-file-label" className="min-w-[16rem] flex-1">
            <Input
              id="client-file-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="National ID, certificate of incorporation…"
            />
          </Field>
          <Field
            label="What was received (reference)"
            htmlFor="client-file-reference"
            className="min-w-[14rem] flex-1"
          >
            <Input
              id="client-file-reference"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Scan received 8 Sep"
            />
          </Field>
          <Button
            size="compact"
            variant="outline"
            disabled={pending || !label.trim()}
            onClick={() => onAct({ action: "request_document", kind, label })}
          >
            Request (draft, you send it)
          </Button>
          <Button
            size="compact"
            variant="accent"
            disabled={pending || !label.trim() || !reference.trim()}
            onClick={() => onAct({ action: "record_document", kind, label, reference })}
          >
            Record received
          </Button>
        </div>
      </Card>

      <Card className="flex flex-col items-start gap-3">
        <CardTitle>Screening</CardTitle>
        <p className="text-sm leading-relaxed text-ink-muted">
          Cannot be screened yet. {file.screening.reason}
        </p>
        <Button
          size="compact"
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
          <p className="text-sm leading-relaxed text-ink">
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
          <p className="text-sm leading-relaxed text-ink-muted">
            Not cleared. Clearing is a named decision with a reason; ASAP never clears a file.
          </p>
        )}
        <div className="flex flex-wrap items-end gap-3">
          {(c.file_status === "incomplete" || c.file_status === "not_started") && (
            <Button
              size="compact"
              variant="outline"
              disabled={pending}
              onClick={() => onAct({ action: "start_review" })}
            >
              Start review
            </Button>
          )}
          {c.file_status !== "cleared" && (
            <>
              <Field
                label="Reason for clearing"
                htmlFor="client-file-clear-reason"
                className="min-w-[16rem] flex-1"
              >
                <Input
                  id="client-file-clear-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </Field>
              <Field label="Refresh after (days)" htmlFor="client-file-refresh" className="w-40">
                <Input
                  id="client-file-refresh"
                  type="number"
                  min={30}
                  max={1825}
                  value={interval}
                  onChange={(e) => setInterval(Number(e.target.value))}
                />
              </Field>
              <Button
                size="compact"
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
              <Field
                label="Reason for reopening"
                htmlFor="client-file-reopen-reason"
                className="min-w-[16rem] flex-1"
              >
                <Input
                  id="client-file-reopen-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </Field>
              <Button
                size="compact"
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
