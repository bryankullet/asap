import type { AgreementsResponse } from "@asap/schema";
import { Button, Card, CardTitle, Input, Notice } from "@asap/ui";
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
      <Card className="flex flex-col gap-1">
        <CardTitle>Commission expected against no documented rate</CardTitle>
        <p className="text-3xl font-semibold text-ink" aria-label="undocumented live items">
          {data.undocumented_total}
        </p>
        <p className="text-sm text-ink-secondary">
          Live items whose class has no confirmed rate with the insurer. On day one this is most of
          them; that is the point of showing it.
        </p>
      </Card>
      {data.rows.length === 0 && (
        <EmptyState scope="insurer agreements" freshness="No insurers yet." />
      )}
      {data.rows.map((r) => (
        <Card key={r.insurer.id} className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-ink">{r.insurer.name}</h2>
            {r.agreement ? (
              <Link
                to="/settings/agreements/$agreementId"
                params={{ agreementId: r.agreement.id }}
                className="text-sm text-accent-green underline"
              >
                Version {r.current_version?.version ?? "—"}
                {r.current_version
                  ? ` from ${r.current_version.effective_from}`
                  : " (none effective today)"}
              </Link>
            ) : (
              <span className="text-sm text-accent-red">No agreement on file</span>
            )}
          </div>
          <p className="text-sm text-ink-secondary">
            Confirmed rates:{" "}
            {r.confirmed_classes.length > 0 ? r.confirmed_classes.join(", ") : "none"}
            {r.unconfirmed_classes.length > 0
              ? ` · awaiting confirmation: ${r.unconfirmed_classes.join(", ")}`
              : ""}
          </p>
          {r.undocumented_live.length > 0 && (
            <ul className="text-sm text-accent-red">
              {r.undocumented_live.map((w) => (
                <li key={w.id}>
                  No agreed rate for {w.class_of_business}:{" "}
                  <Link to="/r/$recordId" params={{ recordId: w.id }} className="underline">
                    {w.title}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {!r.agreement && (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => onCreateAgreement(r.insurer.id, today)}
            >
              Record an agreement effective today
            </Button>
          )}
        </Card>
      ))}
      <div className="flex flex-wrap items-end gap-2 rounded-card bg-paper p-4 shadow-card">
        <label className="flex flex-col gap-1 text-sm">
          New insurer
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <Button
          size="sm"
          variant="outline"
          disabled={pending || !name.trim()}
          onClick={() => {
            onCreateInsurer(name.trim());
            setName("");
          }}
        >
          Add insurer
        </Button>
      </div>
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
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold text-ink">Insurer agreements</h1>
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
  );
}
