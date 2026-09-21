import type { ApplyPreviewField, ApplyTarget } from "@asap/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useMemo, useState } from "react";
import { api, describeApiError } from "../../lib/api.js";
import { EvidenceConditionChip } from "../../components/EvidenceCondition.js";

/**
 * Applying what a document says to the record it is about (D-077).
 *
 * The shape of this screen is the whole point of it. ASAP **suggests** a record and says why it
 * believes that, in the same six evidence words used everywhere else. A person confirms it,
 * chooses a different one, chooses the fields, corrects a value if they want to, and only then
 * applies. Nothing here writes on its own, and nothing is applied to a record ASAP picked.
 *
 * Three things a person is always shown before anything is written: what the record holds now,
 * what would be written, and which values would not change at all. A field the target cannot hold
 * says so rather than being quietly dropped.
 */
export function ApplyToRecord({ documentId }: { documentId: string }) {
  const qc = useQueryClient();
  const [chosen, setChosen] = useState<ApplyTarget | null>(null);
  /** The fields a person has ticked, and any value they typed over the proposal. */
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [basis, setBasis] = useState<"gross" | "total_payable" | "">("");
  /*
   * One key per press of Apply, made once per chosen target. A retry after a failure reuses it,
   * which is the point: the server writes once for one decision however many times it arrives.
   */
  const [key, setKey] = useState(() => crypto.randomUUID());
  const basisId = useId();

  const targets = useQuery({
    queryKey: ["apply-targets", documentId],
    queryFn: () => api.applyTargets(documentId),
  });

  const preview = useQuery({
    queryKey: ["apply-preview", documentId, chosen?.targetType, chosen?.targetId],
    enabled: Boolean(chosen),
    queryFn: () => api.applyPreview(documentId, chosen!.targetType, chosen!.targetId),
  });

  const apply = useMutation({
    mutationFn: (input: Parameters<typeof api.applyToRecord>[1]) =>
      api.applyToRecord(documentId, input),
    onSuccess: () => {
      // Everything that reads these records reads them again: the document, its own screen, and
      // every board that shows the record it was applied to.
      void qc.invalidateQueries({ queryKey: ["document", documentId] });
      void qc.invalidateQueries({ queryKey: ["apply-preview", documentId] });
      void qc.invalidateQueries({ queryKey: ["work"] });
      void qc.invalidateQueries({ queryKey: ["attention"] });
    },
  });

  const rows = preview.data?.fields ?? [];
  const appliable = useMemo(
    () => rows.filter((f) => f.blockedBecause === null && !f.unchanged),
    [rows],
  );
  const needsBasis = appliable.some((f) => selected[f.documentFieldId] && f.fieldKey === "premium");
  const ticked = appliable.filter((f) => selected[f.documentFieldId]);

  function valueFor(field: ApplyPreviewField): string {
    return edited[field.documentFieldId] ?? field.proposedValue ?? "";
  }

  function submit() {
    if (!chosen || ticked.length === 0) return;
    apply.mutate({
      targetType: chosen.targetType,
      targetId: chosen.targetId,
      idempotencyKey: key,
      fields: ticked.map((f) => ({
        documentFieldId: f.documentFieldId,
        fieldKey: f.fieldKey,
        from: f.currentValue,
        to: valueFor(f),
        ...(f.fieldKey === "premium" && basis ? { premiumBasis: basis } : {}),
      })),
    });
  }

  if (apply.data) {
    return (
      <section
        aria-label="Applied"
        className="flex flex-col gap-2 rounded-card border border-line-strong bg-accent-green-soft p-3"
      >
        <strong className="text-sm text-accent-green-ink">
          {apply.data.repeat
            ? "Already applied — this is the receipt from the first time."
            : "Applied to the record."}
        </strong>
        <ul className="flex flex-col gap-1 text-xs text-ink-secondary">
          {apply.data.changes.map((ch) => (
            <li key={ch.fieldKey}>
              <strong>{ch.fieldKey.replace(/_/g, " ")}</strong>: {ch.from ?? "nothing"} → {ch.to}
              {ch.page === null ? "" : ` · read from page ${ch.page}`}
            </li>
          ))}
        </ul>
        <p className="text-xs text-ink-muted">
          The document is linked to the record as the evidence for these values, and the change is
          in the audit history with both sides of every field.
        </p>
        <button
          type="button"
          className="secondary self-start"
          onClick={() => {
            apply.reset();
            setChosen(null);
            setSelected({});
            setEdited({});
            setKey(crypto.randomUUID());
          }}
        >
          Apply something else
        </button>
      </section>
    );
  }

  return (
    <section aria-label="Apply to a record" className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-ink">Apply to a record</h2>

      {/* Choosing the target. */}
      {!chosen && (
        <div className="flex flex-col gap-2">
          {targets.isPending && <p className="text-sm text-ink-muted">Looking for the record…</p>}
          {targets.isError && (
            <p role="alert" className="text-sm text-accent-red">
              We could not look for the record: {describeApiError(targets.error)}
            </p>
          )}
          {(targets.data?.suggestions ?? []).map((t) => (
            <article
              key={`${t.targetType}:${t.targetId}`}
              className="flex flex-col gap-1 rounded-card border border-line-strong bg-paper p-3"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <strong className="text-sm text-ink">{t.label}</strong>
                <EvidenceConditionChip condition={t.condition} />
              </div>
              <p className="text-xs uppercase tracking-wide text-ink-muted">
                {t.targetType.replace(/_/g, " ")}
              </p>
              {/* Why ASAP believes this is the record. A suggestion nobody can check is one they
                  have to take on trust. */}
              <p className="text-xs text-ink-secondary">{t.reason}</p>
              <button type="button" className="secondary self-start" onClick={() => setChosen(t)}>
                Apply to this
              </button>
            </article>
          ))}
          {targets.data?.whyNoTarget && (
            <article className="flex flex-col gap-1 rounded-card border border-accent-gold-line bg-accent-gold-soft p-3">
              <strong className="text-sm text-accent-gold-ink">
                ASAP cannot tell which record this belongs to.
              </strong>
              <p className="text-xs text-accent-gold-ink">{targets.data.whyNoTarget}</p>
            </article>
          )}
        </div>
      )}

      {/* What would change. */}
      {chosen && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <strong className="text-sm text-ink">{chosen.label}</strong>
            <button type="button" className="secondary" onClick={() => setChosen(null)}>
              Choose a different record
            </button>
          </div>

          {preview.isPending && <p className="text-sm text-ink-muted">Reading the record…</p>}
          {preview.isError && (
            <p role="alert" className="text-sm text-accent-red">
              We could not read that record: {describeApiError(preview.error)}
            </p>
          )}

          {rows.map((f) => {
            const blocked = f.blockedBecause !== null;
            return (
              <article
                key={f.documentFieldId}
                className="flex flex-col gap-1 rounded-card border border-line-strong bg-paper p-3"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <label className="flex items-center gap-2 text-sm text-ink">
                    {!blocked && !f.unchanged && (
                      <input
                        type="checkbox"
                        checked={Boolean(selected[f.documentFieldId])}
                        onChange={(e) =>
                          setSelected((s) => ({ ...s, [f.documentFieldId]: e.target.checked }))
                        }
                      />
                    )}
                    <span className="uppercase tracking-wide text-xs text-ink-muted">
                      {f.fieldKey.replace(/_/g, " ")}
                    </span>
                  </label>
                  <EvidenceConditionChip condition={f.condition} />
                </div>

                <p className="text-xs text-ink-secondary">
                  {/* The record now, and what would replace it. Both, always. */}
                  <span>now: {f.currentValue ?? "nothing"}</span>
                  {" → "}
                  <span>{f.proposedValue ?? "nothing was read"}</span>
                </p>

                {blocked && <p className="text-xs text-ink-muted">{f.blockedBecause}</p>}
                {!blocked && f.unchanged && (
                  <p className="text-xs text-ink-muted">
                    The record already holds this. Applying it would change nothing.
                  </p>
                )}
                {!blocked && !f.unchanged && (
                  <input
                    aria-label={`Value to apply for ${f.fieldKey.replace(/_/g, " ")}`}
                    value={valueFor(f)}
                    onChange={(e) =>
                      setEdited((v) => ({ ...v, [f.documentFieldId]: e.target.value }))
                    }
                    className="min-h-[34px] rounded-control border border-line-strong px-2 text-sm"
                  />
                )}
              </article>
            );
          })}

          {(preview.data?.missing ?? []).length > 0 && (
            <p className="text-xs text-ink-muted">
              This record also holds {preview.data?.missing.join(", ").replace(/_/g, " ")}, which
              the document did not give.
            </p>
          )}

          {/* A premium cannot be written without saying what the figure is. */}
          {needsBasis && (
            <div className="flex flex-col gap-1 rounded-card border border-accent-gold-line bg-accent-gold-soft p-3">
              <label htmlFor={basisId} className="text-sm text-accent-gold-ink">
                Is this figure the gross premium, or everything payable?
              </label>
              <p className="text-xs text-accent-gold-ink">
                The schedule does not say, and the commission basis depends on which it is. Nobody
                can work one out from the other once the levies are on top.
              </p>
              <select
                id={basisId}
                value={basis}
                onChange={(e) => setBasis(e.target.value as typeof basis)}
                className="min-h-[34px] max-w-xs rounded-control border border-line-strong px-2 text-sm"
              >
                <option value="">Choose…</option>
                <option value="gross">Gross premium</option>
                <option value="total_payable">Everything payable</option>
              </select>
            </div>
          )}

          {apply.isError && (
            <p role="alert" className="text-sm text-accent-red">
              Nothing was written: {describeApiError(apply.error)}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={apply.isPending || ticked.length === 0 || (needsBasis && !basis)}
              onClick={submit}
            >
              {apply.isPending
                ? "Applying…"
                : `Apply ${ticked.length} ${ticked.length === 1 ? "value" : "values"}`}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setChosen(null);
                setSelected({});
                setEdited({});
              }}
            >
              Cancel
            </button>
            {ticked.length === 0 && (
              <span className="text-xs text-ink-muted">
                Tick the values you want written to this record.
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
