import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, describeApiError } from "../lib/api.js";
import { useMe } from "../lib/me.js";
import { ScreenTitle } from "../shell/ScreenTitle.js";

/**
 * Data and connections (D-064).
 *
 * Where a brokerage connects its mailbox. In demo mode a connection is simulated and says so; in
 * production the buttons begin a real OAuth flow, and until that returns, the mailbox is honestly
 * not connected. There is no state in between, and nothing here ever claims a mailbox is attached
 * when it is not.
 */
export function Connections() {
  const me = useMe();
  const qc = useQueryClient();
  const [notConfigured, setNotConfigured] = useState<string | null>(null);

  /* What is actually connected, from the brokerage's own rows. Never a token. */
  const live = useQuery({
    queryKey: ["mailboxes", me.data?.active_organization?.id],
    enabled: Boolean(me.data?.active_organization?.id),
    queryFn: () => api.mailboxes(),
  });

  const connect = useMutation({
    mutationFn: (provider: "gmail" | "microsoft") => api.connectMailbox(provider),
    onSuccess: (res) => {
      if (res.outcome === "authorise") {
        // The provider's own page. Nothing is connected until it sends the person back.
        window.location.assign(res.url);
        return;
      }
      setNotConfigured(res.reason);
    },
  });
  const disconnect = useMutation({
    mutationFn: (id: string) => api.disconnectMailbox(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["mailboxes"] }),
  });

  const providers = live.data?.providers ?? [];
  const mailboxes = live.data?.mailboxes ?? [];

  return (
    <>
      <ScreenTitle
        title="Data and connections"
        meta="What ASAP is allowed to read on the brokerage's behalf"
      />
      <section className="page-scroll spaces-page">
        <div className="section-label">Mailbox</div>

        {providers.map((p) => {
          const mine = mailboxes.filter((m) => m.provider === p.id && m.status !== "disconnected");
          return (
            <article className="job-card" key={p.id}>
              <div className={`job-icon ${p.available ? "" : "amber"}`} aria-hidden>
                ✉
              </div>
              <div className="job-main">
                <div className="job-title">
                  <strong>{p.label}</strong>
                  {mine.map((m) => (
                    <span
                      key={m.id}
                      className={`job-pill ${m.status === "connected" ? "running" : "waiting"}`}
                    >
                      {m.status === "connected" ? "Connected" : "Needs authorising again"}
                    </span>
                  ))}
                </div>
                <p>
                  {mine.length > 0
                    ? mine.map((m) => m.emailAddress).join(", ")
                    : p.available
                      ? "Not connected."
                      : (p.unavailableReason ?? "Not available here.")}
                </p>
                <small>
                  {mine[0]?.statusReason ??
                    (mine[0]?.lastSyncedAt
                      ? `Last read ${new Date(mine[0].lastSyncedAt).toLocaleString()}`
                      : "ASAP reads and replies in the same thread, and never sends without a person.")}
                </small>
              </div>
              {mine.length > 0 ? (
                <button
                  type="button"
                  className="secondary"
                  disabled={disconnect.isPending}
                  onClick={() => disconnect.mutate(mine[0]!.id)}
                >
                  Disconnect
                </button>
              ) : (
                <button
                  type="button"
                  className="secondary"
                  disabled={!p.available || connect.isPending}
                  onClick={() => {
                    setNotConfigured(null);
                    connect.mutate(p.id);
                  }}
                >
                  {p.available ? "Connect" : "Not available here"}
                </button>
              )}
            </article>
          );
        })}

        {notConfigured && (
          <div className="warning">
            <strong>Nothing was connected:</strong> {notConfigured}
          </div>
        )}
        {live.isError && (
          <div className="warning">
            <strong>We could not read your connections:</strong> {describeApiError(live.error)}
          </div>
        )}
        {!live.isPending && mailboxes.length === 0 && (
          <p style={{ fontSize: 11, color: "#707a72", marginTop: 12 }}>
            Until a mailbox is connected, ASAP works from what you put on file yourself. Nothing is
            read from anybody&rsquo;s email without this.
          </p>
        )}
      </section>
    </>
  );
}
