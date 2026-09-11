import type { AgreementsResponse } from "@asap/schema";
import { Button, Card, CardTitle, Field, Input, Notice } from "@asap/ui";
import { Page } from "../shell/Page.js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { EmptyState, ErrorState, LoadingList } from "../components/states.js";
import { api, describeApiError } from "../lib/api.js";

/** G01 — Insurer agreements register. The number that matters: live commission expected against no documented rate. */
export function AgreementsView({
  data,
  onCreateAgreement,
  onCreateInsurer,
  pending,
}: {
  data: AgreementsResponse;
  onCreateAgreement: (insurerId: string, from: string) => void;
  onCreateInsurer: (name: string) => void;
  pending: boolean;
}) {
  const [name, setName] = useState("");
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="flex flex-col gap-4">
      <Card variant="attention" className="flex flex-col gap-1">
        <CardTitle>Commission expected against no documented rate</CardTitle>
        <p
          className="font-heading text-4xl leading-none font-semibold tracking-tight text-ink"
          aria-label="undocumented live items"
        >
          {data.undocumented_total}
        </p>
        <p className="text-sm leading-relaxed text-ink-secondary">
          Live items whose class has no confirmed rate with the insurer. On day one this is most of
          them; that is the point of showing it.
        </p>
      </Card>
      {data.rows.length === 0 && (
        <EmptyState scope="insurer agreements" freshness="No insurers yet." />
      )}
      {data.rows.map((r) => (
        <Card key={r.insurer.id} className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="font-heading text-lg font-semibold tracking-tight text-ink">
              {r.insurer.name}
            </h2>
            {r.agreement ? (
              <Link
                to="/settings/agreements/$agreementId"
                params={{ agreementId: r.agreement.id }}
                className="rounded-compact text-sm font-semibold text-accent-green underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-green"
              >
                Version {r.current_version?.version ?? "—"}
                {r.current_version
                  ? ` from ${r.current_version.effective_from}`
                  : " (none effective today)"}
              </Link>
            ) : (
              <span className="rounded-pill bg-accent-red-soft px-2.5 py-1 text-sm font-semibold text-accent-red-ink">
                No agreement on file
              </span>
            )}
          </div>
          <p className="text-sm leading-relaxed text-ink-secondary">
            Confirmed rates:{" "}
            {r.confirmed_classes.length > 0 ? r.confirmed_classes.join(", ") : "none"}
            {r.unconfirmed_classes.length > 0
              ? ` · awaiting confirmation: ${r.unconfirmed_classes.join(", ")}`
              : ""}
          </p>
          {r.undocumented_live.length > 0 && (
            <ul className="flex flex-col">
              {r.undocumented_live.map((w) => (
                <li
                  key={w.id}
                  className="border-b border-line-soft py-2 text-sm text-accent-red-ink last:border-b-0"
                >
                  No agreed rate for {w.class_of_business}:{" "}
                  <Link
                    to="/r/$recordId"
                    params={{ recordId: w.id }}
                    className="font-semibold underline underline-offset-2"
                  >
                    {w.title}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {!r.agreement && (
            <Button
              size="compact"
              variant="outline"
              className="self-start"
              disabled={pending}
              onClick={() => onCreateAgreement(r.insurer.id, today)}
            >
              Record an agreement effective today
            </Button>
          )}
        </Card>
      ))}
      <Card className="flex flex-wrap items-end gap-3">
        <Field label="New insurer" htmlFor="new-insurer" className="min-w-[220px] flex-1">
          <Input id="new-insurer" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Button
          size="compact"
          variant="outline"
          disabled={pending || !name.trim()}
          onClick={() => {
            onCreateInsurer(name.trim());
            setName("");
          }}
        >
          Add insurer
        </Button>
      </Card>
    </div>
  );
}

export function Agreements() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["agreements"], queryFn: api.agreements });
  const act = useMutation({
    mutationFn: api.agreementAct,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["agreements"] }),
  });
  return (
    <Page title="Insurer agreements" meta="What each insurer pays, and what is documented">
      <div className="flex flex-col gap-4">
        {act.isError && <Notice tone="error">{describeApiError(act.error)}</Notice>}
        {q.isPending ? (
          <LoadingList label="Loading agreements" />
        ) : q.isError ? (
          <ErrorState what="Agreements could not load" retry={() => void q.refetch()} />
        ) : (
          <AgreementsView
            data={q.data}
            pending={act.isPending}
            onCreateInsurer={(n) => act.mutate({ action: "create_insurer", name: n })}
            onCreateAgreement={(insurerId, from) =>
              act.mutate({ action: "create_agreement", insurerId, effectiveFrom: from })
            }
          />
        )}
      </div>
    </Page>
  );
}
