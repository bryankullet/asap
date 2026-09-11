import type { CreateWorkItemInput, CreateWorkItemResponse } from "@asap/schema";
import { useMutation } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { api, describeApiError } from "../lib/api.js";

/**
 * Starting real work (D-067).
 *
 * Three kinds, because three kinds are what the engine can actually start: a renewal, a claim, an
 * endorsement. Each opens a record whose steps, evidence and guards come from its recipe, and the
 * work then runs on the record — this screen's whole job is to get a person there.
 *
 * What it will not do:
 *
 *  - **It never creates a client.** Ask and this screen both refuse to (D-050): a client is a
 *    record with a file, duplicates and a compliance state, and conjuring one to satisfy a form is
 *    how two Acmes end up in a brokerage's book. If the name matches nothing, it says so and sends
 *    the person to the client path, where duplicates are reviewed.
 *  - **It never guesses which client.** Several matches is a question, not a coin toss.
 *  - **It never opens a second item for work that is already open.** The server returns the
 *    existing one and says it did.
 */
const KINDS = [
  {
    id: "renewal" as const,
    label: "A renewal",
    hint: "A period of cover coming to its end. ASAP checks the file, prepares the pack and asks the insurers.",
  },
  {
    id: "claim" as const,
    label: "A claim",
    hint: "An incident to notify and track. It stays a draft until a person registers it.",
  },
  {
    id: "endorsement" as const,
    label: "A change to a policy",
    hint: "A vehicle, an address, a sum insured. The insurer's answer writes a new policy version.",
  },
];

export function StartWork() {
  const navigate = useNavigate();
  const [kind, setKind] = useState<(typeof KINDS)[number]["id"]>("renewal");
  const [clientName, setClientName] = useState("");
  const [insurers, setInsurers] = useState("");
  const [incidentOn, setIncidentOn] = useState("");
  const [incidentSummary, setIncidentSummary] = useState("");
  const [requestText, setRequestText] = useState("");
  const [effectiveOn, setEffectiveOn] = useState("");
  const [outcome, setOutcome] = useState<CreateWorkItemResponse | null>(null);

  const create = useMutation({
    mutationFn: (input: CreateWorkItemInput) => api.createWorkItem(input),
    onSuccess: (res) => {
      setOutcome(res);
      // Opened — including reopened — is the only outcome that leads anywhere on its own.
      if (res.outcome === "opened") {
        void navigate({ to: "/r/$recordId", params: { recordId: res.item.id } });
      }
    },
  });

  function submit(clientId?: string) {
    const base = clientId ? { clientId } : { clientName: clientName.trim() };
    if (kind === "renewal") {
      create.mutate({
        kind,
        ...base,
        insurers: insurers
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      });
      return;
    }
    if (kind === "claim") {
      create.mutate({
        kind,
        ...base,
        incidentOn,
        incidentSummary: incidentSummary.trim(),
        source: "manual",
      });
      return;
    }
    create.mutate({
      kind,
      ...base,
      requestText: requestText.trim(),
      requestedBy: "policyholder",
      ...(effectiveOn ? { effectiveOn } : {}),
    });
  }

  const chosen = KINDS.find((k) => k.id === kind)!;

  return (
    <section className="page-scroll spaces-page">
      <div className="welcome-row">
        <div>
          <div className="eyebrow">START SOMETHING</div>
          <h2>What are we working on?</h2>
        </div>
        <Link to="/ask" className="ask-floating">
          ✦ Ask ASAP
        </Link>
      </div>

      <article className="space-card">
        <div className="space-head">
          <div className="space-type">
            <span>NEW WORK</span>
          </div>
          <h2>{chosen.label}</h2>
          <p>{chosen.hint}</p>
        </div>
        <div className="space-body">
          <nav className="tab-row" aria-label="What kind of work">
            {KINDS.map((k) => (
              <button
                key={k.id}
                type="button"
                className={`tab ${k.id === kind ? "selected" : ""}`}
                aria-current={k.id === kind ? "true" : undefined}
                onClick={() => {
                  setKind(k.id);
                  setOutcome(null);
                }}
              >
                {k.label}
              </button>
            ))}
          </nav>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              setOutcome(null);
              submit();
            }}
          >
            <div className="form-row">
              <label htmlFor="sw-client">WHICH CLIENT?</label>
              <input
                id="sw-client"
                required
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="The client's name as you would say it"
              />
            </div>

            {kind === "renewal" && (
              <div className="form-row">
                <label htmlFor="sw-insurers">WHICH INSURERS SHOULD WE ASK? (OPTIONAL)</label>
                <input
                  id="sw-insurers"
                  value={insurers}
                  onChange={(e) => setInsurers(e.target.value)}
                  placeholder="Jubilee, APA"
                />
                <small>
                  Leave it empty and ASAP asks you at the step, rather than choosing for you.
                </small>
              </div>
            )}

            {kind === "claim" && (
              <>
                <div className="form-row">
                  <label htmlFor="sw-date">WHEN DID IT HAPPEN?</label>
                  <input
                    id="sw-date"
                    type="date"
                    required
                    value={incidentOn}
                    onChange={(e) => setIncidentOn(e.target.value)}
                  />
                </div>
                <div className="form-row">
                  <label htmlFor="sw-summary">WHAT DID THE CLIENT SAY?</label>
                  <textarea
                    id="sw-summary"
                    required
                    rows={3}
                    value={incidentSummary}
                    onChange={(e) => setIncidentSummary(e.target.value)}
                    placeholder="In their words, not a classification"
                  />
                </div>
              </>
            )}

            {kind === "endorsement" && (
              <>
                <div className="form-row">
                  <label htmlFor="sw-request">WHAT ARE THEY ASKING FOR?</label>
                  <textarea
                    id="sw-request"
                    required
                    rows={3}
                    value={requestText}
                    onChange={(e) => setRequestText(e.target.value)}
                    placeholder="Add KDN 482Q to the fleet from 1 October"
                  />
                </div>
                <div className="form-row">
                  <label htmlFor="sw-effective">FROM WHEN? (OPTIONAL)</label>
                  <input
                    id="sw-effective"
                    type="date"
                    value={effectiveOn}
                    onChange={(e) => setEffectiveOn(e.target.value)}
                  />
                </div>
              </>
            )}

            <div className="actions">
              <button type="submit" className="primary" disabled={create.isPending}>
                {create.isPending ? "Opening…" : "Open the work"}
              </button>
            </div>
          </form>

          {create.isError && (
            <div className="warning">
              <strong>That did not open:</strong> {describeApiError(create.error)}
            </div>
          )}

          {outcome && <Outcome outcome={outcome} onChoose={(id) => submit(id)} />}
        </div>
      </article>
    </section>
  );
}

/**
 * What the server said, when it did not simply open something.
 *
 * Each of these is a real answer rather than a failure: a name that matches two clients is a
 * question, and a name that matches none is a different piece of work.
 */
function Outcome({
  outcome,
  onChoose,
}: {
  outcome: CreateWorkItemResponse;
  onChoose: (clientId: string) => void;
}) {
  if (outcome.outcome === "opened") {
    return (
      <div className="warning">
        {outcome.reopened
          ? "This work was already open, so ASAP opened it rather than starting a second one."
          : "Opened."}
      </div>
    );
  }

  if (outcome.outcome === "ambiguous") {
    return (
      <>
        <div className="section-label">Which {outcome.name}?</div>
        {outcome.candidates.map((c) => (
          <div className="issue" key={c.id}>
            <span className="sev" aria-hidden />
            <div>
              <h4>{c.kind === "corporate" ? "Company" : "Person"}</h4>
              <p>{c.name}</p>
            </div>
            <button type="button" className="secondary" onClick={() => onChoose(c.id)}>
              This one
            </button>
          </div>
        ))}
      </>
    );
  }

  if (outcome.outcome === "no_client") {
    return (
      <div className="warning">
        <strong>No client on file called “{outcome.name}”.</strong> ASAP does not create clients
        from a form — a client carries a file, duplicates and a compliance state. Create it where
        those are reviewed, then start this work again.
        <div className="actions">
          <Link to="/files" search={{ view: "blocking" }} className="secondary">
            Open client files
          </Link>
        </div>
      </div>
    );
  }

  if (outcome.outcome === "ambiguous_policy") {
    return (
      <>
        <div className="section-label">Which policy is this change to?</div>
        {outcome.candidates.map((c) => (
          <div className="issue" key={c.id}>
            <span className="sev" aria-hidden />
            <div>
              <h4>Policy</h4>
              <p>{c.label}</p>
            </div>
          </div>
        ))}
        <small className="disclaimer">
          Open the policy and start the change there, so it is recorded against the right one.
        </small>
      </>
    );
  }

  return (
    <div className="warning">
      <strong>No policy on file for that client.</strong> A change is a change to something:
      record the policy first, and nothing has been created here.
    </div>
  );
}
