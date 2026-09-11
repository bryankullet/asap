/**
 * Ask's answer states.
 *
 * The rule these pin: Ask never shows a confident blank. Whatever came back — an answer, an
 * abstention, no model configured, a model that could not be reached — a person can read what
 * happened and what it means for what they were doing.
 */
import type { AskResponseV2 } from "@asap/schema";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderInRouter } from "../test-utils.js";
import { AskThread } from "./AskThread.js";

const RECORD = "20000000-0000-4000-8000-00000000000a";

const message = (over: Record<string, unknown> = {}) => ({
  id: "30000000-0000-4000-8000-000000000001",
  conversation_id: "30000000-0000-4000-8000-000000000002",
  organization_id: "10000000-0000-4000-8000-00000000000a",
  seq: 1,
  role: "asap" as const,
  body: "Terms were requested from Jubilee and the reply is still outstanding.",
  intent: null,
  tools_used: [],
  citations: [],
  abstained: null,
  served_by: "fake:fake-deterministic",
  created_at: "2026-09-11T00:00:00.000Z",
  ...over,
});

const response = (over: Partial<AskResponseV2>): AskResponseV2 =>
  ({
    state: "answered",
    conversationId: "30000000-0000-4000-8000-000000000002",
    scope: { kind: "brokerage", id: null, label: "Acme Insurance Brokers" },
    message: message(),
    planRecordId: null,
    planView: null,
    clarify: null,
    suggestions: [],
    ...over,
  }) as AskResponseV2;

const turn = (r: AskResponseV2) => [{ question: "What is Jubilee waiting on?", response: r }];

describe("Ask answer states", () => {
  it("shows the answer and a way into the record it is about", async () => {
    await renderInRouter(
      <AskThread turns={turn(response({ planRecordId: RECORD }))} pending={false} />,
    );
    expect(screen.getByText(/reply is still outstanding/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the work" })).toBeInTheDocument();
  });

  it("lists what an answer was read from, and says when a citation has no page", async () => {
    const cited = response({
      message: message({
        citations: [
          {
            label: "Terms from Jubilee: QS-1182",
            recordId: RECORD,
            recordKind: "work_item",
            reference: "QS-1182",
            page: null,
          },
        ],
      }),
    });
    await renderInRouter(<AskThread turns={turn(cited)} pending={false} />);
    expect(screen.getByText("Read from 1 source")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /QS-1182/ })).toBeInTheDocument();
    expect(screen.getByText(/no page reference on file/)).toBeInTheDocument();
  });

  it("says what was missing instead of showing an empty answer", async () => {
    const abstained = response({
      state: "abstained",
      message: message({
        body: "ASAP found nothing on file that answers this.",
        abstained: {
          reason: "ASAP found nothing on file that answers this.",
          missing: ["a policy period covering 2 September"],
        },
      }),
    });
    await renderInRouter(<AskThread turns={turn(abstained)} pending={false} />);
    expect(screen.getByText("ASAP did not answer this")).toBeInTheDocument();
    expect(screen.getByText("a policy period covering 2 September")).toBeInTheDocument();
  });

  it("names a missing model as configuration, and names nothing about the provider", async () => {
    const notConfigured = response({ state: "not_configured", message: null });
    const { container } = await renderInRouter(
      <AskThread turns={turn(notConfigured)} pending={false} />,
    );
    expect(screen.getByText("No model is connected")).toBeInTheDocument();
    // Never a provider name, a model name or a key. The browser is told a model is missing, not
    // which one it would have been (§45 rule 4).
    const text = container.textContent ?? "";
    for (const leak of ["openai", "anthropic", "api key", "sk-", "gpt", "claude"]) {
      expect(text.toLowerCase()).not.toContain(leak);
    }
  });

  it("offers to ask again when the model could not be reached, and changes nothing by itself", async () => {
    let retried = 0;
    await renderInRouter(
      <AskThread
        turns={turn(response({ state: "unavailable", message: null }))}
        pending={false}
        onRetry={() => {
          retried += 1;
        }}
      />,
    );
    expect(screen.getByText(/could not reach the model/i)).toBeInTheDocument();
    expect(screen.getByText(/Nothing was changed/)).toBeInTheDocument();
    screen.getByRole("button", { name: "Ask again" }).click();
    expect(retried).toBe(1);
  });

  it("says ASAP is working, rather than showing an empty box", async () => {
    await renderInRouter(
      <AskThread turns={[{ question: "What is Jubilee waiting on?", response: null }]} pending />,
    );
    expect(screen.getByText(/reading the records behind this/)).toBeInTheDocument();
  });
});
