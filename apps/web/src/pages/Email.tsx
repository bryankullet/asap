import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { api, describeApiError } from "../lib/api.js";
import { useMe } from "../lib/me.js";
import { ErrorState, LoadingList, MissingData } from "../components/states.js";

/**
 * Connected email (D-064).
 *
 * The brokerage's own correspondence, beside the work it belongs to, read under the caller's own
 * session from the mailbox they connected.
 *
 * The line this file will not cross: **nothing is sent from here.** A message leaves ASAP only
 * through an approved draft on the record it belongs to, and only reads as sent once the provider
 * returned its own message id — that is what `email_send_attempts` exists for.
 */
export function Email() {
  const me = useMe();
  const threads = useQuery({
    queryKey: ["email_threads", me.data?.active_organization?.id],
    queryFn: () => api.emailThreads(),
    enabled: Boolean(me.data?.active_organization?.id),
    retry: false,
  });

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-xl font-semibold text-ink">Email</h1>
        <p className="text-sm text-ink-secondary">
          Conversations with clients and insurers, beside the work they belong to.
        </p>
      </header>

      <MailboxStatus connected={threads.data?.mailboxConnected ?? false} />

      {threads.isPending && <LoadingList rows={3} label="Reading your conversations" />}
      {threads.isError && (
        <ErrorState
          what={`We could not read your email. ${describeApiError(threads.error)}`}
          retry={() => void threads.refetch()}
        />
      )}
      {threads.data && threads.data.threads.length === 0 && (
        <p className="rounded-card border border-line-soft bg-paper p-4 text-sm text-ink-secondary">
          {threads.data.mailboxConnected
            ? "Nothing has arrived yet. New conversations appear here as they land in the connected mailbox."
            : "No mailbox is connected, so there is nothing to read. Until one is, ASAP works from what you put on file yourself."}
        </p>
      )}

      {threads.data && threads.data.threads.length > 0 && (
        <ul className="flex flex-col gap-2">
          {threads.data.threads.map((t) => (
            <li key={t.id}>
              <Link
                to="/email/$threadId"
                params={{ threadId: t.id }}
                className="block rounded-card border border-line-strong bg-paper p-3.5 hover:border-ink-muted"
              >
                <span className="block font-medium text-ink">{t.subject || "(No subject)"}</span>
                <span className="block text-xs text-ink-muted">
                  {t.clientName ?? "Not linked to a client yet"} · {t.messageCount}{" "}
                  {t.messageCount === 1 ? "message" : "messages"}
                  {t.lastMessageAt ? ` · ${new Date(t.lastMessageAt).toLocaleString()}` : ""}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Whether a mailbox is connected, and how to connect one. Honest when none is. */
function MailboxStatus({ connected }: { connected: boolean }) {
  return (
    <section
      aria-label="Mailbox"
      className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line-strong bg-paper p-3.5"
    >
      <div>
        <p className="text-sm font-medium text-ink">
          {connected ? "Mailbox connected" : "No mailbox connected"}
        </p>
        <p className="text-xs text-ink-muted">
          {connected
            ? "ASAP reads and replies in the same thread, and never sends without a person."
            : "Connect Gmail or Microsoft 365 to read and send from the brokerage's own mailbox."}
        </p>
      </div>
      <Link
        to="/settings/connections"
        className="rounded-control border border-line-strong px-3 py-1.5 text-sm text-ink hover:border-ink-muted"
      >
        Data and connections
      </Link>
    </section>
  );
}

/** One conversation, in order, with the work it belongs to. */
export function EmailThread() {
  const { threadId = "" } = useParams({ strict: false }) as { threadId?: string };
  const detail = useQuery({
    queryKey: ["email_thread", threadId],
    queryFn: () => api.emailThread(threadId),
    enabled: Boolean(threadId),
    retry: false,
  });

  if (detail.isPending) return <LoadingList rows={3} label="Opening the conversation" />;
  if (detail.isError) {
    return (
      <ErrorState
        what={`We could not open this conversation. ${describeApiError(detail.error)}`}
        retry={() => void detail.refetch()}
      />
    );
  }
  if (!detail.data) {
    return (
      <MissingData
        what="No conversation with that id"
        why="It may have been archived, or your role in this brokerage cannot see it."
      />
    );
  }
  const { thread, messages } = detail.data;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <Link to="/email" className="text-sm text-ink-secondary hover:underline">
          ← Email
        </Link>
        <h1 className="font-heading text-lg font-semibold text-ink">
          {thread.subject || "(No subject)"}
        </h1>
        <p className="text-xs text-ink-muted">
          {thread.clientName ?? "Not linked to a client yet"}
        </p>
      </header>

      {messages.length === 0 ? (
        <p className="text-sm text-ink-muted">
          This conversation has no messages ASAP can read yet.
        </p>
      ) : (
        <ol aria-label="Messages" className="flex flex-col gap-2">
          {messages.map((m) => (
            <li
              key={m.id}
              className={`max-w-[85%] rounded-card border p-3 text-sm ${
                m.direction === "outbound"
                  ? "self-end border-line-soft bg-wash"
                  : "self-start border-line-strong bg-paper"
              }`}
            >
              <p className="text-xs text-ink-muted">
                {m.from} → {m.to.join(", ")} · {new Date(m.sentAt).toLocaleString()}
                {m.hasAttachments ? " · has attachments" : ""}
              </p>
              <p className="whitespace-pre-line text-ink-secondary">
                {m.body ?? m.snippet ?? "The body of this message has not been read."}
              </p>
            </li>
          ))}
        </ol>
      )}

      {thread.workItemId && (
        <section aria-label="Related work" className="flex flex-col gap-1.5">
          <h2 className="text-sm font-medium text-ink">The work this belongs to</h2>
          <Link
            to="/r/$recordId"
            params={{ recordId: thread.workItemId }}
            search={{}}
            className="rounded-card border border-line-strong bg-paper p-3 text-sm text-ink hover:border-ink-muted"
          >
            Open the record, where a reply can be prepared and approved
          </Link>
        </section>
      )}
    </div>
  );
}
