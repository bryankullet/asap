import { DEMO_NOTICE, demoClient, scenarioById, type DemoThread } from "@asap/schema";
import { Link, useParams, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { MissingData } from "../components/states.js";
import { DemoBoundary } from "../demo/DemoBoundary.js";
import { useDemo } from "../demo/state.js";

/**
 * Connected email (D-064).
 *
 * The approved demo shows a broker preparing a message, reviewing it and sending it — and Work
 * moving to Waiting as a result. That whole flow is here.
 *
 * The line this file will not cross: **a simulated send is never dressed as a delivered email.**
 * In demo mode the message joins the fictional thread and is labelled simulated. In production
 * the same surface requires a connected mailbox, a person's approval and the provider's own
 * message id before anything reads as sent — that is what `email_send_attempts` exists for, and
 * no amount of demo polish is allowed to imply it happened here.
 */
export function Email() {
  const demo = useDemo();
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-xl font-semibold text-ink">Email</h1>
        <p className="text-sm text-ink-secondary">
          Conversations with clients and insurers, beside the work they belong to.
        </p>
      </header>

      <MailboxStatus />

      <ul className="flex flex-col gap-2">
        {demo.threads.map((t) => {
          const client = demoClient(t.clientId);
          const last = t.messages[t.messages.length - 1];
          return (
            <li key={t.id}>
              <Link
                to="/email/$threadId"
                params={{ threadId: t.id }}
                className="block rounded-card border border-line-strong bg-paper p-3.5 hover:border-ink-muted"
              >
                <span className="block font-medium text-ink">{t.subject}</span>
                <span className="block text-sm text-ink-secondary">{t.counterparty}</span>
                <span className="block text-xs text-ink-muted">
                  {client?.shortName} · {t.messages.length}{" "}
                  {t.messages.length === 1 ? "message" : "messages"}
                  {last ? ` · ${last.at}` : ""}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      <DemoBoundary>{DEMO_NOTICE} No message leaves this demonstration.</DemoBoundary>
    </div>
  );
}

/** Whether a mailbox is connected, and how to connect one. Honest when none is. */
function MailboxStatus() {
  const { isDemo } = useDemo();
  return (
    <section
      aria-label="Mailbox"
      className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line-strong bg-paper p-3.5"
    >
      <div>
        <p className="text-sm font-medium text-ink">
          {isDemo ? "grace@asapbrokers.co.ke" : "No mailbox connected"}
        </p>
        <p className="text-xs text-ink-muted">
          {isDemo
            ? "A demonstration mailbox. Sending stays inside this demo."
            : "Connect Gmail or Microsoft 365 to read and send from the brokerage's own mailbox."}
        </p>
      </div>
      <div className="flex gap-2">
        <Link
          to="/settings/connections"
          className="rounded-control border border-line-strong px-3 py-1.5 text-sm text-ink hover:border-ink-muted"
        >
          Data and connections
        </Link>
      </div>
    </section>
  );
}

export function EmailThread() {
  const { threadId = "" } = useParams({ strict: false }) as { threadId?: string };
  const { scenario: scenarioId } = useSearch({ strict: false }) as { scenario?: string };
  const demo = useDemo();
  const thread = demo.threads.find((t) => t.id === threadId);
  const scenario = scenarioId ? scenarioById(scenarioId) : undefined;
  const [body, setBody] = useState(scenario?.panel.draft?.body ?? "");
  const [sent, setSent] = useState(false);

  if (!thread) {
    return <MissingData what="No conversation with that id" why="It may have been archived." />;
  }
  const client = demoClient(thread.clientId);
  const work = demo.work.find((w) => w.clientId === thread.clientId);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <Link to="/email" className="text-sm text-ink-secondary hover:underline">
          ← Email
        </Link>
        <h1 className="font-heading text-lg font-semibold text-ink">{thread.subject}</h1>
        <p className="text-xs text-ink-muted">
          {client?.name} · {thread.counterparty}
        </p>
      </header>

      <ThreadMessages thread={thread} />

      <section
        aria-label="Prepared reply"
        className="flex flex-col gap-2 rounded-card border border-line-strong bg-paper p-4"
      >
        <h2 className="text-sm font-medium text-ink">Prepared reply</h2>
        <p className="text-xs text-ink-muted">
          ASAP drafted this. Nothing is sent until a person sends it.
        </p>
        <label htmlFor="reply-body" className="sr-only">
          Message
        </label>
        <textarea
          id="reply-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={7}
          className="rounded-control border border-line-strong bg-paper p-3 text-sm text-ink"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={body.trim().length === 0}
            onClick={() => {
              demo.sendDemoEmail(thread.id, body, work?.id ?? null);
              setSent(true);
            }}
            className="rounded-control bg-navy px-3 py-1.5 text-sm text-paper hover:bg-navy-hover disabled:opacity-50"
          >
            Send
          </button>
          <button
            type="button"
            onClick={() => demo.saveDemoDraft(work?.id ?? null)}
            className="rounded-control border border-line-strong px-3 py-1.5 text-sm text-ink hover:border-ink-muted"
          >
            Save draft
          </button>
          {sent && (
            <span className="text-sm text-accent-gold-ink">
              Added to this conversation as a simulated send. No provider delivered it.
            </span>
          )}
        </div>
        <DemoBoundary>
          In production this needs a connected mailbox, your approval, and the provider's own
          message id before it reads as sent.
        </DemoBoundary>
      </section>
    </div>
  );
}

function ThreadMessages({ thread }: { thread: DemoThread }) {
  return (
    <ol aria-label="Messages" className="flex flex-col gap-2">
      {thread.messages.map((m) => (
        <li
          key={m.id}
          className={`max-w-[85%] rounded-card border p-3 text-sm ${
            m.direction === "outbound"
              ? "self-end border-line-soft bg-wash"
              : "self-start border-line-strong bg-paper"
          }`}
        >
          <p className="text-xs text-ink-muted">
            {m.from} → {m.to} · {m.at}
          </p>
          <p className="whitespace-pre-line text-ink-secondary">{m.body}</p>
        </li>
      ))}
    </ol>
  );
}
