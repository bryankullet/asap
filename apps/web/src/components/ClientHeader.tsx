import type { ClientRow, FileStatus as FileStatusValue } from "@asap/schema";
import { Link } from "@tanstack/react-router";
import { FileStatus, SlotProvider } from "./status/slots.js";

/** The one place a client's file status is shown outside /files (UI Build Spec Part 2.3). */
export function ClientHeader({
  client,
  status,
}: {
  client: Pick<ClientRow, "id" | "name" | "kind">;
  status: FileStatusValue;
}) {
  return (
    <SlotProvider slot="ClientHeader">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold text-ink">
          <Link to="/files/$clientId" params={{ clientId: client.id }} className="hover:underline">
            {client.name}
          </Link>
        </h1>
        <span className="text-sm text-ink-muted">
          {client.kind === "corporate" ? "Company" : "Individual"}
        </span>
        <span className="text-sm text-ink-secondary">Client file</span>
        <FileStatus status={status} />
      </header>
    </SlotProvider>
  );
}
