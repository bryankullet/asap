import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, describeApiError } from "../../lib/api.js";

/**
 * The people at a client (D-070).
 *
 * This is where a brokerage records who it actually writes to — the gap that made "email this
 * client" impossible to build. A corporate client has several: the finance contact who receives
 * invoices and the operations contact who reports claims are routinely different people.
 *
 * One of them is the primary, and exactly one: the database refuses a second. Choosing a new one
 * stands the old one down rather than asking a person to clear it first.
 */
export function Contacts({ clientId }: { clientId: string }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);

  const contacts = useQuery({
    queryKey: ["contacts", clientId],
    queryFn: () => api.contacts(clientId),
    enabled: Boolean(clientId),
    retry: false,
  });

  const create = useMutation({
    mutationFn: api.createContact,
    onSuccess: () => {
      setAdding(false);
      void qc.invalidateQueries({ queryKey: ["contacts", clientId] });
    },
  });

  const rows = contacts.data?.contacts ?? [];

  return (
    <section aria-label="People at this client" className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-ink">Who we deal with</h2>
        <button
          type="button"
          className="rounded-pill border border-line-strong px-3 py-0.5 text-xs text-ink-secondary hover:border-ink-muted"
          aria-expanded={adding}
          onClick={() => setAdding((v) => !v)}
        >
          {adding ? "Cancel" : "＋ Add a person"}
        </button>
      </div>

      {contacts.isPending && <p className="text-sm text-ink-muted">Reading the contacts…</p>}
      {contacts.isError && (
        <p role="alert" className="text-sm text-accent-red">
          The contacts could not be read. {describeApiError(contacts.error)}
        </p>
      )}
      {contacts.data && rows.length === 0 && !adding && (
        <p className="rounded-card border border-line-soft bg-paper p-3 text-sm text-ink-secondary">
          Nobody is recorded here yet. Until somebody is, ASAP has no address to prepare anything
          to.
        </p>
      )}

      {rows.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {rows.map((p) => (
            <li
              key={p.id}
              className="flex flex-wrap items-baseline gap-2 rounded-card border border-line-strong bg-paper px-3 py-2 text-sm"
            >
              <span className="font-medium text-ink">{p.fullName}</span>
              {p.isPrimary && (
                <span className="rounded-pill bg-accent-green-soft px-2 py-0.5 text-xs text-accent-green-ink">
                  Main contact
                </span>
              )}
              {p.roleLabel && <span className="text-xs text-ink-muted">{p.roleLabel}</span>}
              <span className="ml-auto text-xs text-ink-secondary">
                {p.email ?? p.phone ?? "no address or number on file"}
              </span>
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <form
          aria-label="Add a person"
          className="flex flex-col gap-2 rounded-card border border-line-strong bg-paper p-3"
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            const value = (k: string) => String(form.get(k) ?? "").trim();
            create.mutate({
              clientId,
              fullName: value("fullName"),
              roleLabel: value("roleLabel") || null,
              email: value("email") || null,
              phone: value("phone") || null,
              // The first person recorded is the one to write to, without anybody being asked.
              isPrimary: rows.length === 0 || form.get("isPrimary") === "on",
            });
          }}
        >
          <Field id="c-name" label="Name">
            <input id="c-name" name="fullName" required maxLength={200} className={INPUT} />
          </Field>
          <Field id="c-role" label="What they do (optional)">
            <input
              id="c-role"
              name="roleLabel"
              maxLength={120}
              placeholder="Finance, Claims, Director…"
              className={INPUT}
            />
          </Field>
          <Field id="c-email" label="Email (optional)">
            <input id="c-email" name="email" type="email" maxLength={320} className={INPUT} />
          </Field>
          <Field id="c-phone" label="Phone (optional)">
            <input id="c-phone" name="phone" maxLength={40} className={INPUT} />
          </Field>
          {rows.length > 0 && (
            <label className="flex items-center gap-2 text-xs text-ink-secondary">
              <input type="checkbox" name="isPrimary" />
              Make this the main contact
            </label>
          )}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={create.isPending}
              className="rounded-control bg-navy px-3 py-1.5 text-sm text-paper hover:bg-navy-hover"
            >
              {create.isPending ? "Saving…" : "Save"}
            </button>
          </div>
          {create.isError && (
            <p role="alert" className="text-sm text-accent-red">
              Nothing was saved. {describeApiError(create.error)}
            </p>
          )}
        </form>
      )}
    </section>
  );
}

const INPUT =
  "min-h-[38px] rounded-control border border-line-strong bg-paper px-3 text-sm text-ink";

function Field({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs uppercase tracking-wide text-ink-muted">
        {label}
      </label>
      {children}
    </div>
  );
}
