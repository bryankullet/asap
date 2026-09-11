import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api } from "../lib/api.js";

/**
 * A personal marker on a record (0033).
 *
 * It says "I am coming back to this", and that is all it says. Pinning changes nothing about the
 * record — no step, no guard, no status — and it moves nothing in Discover, whose order is
 * computed from signals and is not for sale to a marker. Nobody else sees it.
 *
 * There is deliberately no Pinned destination. A person finds their pins where the marker lives:
 * on the record, and in the small list beside it.
 */
export function PinButton({ recordId }: { recordId: string }) {
  const qc = useQueryClient();
  const pins = useQuery({ queryKey: ["pins"], queryFn: api.pins });
  const pinned = pins.data?.pins.some((p) => p.workItemId === recordId) ?? false;

  const toggle = useMutation({
    mutationFn: () => api.setPin(recordId, { pinned: !pinned, note: null }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["pins"] }),
  });

  return (
    <button
      type="button"
      onClick={() => toggle.mutate()}
      disabled={pins.isPending || toggle.isPending}
      aria-pressed={pinned}
      className="inline-flex items-center gap-1.5 rounded-pill border border-line-strong px-3 py-1 text-sm text-ink-secondary hover:border-ink-muted disabled:opacity-60"
    >
      <span aria-hidden>{pinned ? "★" : "☆"}</span>
      {pinned ? "Kept" : "Keep this"}
      {toggle.isError && <span className="text-accent-red">· could not save</span>}
    </button>
  );
}

/** The pins themselves, shown where a person is already looking rather than behind a tab. */
export function PinList() {
  const pins = useQuery({ queryKey: ["pins"], queryFn: api.pins });
  if (pins.isPending || (pins.data?.pins.length ?? 0) === 0) return null;
  return (
    <section aria-labelledby="kept-heading" className="flex flex-col gap-1">
      <h2 id="kept-heading" className="text-xs font-medium text-ink-muted">
        Kept by you
      </h2>
      <ul className="flex flex-col gap-1">
        {pins.data?.pins.map((p) => (
          <li key={p.workItemId}>
            <Link
              to="/r/$recordId"
              params={{ recordId: p.workItemId }}
              className="text-sm text-ink hover:underline"
            >
              {p.title}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
