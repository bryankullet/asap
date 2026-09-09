/**
 * Phase 5a screens: the three settlement facts are three rows; call notes are labelled as ours;
 * the clock says why it is not running; cover copy never says "is covered"; a rejected item is
 * visible on the policy as not covered; a transfer from someone else shows why it is blocked.
 */
import {
  CLAIM_BANNED_PHRASES,
  type ClaimDetail,
  type EndorsementDetail,
  type PolicyResponse,
} from "@asap/schema";
import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderInRouter } from "../test-utils.js";
import { ClaimPanel } from "./ClaimPanel.js";
import { EndorsementPanel } from "./EndorsementPanel.js";
import { PolicyView } from "./PolicyView.js";

const NOW = "2026-09-10T10:00:00.000Z";
const ORG = "10000000-0000-4000-8000-00000000000a";
const claim: ClaimDetail["claim"] = {
  id: "a0000000-0000-4000-8000-00000000c1a1",
  organization_id: ORG,
  work_item_id: "30000000-0000-4000-8000-000000000050",
  client_id: "70000000-0000-4000-8000-00000000000b",
  policy_id: null,
  policy_period_id: null,
  status: "draft",
  source: "email",
  incident_on: "2026-09-01",
  incident_summary: "Rear-ended at Uhuru Highway",
  reported_on: null,
  insurer_reference: null,
  cover_review:
    "Cover on 2026-09-01 looks right: Motor private with Jubilee, version 1 was effective. This is a review, not the insurer's decision.",
  cover_review_version_id: null,
  clock_clause_reference: null,
  clock_clause_page: null,
  clock_clause_days: null,
  clock_start_event: null,
  clock_start_on: null,
  clock_start_evidence: null,
  offer_reference: "Discharge voucher DV-118",
  offer_recorded_at: NOW,
  acceptance_reference: null,
  acceptance_recorded_at: null,
  payment_reference: null,
  payment_recorded_at: null,
  registered_by: null,
  registered_at: null,
  created_at: NOW,
  updated_at: NOW,
};

describe("claim panel", () => {
  it("shows three separate settlement rows, the clock's reason, labelled call notes, and review wording only", async () => {
    const detail: ClaimDetail = {
      claim,
      documents: [
        {
          id: "d1",
          organization_id: ORG,
          claim_id: claim.id,
          label: "Police abstract",
          holder: "police",
          reference: null,
          requested_at: NOW,
          received_at: null,
          created_at: NOW,
        },
      ],
      notes: [
        {
          id: "n1",
          organization_id: ORG,
          claim_id: claim.id,
          kind: "call_note",
          spoke_with: "Mercy at Jubilee",
          body: "Assessor visits Thursday",
          noted_by: null,
          noted_at: NOW,
        },
      ],
      clock: {
        started: false,
        reason:
          "Clock not started: needs a wording clause with its page and the number of days and a verified start event with its date and evidence.",
      },
      candidatePeriods: [],
    };
    const { container } = await renderInRouter(
      <ClaimPanel detail={detail} onAct={vi.fn()} pending={false} />,
      "/r/x",
    );
    expect(screen.getByText("Settlement offered")).toBeInTheDocument();
    expect(screen.getByText("Client accepted")).toBeInTheDocument();
    expect(screen.getByText("Payment received")).toBeInTheDocument();
    expect(screen.getAllByText("Not recorded")).toHaveLength(2);
    expect(screen.getByText(/Clock not started: needs a wording clause/)).toBeInTheDocument();
    expect(screen.getByText(/Never the insurer's words/)).toBeInTheDocument();
    expect(screen.getByText(/Call with Mercy at Jubilee/)).toBeInTheDocument();
    expect(screen.getByText(/outstanding, with the police/)).toBeInTheDocument();
    expect(
      screen.getByText(/Draft claim captured from email — not registered/),
    ).toBeInTheDocument();
    for (const banned of CLAIM_BANNED_PHRASES)
      expect(container.textContent ?? "").not.toMatch(banned);
    expect(container.innerHTML).not.toMatch(/\bsettled\b/i);
  });
});

describe("policy view", () => {
  it("keeps every version and shows a rejected item as not covered", async () => {
    const data: PolicyResponse = {
      policy: {
        id: "90000000-0000-4000-8000-00000000000a",
        organization_id: ORG,
        client_id: "c",
        insurer_id: "i",
        class_of_business: "Motor commercial",
        policy_number: "JUB/MC/2026/0142",
        created_at: NOW,
        updated_at: NOW,
        deleted_at: null,
      },
      clientName: "Acme Motors",
      insurerName: "Jubilee",
      periods: [
        {
          id: "p",
          organization_id: ORG,
          policy_id: "90000000-0000-4000-8000-00000000000a",
          period_start: "2026-01-01",
          period_end: "2026-12-31",
          created_at: NOW,
        },
      ],
      versions: [
        {
          id: "v1",
          organization_id: ORG,
          policy_id: "90000000-0000-4000-8000-00000000000a",
          version: 1,
          effective_from: "2026-01-01",
          effective_to: "2026-09-30",
          source: "seed",
          endorsement_id: null,
          created_by: null,
          created_at: NOW,
          items: [
            {
              id: "a",
              label: "KDA 482A",
              sumInsuredMinor: 350000000,
              covered: true,
              status: "in_force",
              note: null,
            },
          ],
        },
        {
          id: "v2",
          organization_id: ORG,
          policy_id: "90000000-0000-4000-8000-00000000000a",
          version: 2,
          effective_from: "2026-10-01",
          effective_to: null,
          source: "endorsement",
          endorsement_id: null,
          created_by: null,
          created_at: NOW,
          items: [
            {
              id: "a",
              label: "KDA 482A",
              sumInsuredMinor: 350000000,
              covered: true,
              status: "in_force",
              note: null,
            },
            {
              id: "rejected:b",
              label: "KDD 111A",
              sumInsuredMinor: 180000000,
              covered: false,
              status: "rejected_by_insurer",
              note: "Vehicle age above the insurer's limit",
            },
          ],
        },
      ],
    };
    await renderInRouter(<PolicyView data={data} today="2026-10-05" />, "/r/x");
    expect(
      screen.getByText(/Version 2 · from 2026-10-01 · current · from an endorsement/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Version 1 · from 2026-01-01 to 2026-09-30/)).toBeInTheDocument();
    const rejected = screen.getByText("KDD 111A");
    expect(
      within(rejected.parentElement!).getByText("Not covered — rejected by the insurer"),
    ).toBeInTheDocument();
  });
});

describe("endorsement panel", () => {
  it("says why a transfer from someone else is blocked, and shows each item's own decision", async () => {
    const detail: EndorsementDetail = {
      endorsement: {
        id: "b0000000-0000-4000-8000-00000000e1e1",
        organization_id: ORG,
        work_item_id: "w",
        policy_id: "90000000-0000-4000-8000-00000000000a",
        kind: "transfer_ownership",
        requested_by: "other",
        requested_by_name: "Peter Kamau (buyer)",
        request_text: "Transfer KCB 100X to me",
        effective_on: "2026-11-01",
        instruction_reference: null,
        instruction_from: null,
        response_reference: null,
        items: [
          {
            id: "1",
            label: "KCB 100X",
            before: "Acme Motors",
            after: "Peter Kamau",
            sumInsuredMinor: null,
            decision: "accepted",
            note: null,
          },
          {
            id: "2",
            label: "KDD 111A",
            before: null,
            after: "Add",
            sumInsuredMinor: 180000000,
            decision: "rejected",
            note: "Too old",
          },
        ],
        applied_version_id: null,
        created_by: null,
        created_at: NOW,
        updated_at: NOW,
      },
      policy: {
        id: "90000000-0000-4000-8000-00000000000a",
        organization_id: ORG,
        client_id: "c",
        insurer_id: "i",
        class_of_business: "Motor commercial",
        policy_number: null,
        created_at: NOW,
        updated_at: NOW,
        deleted_at: null,
      },
      versions: [],
      missing: ["the policyholder's own instruction"],
    };
    await renderInRouter(
      <EndorsementPanel detail={detail} onAct={vi.fn()} pending={false} />,
      "/r/x",
    );
    expect(
      screen.getByText(
        /Transfer of ownership needs the policyholder's own instruction. This request came from Peter Kamau \(buyer\); it is recorded, not acted on/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Accepted by the insurer")).toBeInTheDocument();
    expect(screen.getByText("Rejected by the insurer")).toBeInTheDocument();
  });
});
