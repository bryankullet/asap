import type {
  CreateClientResponse,
  CreatePolicyInput,
  CreatePolicyResponse,
  CreateWorkItemInput,
  CreateWorkItemResponse,
} from "@asap/schema";
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
    id: "client" as const,
    label: "A client",
    hint: "Someone the brokerage acts for. ASAP never creates one on its own, and checks for a name you already have before it creates another.",
  },
  {
    id: "policy" as const,
    label: "Cover you already place",
    hint: "A policy that exists: who it is for, who carries it, and the period. Not a premium and not a schedule — those arrive with their evidence.",
  },
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
  const [clientKind, setClientKind] = useState<"corporate" | "individual">("corporate");
  const [insurerName, setInsurerName] = useState("");
  const [classOfBusiness, setClassOfBusiness] = useState("");
  const [policyNumber, setPolicyNumber] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [clientOutcome, setClientOutcome] = useState<CreateClientResponse | null>(null);
  const [policyOutcome, setPolicyOutcome] = useState<CreatePolicyResponse | null>(null);
  const [clientName, setClientName] = useState("");
  const [insurers, setInsurers] = useState("");
  const [incidentOn, setIncidentOn] = useState("");
  const [incidentSummary, setIncidentSummary] = useState("");
  const [requestText, setRequestText] = useState("");
  const [effectiveOn, setEffectiveOn] = useState("");
  const [outcome, setOutcome] = useState<CreateWorkItemResponse | null>(null);

  /** A client. The duplicate review is the server's; this only carries the person's answer back. */
  const createClient = useMutation({
    mutationFn: (input: { name: string; kind: "corporate" | "individual"; confirmNew: boolean }) =>
      api.createClient(input),
    onSuccess: (res) => {
      setClientOutcome(res);
      if (res.outcome === "created") {
        void navigate({ to: "/files/$clientId", params: { clientId: res.file.client.id } });
      }
    },
  });

  /** Cover the brokerage already places. */
  const createPolicy = useMutation({
    mutationFn: (input: CreatePolicyInput) => api.createPolicy(input),
    onSuccess: (res) => {
      setPolicyOutcome(res);
      if (res.outcome === "recorded") {
        void navigate({
          to: "/r/$recordId",
          params: { recordId: res.policy.policy.id },
          search: { kind: "policy" },
        });
      }
    },
  });

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

  function submit(clientId?: string, confirmNew = false) {
    const base = clientId ? { clientId } : { clientName: clientName.trim() };
    if (kind === "client") {
      createClient.mutate({ name: clientName.trim(), kind: clientKind, confirmNew });
      return;
    }
    if (kind === "policy") {
      createPolicy.mutate({
        ...base,
        insurerName: insurerName.trim(),
        classOfBusiness: classOfBusiness.trim(),
        ...(policyNumber.trim() ? { policyNumber: policyNumber.trim() } : {}),
        periodStart,
        periodEnd,
      });
      return;
    }
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
              <label htmlFor="sw-client">
                {kind === "client" ? "WHAT IS THE CLIENT CALLED?" : "WHICH CLIENT?"}
              </label>
              <input
                id="sw-client"
                required
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="The client's name as you would say it"
              />
            </div>

            {kind === "client" && (
              <div className="form-row">
                <label htmlFor="sw-client-kind">A COMPANY OR A PERSON?</label>
                <select
                  id="sw-client-kind"
                  value={clientKind}
                  onChange={(e) => setClientKind(e.target.value as "corporate" | "individual")}
                >
                  <option value="corporate">A company</option>
                  <option value="individual">A person</option>
                </select>
              </div>
            )}

            {kind === "policy" && (
              <>
                <div className="form-row">
                  <label htmlFor="sw-insurer">WHICH INSURER CARRIES IT?</label>
                  <input
                    id="sw-insurer"
                    required
                    value={insurerName}
                    onChange={(e) => setInsurerName(e.target.value)}
                    placeholder="Jubilee"
                  />
                  <small>New to your book? Naming it here is how it is added.</small>
                </div>
                <div className="form-row">
                  <label htmlFor="sw-class">WHAT CLASS OF BUSINESS?</label>
                  <input
                    id="sw-class"
                    required
                    value={classOfBusiness}
                    onChange={(e) => setClassOfBusiness(e.target.value)}
                    placeholder="Motor commercial"
                  />
                </div>
                <div className="form-row">
                  <label htmlFor="sw-number">POLICY NUMBER (OPTIONAL)</label>
                  <input
                    id="sw-number"
                    value={policyNumber}
                    onChange={(e) => setPolicyNumber(e.target.value)}
                    placeholder="Leave it empty until the insurer issues one"
                  />
                </div>
                <div className="form-row">
                  <label htmlFor="sw-from">THE PERIOD OF COVER: FROM</label>
                  <input
                    id="sw-from"
                    type="date"
                    required
                    value={periodStart}
                    onChange={(e) => setPeriodStart(e.target.value)}
                  />
                </div>
                <div className="form-row">
                  <label htmlFor="sw-to">TO</label>
                  <input
                    id="sw-to"
                    type="date"
                    required
                    value={periodEnd}
                    onChange={(e) => setPeriodEnd(e.target.value)}
                  />
                </div>
              </>
            )}

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
              <button
                type="submit"
                className="primary"
                disabled={create.isPending || createClient.isPending || createPolicy.isPending}
              >
                {kind === "client"
                  ? createClient.isPending
                    ? "Adding…"
                    : "Add the client"
                  : kind === "policy"
                    ? createPolicy.isPending
                      ? "Recording…"
                      : "Record the cover"
                    : create.isPending
                      ? "Opening…"
                      : "Open the work"}
              </button>
            </div>
          </form>

          {(create.isError || createClient.isError || createPolicy.isError) && (
            <div className="warning">
              <strong>That did not go in:</strong>{" "}
              {describeApiError(create.error ?? createClient.error ?? createPolicy.error)}
            </div>
          )}

          {outcome && <Outcome outcome={outcome} onChoose={(id) => submit(id)} />}
          {clientOutcome?.outcome === "possible_duplicates" && (
            <DuplicateClients
              outcome={clientOutcome}
              onCreateAnyway={() => submit(undefined, true)}
            />
          )}
          {policyOutcome && policyOutcome.outcome !== "recorded" && (
            <PolicyClientAnswer
              outcome={policyOutcome}
              onChoose={(id) => submit(id)}
              onAddClient={() => {
                setKind("client");
                setPolicyOutcome(null);
              }}
            />
          )}
        </div>
      </article>
    </section>
  );
}

/**
 * A name the brokerage may already have.
 *
 * The server checks before it creates, and this is the person's answer to what it found: the same
 * client, or genuinely a different one with a similar name. Two Acmes in a book is a mess that
 * takes months to unpick, so the question is asked once, here, rather than never.
 */
function DuplicateClients({
  outcome,
  onCreateAnyway,
}: {
  outcome: Extract<CreateClientResponse, { outcome: "possible_duplicates" }>;
  onCreateAnyway: () => void;
}) {
  return (
    <>
      <div className="section-label">You may already have this client</div>
      {outcome.candidates.map((c) => (
        <div className="issue" key={c.id}>
          <span className="sev" aria-hidden />
          <div>
            <h4>{c.kind === "corporate" ? "Company" : "Person"}</h4>
            <p>{c.name}</p>
          </div>
          <Link to="/files/$clientId" params={{ clientId: c.id }} className="secondary">
            Open this one
          </Link>
        </div>
      ))}
      <div className="actions">
        <button type="button" className="secondary" onClick={onCreateAnyway}>
          None of these — add “{outcome.name}” as a new client
        </button>
      </div>
    </>
  );
}

/** Which client the cover belongs to, when the name did not settle it. */
function PolicyClientAnswer({
  outcome,
  onChoose,
  onAddClient,
}: {
  outcome: Exclude<CreatePolicyResponse, { outcome: "recorded" }>;
  onChoose: (clientId: string) => void;
  onAddClient: () => void;
}) {
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
  return (
    <div className="warning">
      <strong>No client on file called “{outcome.name}”.</strong> A policy belongs to somebody, and
      nothing has been recorded. Add the client first — it takes one line.
      <div className="actions">
        <button type="button" className="secondary" onClick={onAddClient}>
          Add the client
        </button>
      </div>
    </div>
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
