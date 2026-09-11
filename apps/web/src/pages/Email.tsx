import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { api, describeApiError } from "../lib/api.js";
import { useMe } from "../lib/me.js";
import { ErrorState, LoadingList, MissingData } from "../components/states.js";
import { Page } from "../shell/Page.js";

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
    <Page title="Email" meta="Conversations with clients and insurers, beside the work they belong to">
      <MailboxStatus connected={threads.data?.mailboxConnected ?? false} />

      {threads.isPending && <LoadingList rows={3} label="Reading your conversations" />}
      {threads.isError && (
        <ErrorState
          what={`We could not read your email. ${describeApiError(threads.error)}`}
          retry={() => void threads.refetch()}
        />
      )}
      {threads.data && threads.data.threads.length === 0 && (
        <article className="space-card" style={{ padding: 20 }}>
          <strong>
            {threads.data.mailboxConnected ? "Nothing has arrived yet." : "No mailbox is connected."}
          </strong>
          <p style={{ fontSize: 12, color: "#707a72", margin: "6px 0 0" }}>
            {threads.data.mailboxConnected
              ? "New conversations appear here as they land in the connected mailbox."
              : "Until one is, ASAP works from what you put on file yourself."}
          </p>
        </article>
      )}

      {threads.data && threads.data.threads.length > 0 && (
        <ul className="evidence-list">
          {threads.data.threads.map((t) => (
            <li key={t.id}>
              <Link to="/email/$threadId" params={{ threadId: t.id }}>
                {t.subject || "(No subject)"}
              </Link>
              <small>
                {t.clientName ?? "Not linked to a client yet"} · {t.messageCount}{" "}
                {t.messageCount === 1 ? "message" : "messages"}
                {t.lastMessageAt ? ` · ${new Date(t.lastMessageAt).toLocaleString()}` : ""}
              </small>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}

/** Whether a mailbox is connected, and how to connect one. Honest when none is. */
function MailboxStatus({ connected }: { connected: boolean }) {
  return (
    <article className="job-card" aria-label="Mailbox">
      <div className={`job-icon ${connected ? "" : "amber"}`} aria-hidden>
        ✉
      </div>
      <div className="job-main">
        <div className="job-title">
          <strong>{connected ? "Mailbox connected" : "No mailbox connected"}</strong>
        </div>
        <p>
          {connected
            ? "ASAP reads and replies in the same thread, and never sends without a person."
            : "Connect Gmail or Microsoft 365 to read and send from the brokerage's own mailbox."}
        </p>
      </div>
      <Link to="/settings/connections" className="secondary">
        Data and connections
      </Link>
    </article>
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
    <Page title={thread.subject || "(No subject)"} crumbs={["Email", thread.subject || "(No subject)"]}>
      <Link to="/email" className="link">
        ← Every conversation
      </Link>
      <p className="quiet-line">{thread.clientName ?? "Not linked to a client yet"}</p>

      {messages.length === 0 ? (
        <p className="quiet-line">This conversation has no messages ASAP can read yet.</p>
      ) : (
        <ol aria-label="Messages" className="thread-list">
          {messages.map((m) => (
            <li key={m.id} className={m.direction === "outbound" ? "outbound" : "inbound"}>
              <div className="thread-meta">
                {m.from} → {m.to.join(", ")} · {new Date(m.sentAt).toLocaleString()}
                {m.hasAttachments ? " · has attachments" : ""}
              </div>
              <p>{m.body ?? m.snippet ?? "The body of this message has not been read."}</p>
            </li>
          ))}
        </ol>
      )}

      {thread.workItemId && (
        <section aria-label="Related work">
          <div className="section-label">THE WORK THIS BELONGS TO</div>
          <ul className="evidence-list">
            <li>
              <Link to="/r/$recordId" params={{ recordId: thread.workItemId }} search={{}}>
                Open the record
              </Link>
              <small>Where a reply can be prepared and approved</small>
            </li>
          </ul>
        </section>
      )}
    </Page>
  );
}
