import type { AgreementAction, AgreementResponse } from "@asap/schema";
import { Button, Card, CardTitle, Input, Notice } from "@asap/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { useState } from "react";
import { ErrorState, LoadingList, MissingData } from "../components/states.js";
import { api, describeApiError } from "../lib/api.js";

/** G02 — an agreement version: the source of truth commission.expected reads from. A person confirms each rate. */
export function AgreementVersionView({
  data,
  onAct,
  pending,
}: {
  data: AgreementResponse;
  onAct: (a: AgreementAction) => void;
  pending: boolean;
}) {
  const [cls, setCls] = useState("");
  const [pct, setPct] = useState("");
  const [clause, setClause] = useState("");
  const [from, setFrom] = useState("");
  return (
    <article className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-ink">{data.insurer.name}</h1>
        <p className="text-sm text-ink-secondary">
          Agency agreement
          {data.agreement.document_reference ? ` · ${data.agreement.document_reference}` : ""}.
          Rates apply to the commission basis (base premium, not gross).
        </p>
      </header>
      {data.versions.map(({ version, rates }, i) => (
        <Card key={version.id} className="flex flex-col gap-3">
          <CardTitle>
            Version {version.version} · from {version.effective_from}
            {version.effective_to ? ` to ${version.effective_to}` : " (current)"}
            {version.payment_terms_days !== null
              ? ` · ${version.payment_terms_days}-day terms`
              : ""}
          </CardTitle>
          {rates.length === 0 ? (
            <p className="text-sm text-ink-secondary">
              No rates on this version. Nothing here counts until a rate is proposed and confirmed.
            </p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {rates.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-ink">{r.class_of_business}</span>
                  <span>{(r.rate_basis_points / 100).toFixed(2)}%</span>
                  {r.clause_reference && (
                    <span className="text-ink-muted">· {r.clause_reference}</span>
                  )}
                  <span className="text-ink-muted">
                    · proposed by {r.proposed_by === "asap" ? "ASAP" : "a person"}
                  </span>
                  {r.confirmed_at ? (
                    <span className="rounded-pill bg-accent-green-soft px-2 text-xs text-accent-green">
                      Confirmed
                    </span>
                  ) : (
                    <>
                      <span className="rounded-pill bg-accent-gold-soft px-2 text-xs text-ink">
                        Not confirmed — never used
                      </span>
                      {i === 0 && (
                        <Button
                          size="sm"
                          variant="accent"
                          disabled={pending}
                          onClick={() => onAct({ action: "confirm_rate", rateId: r.id })}
                        >
                          Confirm this rate
                        </Button>
                      )}
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
          {i === 0 && (
            <div className="flex flex-wrap items-end gap-2 rounded-card bg-wash p-3">
              <label className="flex flex-col gap-1 text-xs">
                Class of business
                <Input
                  value={cls}
                  onChange={(e) => setCls(e.target.value)}
                  placeholder="Motor commercial"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                Rate %
                <Input
                  value={pct}
                  onChange={(e) => setPct(e.target.value)}
                  placeholder="12.5"
                  inputMode="decimal"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                Clause
                <Input
                  value={clause}
                  onChange={(e) => setClause(e.target.value)}
                  placeholder="Schedule A, 4.2"
                />
              </label>
              <Button
                size="sm"
                variant="outline"
                disabled={pending || !cls.trim() || Number.isNaN(Number(pct))}
                onClick={() =>
                  onAct({
                    action: "propose_rate",
                    versionId: version.id,
                    classOfBusiness: cls.trim(),
                    rateBasisPoints: Math.round(Number(pct) * 100),
                    clauseReference: clause || undefined,
                    proposedBy: "person",
                  })
                }
              >
                Propose a rate (needs confirming)
              </Button>
            </div>
          )}
        </Card>
      ))}
      <div className="flex flex-wrap items-end gap-2 rounded-card bg-paper p-4 shadow-card">
        <label className="flex flex-col gap-1 text-sm">
          New version effective from
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <Button
          size="sm"
          variant="outline"
          disabled={pending || !from}
          onClick={() =>
            onAct({ action: "new_version", agreementId: data.agreement.id, effectiveFrom: from })
          }
        >
          Start a new version
        </Button>
        <p className="text-xs text-ink-muted">
          Policies rated under the old version keep it. History is never rewritten.
        </p>
      </div>
    </article>
  );
}

export function AgreementVersion() {
  const { agreementId = "" } = useParams({ strict: false }) as { agreementId?: string };
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["agreement", agreementId],
    queryFn: () => api.agreement(agreementId),
    retry: false,
  });
  const act = useMutation({
    mutationFn: api.agreementAct,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["agreement", agreementId] });
      void qc.invalidateQueries({ queryKey: ["agreements"] });
    },
  });
  if (q.isPending) return <LoadingList rows={2} label="Loading agreement" />;
  if (q.isError)
    return (q.error as { status?: number }).status === 404 ? (
      <MissingData
        what="No agreement with that id"
        why="It may not exist, or your role cannot see it."
      />
    ) : (
      <ErrorState what="The agreement could not load" retry={() => void q.refetch()} />
    );
  return (
    <>
      {act.isError && <Notice tone="error">{describeApiError(act.error)}</Notice>}
      <AgreementVersionView data={q.data} onAct={(a) => act.mutate(a)} pending={act.isPending} />
    </>
  );
}
