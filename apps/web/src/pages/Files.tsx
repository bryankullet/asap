import { K01View, K01_VIEW_LABELS } from "@asap/schema";
import { Button, Card, Field, Input, Notice, PageHead, Select, cn } from "@asap/ui";
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
  const [duplicates, setDuplicates] = useState<{ id: string; name: string }[] | null>(null);
  const create = useMutation({
    mutationFn: (confirmNew: boolean) => api.createClient({ name, kind, confirmNew }),
    onSuccess: (res) => {
      if (res.outcome === "possible_duplicates") {
        setDuplicates(res.candidates);
        return;
      }
      setDuplicates(null);
      void qc.invalidateQueries({ queryKey: ["client_files"] });
      void navigate({ to: "/files/$clientId", params: { clientId: res.file.client.id } });
    },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    if (name.trim()) create.mutate(false);
  }
  return (
    <div>
      <PageHead
        title="Client files"
        description="Every client lands as Not started. Clearing is a person's decision with a reason."
      />
      <div className="flex flex-col gap-4">
        <nav aria-label="Client file views" className="flex flex-wrap gap-2">
          {K01View.options.map((v) => (
            <Link
              key={v}
              to="/files"
              search={{ view: v }}
              aria-current={v === current ? "page" : undefined}
              className={cn(
                "inline-flex items-center gap-2 rounded-pill px-3 py-2 text-sm font-semibold transition",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-green focus-visible:ring-offset-1",
                "motion-reduce:transition-none",
                v === current
                  ? "border border-transparent bg-navy text-paper"
                  : "border border-line-strong bg-paper text-ink hover:border-line-hover",
              )}
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
        <Card>
          <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
            <Field label="New client" htmlFor="new-client-name" className="min-w-[200px] flex-1">
              <Input
                id="new-client-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name"
              />
            </Field>
            <Field label="Kind" htmlFor="new-client-kind" className="w-40">
              <Select
                id="new-client-kind"
                value={kind}
                onChange={(e) => setKind(e.target.value as typeof kind)}
              >
                <option value="individual">Individual</option>
                <option value="corporate">Company</option>
              </Select>
            </Field>
            <Button type="submit" size="compact" variant="outline" disabled={create.isPending}>
              Add (lands as Not started)
            </Button>
            {create.isError && (
              <Notice tone="error" className="w-full">
                {describeApiError(create.error)}
              </Notice>
            )}
            {duplicates && (
              <div
                className="flex w-full flex-col gap-2 border-t border-line-soft pt-3 text-sm"
                aria-live="polite"
              >
                <p className="text-ink-secondary">Possibly already on file:</p>
                {duplicates.map((d) => (
                  <Link
                    key={d.id}
                    to="/files/$clientId"
                    params={{ clientId: d.id }}
                    className="font-semibold text-ink underline underline-offset-2"
                  >
                    Use {d.name}
                  </Link>
                ))}
                <Button
                  type="button"
                  size="compact"
                  variant="destructive"
                  className="self-start"
                  disabled={create.isPending}
                  onClick={() => create.mutate(true)}
                >
                  Create separately
                </Button>
              </div>
            )}
          </form>
        </Card>
      </div>
    </div>
  );
}
