import { K01View, K01_VIEW_LABELS } from "@asap/schema";
import { Button, Input } from "@asap/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { EmptyState, ErrorState, LoadingList } from "../components/states.js";
import { FilesView } from "../views/FilesView.js";
import { api, describeApiError } from "../lib/api.js";
import { useMe } from "../lib/me.js";

export function Files() {
  const { view } = useSearch({ strict: false }) as { view?: K01View };
  const current = K01View.catch("blocking").parse(view);
  const me = useMe();
  const org = me.data?.active_organization;
  const q = useQuery({
    queryKey: ["client_files", org?.id, current],
    queryFn: () => api.clientFiles(current),
    enabled: Boolean(org),
  });
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"individual" | "corporate">("individual");
  const create = useMutation({
    mutationFn: () => api.createClient({ name, kind }),
    onSuccess: (file) => {
      void qc.invalidateQueries({ queryKey: ["client_files"] });
      void navigate({ to: "/files/$clientId", params: { clientId: file.client.id } });
    },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    if (name.trim()) create.mutate();
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-2xl font-semibold text-ink">Client files</h1>
        <p className="text-sm text-ink-muted">
          Every client lands as Not started. Clearing is a person's decision with a reason.
        </p>
      </div>
      <nav aria-label="Client file views" className="flex flex-wrap gap-2">
        {K01View.options.map((v) => (
          <Link
            key={v}
            to="/files"
            search={{ view: v }}
            aria-current={v === current ? "page" : undefined}
            className={
              v === current
                ? "rounded-pill bg-ink px-3 py-1 text-sm text-paper"
                : "rounded-pill bg-paper px-3 py-1 text-sm text-ink-secondary hover:text-ink"
            }
          >
            {K01_VIEW_LABELS[v]}
            {q.data ? ` · ${q.data.counts[v]}` : ""}
          </Link>
        ))}
      </nav>
      {!org ? (
        <EmptyState scope="your brokerage" />
      ) : q.isPending ? (
        <LoadingList label="Loading client files" />
      ) : q.isError ? (
        <ErrorState what="Client files could not load" retry={() => void q.refetch()} />
      ) : (
        <FilesView data={q.data} />
      )}
      <form
        onSubmit={submit}
        className="flex flex-wrap items-end gap-2 rounded-card bg-paper p-4 shadow-card"
      >
        <label className="flex flex-col gap-1 text-sm">
          New client
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Kind
          <select
            className="rounded-control border border-line-strong bg-paper px-3 py-2 text-sm"
            value={kind}
            onChange={(e) => setKind(e.target.value as typeof kind)}
          >
            <option value="individual">Individual</option>
            <option value="corporate">Company</option>
          </select>
        </label>
        <Button type="submit" size="sm" variant="outline" disabled={create.isPending}>
          Add (lands as Not started)
        </Button>
        {create.isError && (
          <span className="text-sm text-accent-red">{describeApiError(create.error)}</span>
        )}
      </form>
    </div>
  );
}
