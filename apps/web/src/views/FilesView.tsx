import { K01_VIEW_LABELS, type ClientFilesResponse } from "@asap/schema";
import { Card } from "@asap/ui";
import { Link } from "@tanstack/react-router";
import { FileStatus, SlotProvider } from "../components/status/slots.js";
import { EmptyState } from "../components/states.js";

/** K01 — Client files register. Shown as "Client files"; never a destination. */
export function FilesView({ data }: { data: ClientFilesResponse }) {
  return (
    <SlotProvider slot="FilesScreen">
      <div className="flex flex-col gap-3">
        {data.items.length === 0 ? (
          <EmptyState
            scope={`${K01_VIEW_LABELS[data.view]} client files`}
            freshness="Checked just now."
          />
        ) : (
          data.items.map((i) => (
            <Card key={i.client.id} className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <FileStatus status={i.effective_status} />
                <Link
                  to="/files/$clientId"
                  params={{ clientId: i.client.id }}
                  className="font-semibold text-ink hover:underline"
                >
                  {i.client.name}
                </Link>
                <span className="text-xs text-ink-muted">
                  {i.client.kind === "corporate" ? "Company" : "Individual"} · {i.client.source}
                </span>
              </div>
              <p className="text-sm text-ink-secondary">
                {i.documents_held === 0
                  ? "Nothing on file."
                  : `${i.documents_held} document${i.documents_held === 1 ? "" : "s"} received.`}{" "}
                In this state since{" "}
                {new Date(i.in_state_since).toLocaleDateString("en-KE", {
                  day: "numeric",
                  month: "short",
                })}
                .
              </p>
              {i.blocking.length > 0 && (
                <ul className="text-sm text-accent-red">
                  {i.blocking.map((b) => (
                    <li key={b.id}>
                      Blocking:{" "}
                      <Link to="/r/$recordId" params={{ recordId: b.id }} className="underline">
                        {b.title}
                      </Link>{" "}
                      at {b.step}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ))
        )}
      </div>
    </SlotProvider>
  );
}
