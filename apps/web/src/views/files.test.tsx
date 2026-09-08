/**
 * K01/K02 (Screen Map v3 Part 4.1): a not-started client is listed with "nothing on file";
 * the file says it cannot be screened yet and why; the file status word appears only in the
 * client header / files screens (Part 2.3).
 */
import type { ClientFileResponse, ClientFilesResponse } from "@asap/schema";
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderInRouter } from "../test-utils.js";
import { ClientFileView } from "../views/ClientFileView.js";
import { FilesView } from "../views/FilesView.js";

const NOW = new Date().toISOString();
const client = {
  id: "70000000-0000-4000-8000-00000000000a",
  organization_id: "10000000-0000-4000-8000-00000000000a",
  name: "Acme Motors",
  kind: "corporate" as const,
  source: "imported" as const,
  file_status: "not_started" as const,
  file_owner_id: null,
  file_decided_by: null,
  file_decided_at: null,
  file_decision_reason: null,
  refresh_interval_days: null,
  refresh_due_at: null,
  created_at: NOW,
  updated_at: NOW,
  deleted_at: null,
};

describe("K01 client files register", () => {
  it("lists an imported client as Not started with nothing on file and what it blocks", async () => {
    const data: ClientFilesResponse = {
      view: "blocking",
      counts: { blocking: 1, incomplete: 0, refresh_due: 0, cleared: 0, not_started: 1 },
      items: [
        {
          client,
          effective_status: "not_started",
          documents_held: 0,
          in_state_since: NOW,
          blocking: [
            {
              id: "30000000-0000-4000-8000-000000000005",
              title: "Acme Motors — Motor commercial placement with Jubilee",
              step: "Placement approved",
            },
          ],
        },
      ],
    };
    await renderInRouter(<FilesView data={data} />, "/files");
    expect(screen.getByText("Not started")).toHaveAttribute("data-layer", "file");
    expect(screen.getByText(/Nothing on file/)).toBeInTheDocument();
    expect(screen.getByText(/Blocking:/)).toBeInTheDocument();
  });
});

describe("K02 a client's file", () => {
  it("says the file cannot be screened yet, with the reason, and never clears by itself", async () => {
    const file: ClientFileResponse = {
      client,
      effective_status: "not_started",
      documents: [],
      blocking: [],
      screening: {
        available: false,
        reason: "No screening list is connected. Files can be collected but not screened.",
      },
      missing: ["An identity document received", "A beneficial ownership declaration received"],
    };
    const onAct = vi.fn();
    await renderInRouter(
      <ClientFileView file={file} onAct={onAct} pending={false} blocked={null} />,
      "/files/x",
    );
    expect(
      screen.getByText(/Cannot be screened yet\. No screening list is connected/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Still needed before clearing/)).toBeInTheDocument();
    expect(screen.getByText(/ASAP never clears a file/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear this file" })).toBeDisabled();
  });
});
