import type { AskResponseV2, ConversationMessage } from "@asap/schema";
import { Link } from "@tanstack/react-router";

/**
 * The conversation, shown above the docked composer.
 *
 * Every state Ask can be in is drawn here, because a surface with only a happy path is unfinished
 * (§36). The four that are easy to get wrong, and how they read:
 *
 *  - **Working.** A named step, not a spinner: a person can see that ASAP is reading records.
 *  - **Abstained.** What was missing, in words. Never an empty answer box.
 *  - **Not configured.** Says plainly that no model is connected on the server. It is not
 *    "nothing found", and it names nothing about the provider or the key.
 *  - **Unavailable.** The model could not be reached. Asking again is offered; a silent retry
 *    against another provider is not, because then nobody could say what answered.
 *
 * Citations open the record they were read from. A citation with no page reference says so rather
 * than offering a link that goes nowhere — a citation you cannot open is not a citation.
 */
export function AskThread(props: {
  turns: { question: string; response: AskResponseV2 | null }[];
  pending: boolean;
  onRetry?: (() => void) | undefined;
}) {
  const { turns, pending } = props;
  if (turns.length === 0 && !pending) return null;

  return (
    <div className="flex max-h-[46vh] flex-col gap-3 overflow-y-auto" aria-live="polite">
      {turns.map((turn, i) => (
        <div key={i} className="flex flex-col gap-2 text-sm">
          <p className="self-end rounded-card bg-wash px-3 py-2 text-ink">{turn.question}</p>
          {turn.response && <Answer response={turn.response} onRetry={props.onRetry} />}
        </div>
      ))}
      {pending && (
        <p className="text-xs text-ink-muted">ASAP is reading the records behind this…</p>
      )}
    </div>
  );
}

function Answer({
  response,
  onRetry,
}: {
  response: AskResponseV2;
  onRetry: (() => void) | undefined;
}) {
  if (response.state === "not_configured") {
    return (
      <Notice tone="gold" title="No model is connected">
        Ask can search and open records. Answering questions needs a model configured on the server
        for this brokerage.
      </Notice>
    );
  }
  if (response.state === "unavailable") {
    return (
      <Notice tone="red" title="ASAP could not reach the model">
        Nothing was changed.{" "}
        {onRetry && (
          <button type="button" className="underline" onClick={onRetry}>
            Ask again
          </button>
        )}
      </Notice>
    );
  }

  const message = response.message;
  if (!message) return null;

  if (message.abstained) {
    return (
      <Notice tone="gold" title="ASAP did not answer this">
        {message.abstained.reason}
        {message.abstained.missing.length > 0 && (
          <ul className="mt-1 list-disc pl-4">
            {message.abstained.missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        )}
      </Notice>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-ink-secondary">{message.body}</p>
      <Citations message={message} />
      {response.planRecordId && (
        <Link
          to="/r/$recordId"
          params={{ recordId: response.planRecordId }}
          // The view travels with the link, so the record opens on what was asked about. The
          // blocks and every value in them are still built and validated server-side.
          search={response.planView ? { view: response.planView } : {}}
          className="self-start text-ink underline"
        >
          Open the work
        </Link>
      )}
    </div>
  );
}

function Citations({ message }: { message: ConversationMessage }) {
  if (message.citations.length === 0) return null;
  return (
    <div className="flex flex-col gap-1 rounded-card border border-line-soft bg-wash p-2">
      <p className="text-xs font-medium text-ink-muted">
        Read from{" "}
        {message.citations.length === 1 ? "1 source" : `${message.citations.length} sources`}
      </p>
      <ul className="flex flex-col gap-1">
        {message.citations.map((c, i) => (
          <li key={i} className="text-xs">
            {c.recordId ? (
              <Link
                to="/r/$recordId"
                params={{ recordId: c.recordId }}
                className="text-ink underline"
              >
                {c.label}
              </Link>
            ) : (
              <span className="text-ink-secondary">{c.label}</span>
            )}
            {/* Page and highlight arrive with document extraction. Until then, saying so beats a
                link that opens nothing. */}
            {c.page === null && (
              <span className="text-ink-muted"> · no page reference on file</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Notice(props: { tone: "gold" | "red"; title: string; children: React.ReactNode }) {
  const tone =
    props.tone === "gold"
      ? "border-accent-gold bg-accent-gold-soft text-accent-gold-ink"
      : "border-accent-red bg-accent-red-soft text-accent-red-ink";
  return (
    <div className={`flex flex-col gap-1 rounded-card border px-3 py-2 text-sm ${tone}`}>
      <p className="font-medium">{props.title}</p>
      <p>{props.children}</p>
    </div>
  );
}
