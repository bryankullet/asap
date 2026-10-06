import { useRef, useState, type DragEvent } from "react";
import { activityLog, automationsBoard, homeSurface, workInbox } from "../surfaces.js";
import type { Ref } from "./routes.js";
import { KIND_ICON, type Logic, type RecentItem, type ShellAdapters } from "./types.js";

type Open = (ref: Ref) => void;
const meId = (A: ShellAdapters | undefined) => A?.records.actor().id ?? null;
const sup = (A: ShellAdapters | undefined) => (A?.supervision ? A.supervision() : null);

const KIND_WORDS: Record<string, string> = { approval: "Approval required", blocked: "Blocked", overdue: "Response overdue", deadline: "Deadline at risk", discrepancy: "Needs review", automation: "Automation failed" };
const KIND_TONE: Record<string, string> = { approval: "gold", blocked: "red", overdue: "gold", deadline: "red", discrepancy: "gold", automation: "red" };

/**
 * Home orients. One command box — the request becomes a named conversation, the box itself is not a
 * transcript — then a few genuine attention items, what ASAP is handling, and Recent. A brokerage
 * with nothing in it gets a conversational setup entry point instead of empty dashboard cards.
 */
export function HomeSurface({ logic, A, recent, onOpenRecent, onOpen, onAsk, onFiles, onNew }: {
  logic: Logic; A: ShellAdapters | undefined; recent: RecentItem[]; onOpenRecent: (r: RecentItem) => void; onOpen: Open;
  onAsk: (text: string) => void; onFiles: (files: File[]) => void; onNew: () => void;
}) {
  const [text, setText] = useState(() => {
    try {
      return (JSON.parse(sessionStorage.getItem("asap.drafts") || "{}") as Record<string, string>)["home"] ?? "";
    } catch {
      return "";
    }
  });
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const remember = (v: string) => {
    setText(v);
    try {
      const all = JSON.parse(sessionStorage.getItem("asap.drafts") || "{}") as Record<string, string>;
      if (v) all["home"] = v;
      else delete all["home"];
      sessionStorage.setItem("asap.drafts", JSON.stringify(all));
    } catch {
      /* interface state only */
    }
  };
  const submit = () => {
    const t = text.trim();
    if (!t) return;
    remember("");
    onAsk(t);
  };
  const data = homeSurface({ supervision: sup(A), meId: meId(A), waitingDocuments: A?.waitingDocuments ? A.waitingDocuments() : [] });
  void logic.state.tick;
  const quick: [string, () => void][] = [
    ["Add records", () => onOpen({ ws: "import" })],
    ["Prepare a renewal", () => onOpen({ ws: "renewal" })],
    ["Start a quotation", () => onOpen({ ws: "quote" })],
    ["Report a claim", () => onOpen({ ws: "claim" })],
    ["Upload documents", () => fileRef.current?.click()],
    ["Ask about the brokerage", () => onAsk("What needs attention in the brokerage today?")],
  ];
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    const files = [...(e.dataTransfer?.files || [])];
    if (files.length) onFiles(files);
  };
  return (
    <div className="sh-surface sh-home">
      <section className={drag ? "sh-command sh-drag" : "sh-command"} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop} aria-label="Ask ASAP">
        <h1 className="sh-home-title">What would you like ASAP to handle?</h1>
        <form className="sh-command-box" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <button type="button" className="sh-attach" onClick={() => fileRef.current?.click()} aria-label="Attach files">＋</button>
          <textarea
            aria-label="What would you like ASAP to handle?"
            placeholder={data.firstUse ? "Add the records you already have…" : "Renew Acme’s motor policy, compare CIC and Jubilee, report Jane’s accident…"}
            value={text}
            rows={2}
            onChange={(e) => remember(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <button type="submit" className="sh-send" disabled={!text.trim()} aria-label="Send">↑</button>
          <input ref={fileRef} type="file" multiple hidden onChange={(e) => { const f = [...(e.target.files || [])]; e.target.value = ""; if (f.length) onFiles(f); }} />
        </form>
        <div className="sh-quick" role="group" aria-label="Quick actions">
          {quick.map(([label, run]) => (
            <button key={label} type="button" onClick={run}>{label}</button>
          ))}
        </div>
        <p className="sh-command-note">Drop files anywhere here. ASAP prepares; a person approves anything that leaves the brokerage or moves money.</p>
      </section>

      {data.firstUse ? (
        <section className="sh-card sh-setup" aria-label="Set up your brokerage">
          <h2>Add the records you already have. ASAP will organize your clients, policies and current work.</h2>
          <div className="sh-setup-actions">
            <button type="button" className="sh-btn-primary" onClick={() => fileRef.current?.click()}>Upload documents</button>
            <button type="button" onClick={() => onOpen({ ws: "import" })}>Import spreadsheet</button>
            <button type="button" onClick={() => onOpen({ ws: "newclient" })}>Add client manually</button>
            <button type="button" onClick={() => onOpen({ ws: "clients" })}>Explore empty workspace</button>
          </div>
        </section>
      ) : null}
      {data.firstUse && data.attention.length ? (
        <section className="sh-card" aria-labelledby="h-matters-first">
          <h2 id="h-matters-first">What matters today</h2>
          <ul className="sh-list">
            {data.attention.map((a, i) => (
              <li key={i} className="sh-row">
                <span className={`sh-dot sh-${KIND_TONE[a.kind] ?? "gold"}`} aria-hidden />
                <div className="sh-row-main">
                  <div className="sh-row-kicker">{KIND_WORDS[a.kind] ?? "Attention"}</div>
                  <strong>{a.title}</strong>
                  <p>{a.why}</p>
                </div>
                <button type="button" className="sh-btn-primary" onClick={() => onOpen(a.action.ref as Ref)}>{a.action.label}</button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {data.firstUse ? null : (
        <div className="sh-home-grid">
          <section className="sh-card" aria-labelledby="h-matters">
            <h2 id="h-matters">What matters today</h2>
            {data.attention.length === 0 ? (
              <p className="sh-empty">Nothing needs you right now. ASAP will put anything that does here, with why.</p>
            ) : (
              <ul className="sh-list">
                {data.attention.map((a, i) => (
                  <li key={i} className="sh-row">
                    <span className={`sh-dot sh-${KIND_TONE[a.kind] ?? "gold"}`} aria-hidden />
                    <div className="sh-row-main">
                      <div className="sh-row-kicker">{KIND_WORDS[a.kind] ?? "Attention"}</div>
                      <strong>{a.title}</strong>
                      <p>{a.why}</p>
                    </div>
                    <button type="button" className="sh-btn-primary" onClick={() => onOpen(a.action.ref as Ref)}>{a.action.label}</button>
                  </li>
                ))}
              </ul>
            )}
            {data.more ? <button type="button" className="sh-link" onClick={() => onOpen({ ws: "work" })}>{data.more} more in Work →</button> : null}
          </section>
          <section className="sh-card" aria-labelledby="h-handling">
            <h2 id="h-handling">ASAP is handling</h2>
            {data.handling.length === 0 ? (
              <p className="sh-empty">No workflow is running on its own right now.</p>
            ) : (
              <ul className="sh-list">
                {data.handling.map((h, i) => (
                  <li key={i} className="sh-row sh-row-compact">
                    <span className={`sh-dot ${h.safe ? "sh-green" : "sh-gold"}`} aria-hidden />
                    <div className="sh-row-main">
                      <strong>{h.title}</strong>
                      <p>{[h.doing, h.state, h.next ? "Next: " + h.next : null].filter(Boolean).join(" · ")}</p>
                      <small>{h.safe ? "Safe to leave — ASAP will put it in Work if it needs you." : "Watch this one."}</small>
                    </div>
                    <button type="button" onClick={() => onOpen(h.ref as Ref)}>Open</button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      <section className="sh-card" aria-labelledby="h-recent">
        <div className="sh-card-head">
          <h2 id="h-recent">Recent</h2>
          <button type="button" className="sh-link" onClick={onNew}>＋ New</button>
        </div>
        {recent.length === 0 ? (
          <p className="sh-empty">Conversations, workflows and records you open appear here.</p>
        ) : (
          <ul className="sh-recent-grid">
            {recent.slice(0, 8).map((r) => (
              <li key={r.key}>
                <button type="button" onClick={() => onOpenRecent(r)}>
                  <span className="sh-kind" aria-hidden>{KIND_ICON[r.kind] ?? "•"}</span>
                  <span className="sh-recent-text"><strong>{r.title}</strong><small>{r.kind[0]!.toUpperCase() + r.kind.slice(1)} · {new Date(r.openedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</small></span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** Work: the operational inbox, full width, no chat. Rows open their workflow Space. */
export function WorkSurface({ logic, A, view, onView, onOpen }: { logic: Logic; A: ShellAdapters | undefined; view: string; onView: (v: string) => void; onOpen: Open }) {
  void logic.state.tick;
  const { views } = workInbox({ supervision: sup(A), meId: meId(A) });
  const current = views.find((x) => x.key === view) ?? views[0]!;
  return (
    <div className="sh-surface sh-wide">
      <div className="sh-tabs" role="tablist" aria-label="Work views">
        {views.map((x) => (
          <button key={x.key} type="button" role="tab" aria-selected={x.key === current.key} className={x.key === current.key ? "sh-tab sh-on" : "sh-tab"} onClick={() => onView(x.key)}>
            {x.label} <span className="sh-count">{x.rows.length}</span>
          </button>
        ))}
      </div>
      {current.rows.length === 0 ? (
        <p className="sh-empty sh-card">{current.key === "needs_me" ? "Nothing needs you. Work that does arrives here first." : current.key === "done" ? "Nothing finished yet." : "Nothing here right now."}</p>
      ) : (
        <ul className="sh-work" aria-label={current.label}>
          {current.rows.map((r) => (
            <li key={r.id} className="sh-work-row">
              <span className={`sh-urgency sh-u-${r.urgency}`} aria-label={`Urgency ${r.urgency}`} />
              <div className="sh-row-main">
                <strong>{r.title}</strong>
                <p>{[r.client?.name, r.statusText, r.owner, r.when].filter(Boolean).join(" · ")}</p>
              </div>
              <button type="button" className={r.action.label === "Review" ? "sh-btn-primary" : ""} onClick={() => onOpen(r.action.ref as Ref)}>{r.action.label}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Automations: what runs, what it is responsible for, whether it is healthy, what next. Details live in its Space. */
export function AutomationsSurface({ logic, A, onOpen }: { logic: Logic; A: ShellAdapters | undefined; onOpen: Open }) {
  void logic.state.tick;
  const board = automationsBoard({ supervision: sup(A) });
  const card = (c: (typeof board.standing)[number] | (typeof board.workflows)[number]) => (
    <li key={c.id} className="sh-auto-card">
      <div className="sh-auto-head">
        <strong>{c.name}</strong>
        <span className={`sh-badge sh-${c.tone}`}>{c.state}</span>
      </div>
      <ul className="sh-auto-lines">{c.lines.map((l) => <li key={l}>{l}</li>)}</ul>
      <p className="sh-auto-next">{c.next}</p>
      <div className="sh-auto-actions">
        <button type="button" onClick={() => onOpen(c.ref as Ref)}>Open</button>
        {"on" in c && c.canPause ? (
          <button type="button" onClick={() => logic.act("automation.toggle", { id: c.id }, { actionId: "automation.toggle:" + c.id + ":" + String(!c.on) })}>{c.on ? "Pause" : "Switch on"}</button>
        ) : null}
      </div>
    </li>
  );
  return (
    <div className="sh-surface sh-wide">
      <section aria-labelledby="h-wf">
        <h2 id="h-wf" className="sh-section-title">Workflows ASAP runs</h2>
        {board.workflows.length ? <ul className="sh-auto-grid">{board.workflows.map(card)}</ul> : <p className="sh-empty sh-card">No workflow has run yet. Renewals start on their own as policies enter the renewal window.</p>}
      </section>
      <section aria-labelledby="h-st">
        <div className="sh-card-head">
          <h2 id="h-st" className="sh-section-title">Standing instructions</h2>
          <button type="button" className="sh-link" onClick={() => onOpen({ ws: "automation", create: "1" })}>＋ Create automation</button>
        </div>
        {board.standing.length ? <ul className="sh-auto-grid">{board.standing.map(card)}</ul> : <p className="sh-empty sh-card">No standing instructions yet. Create one to have ASAP prepare work when something happens.</p>}
      </section>
    </div>
  );
}

const FILTERS: [string, string, Record<string, string>][] = [
  ["all", "Everything", {}],
  ["people", "People", { who: "people" }],
  ["asap", "ASAP", { who: "asap" }],
  ["workflow", "Workflow", { workflow: "1" }],
  ["approvals", "Approvals", { approvals: "1" }],
  ["external", "External communication", { external: "1" }],
];

/** Activity: what happened, searchable, newest first. History only — unfinished work lives in Work. */
export function ActivitySurface({ logic, filter, onFilter, onOpen }: { logic: Logic; filter: Record<string, string>; onFilter: (f: Record<string, string>) => void; onOpen: Open }) {
  void logic.state.tick;
  const rows = activityLog({ filter });
  const active = FILTERS.find(([, , f]) => Object.entries(f).every(([k, v]) => filter[k] === v) && Object.keys(f).length === Object.keys(filter).filter((k) => k !== "q" && k !== "clientId").length)?.[0] ?? "all";
  const clientName = filter["clientId"] ? rows.find((r) => r.client?.id === filter["clientId"])?.client?.name ?? "this client" : null;
  return (
    <div className="sh-surface sh-wide">
      <div className="sh-activity-tools">
        <input type="search" className="sh-search-input" placeholder="Search what happened…" defaultValue={filter["q"] ?? ""} aria-label="Search activity" onChange={(e) => onFilter({ ...filter, q: e.target.value })} />
        <div className="sh-tabs" role="group" aria-label="Filter activity">
          {FILTERS.map(([key, label, f]) => (
            <button key={key} type="button" aria-pressed={active === key} className={active === key ? "sh-tab sh-on" : "sh-tab"} onClick={() => onFilter({ ...f, ...(filter["q"] ? { q: filter["q"] } : {}), ...(filter["clientId"] ? { clientId: filter["clientId"] } : {}) })}>
              {label}
            </button>
          ))}
          {clientName ? <button type="button" className="sh-tab sh-on" onClick={() => { const { clientId: _c, ...rest } = filter; onFilter(rest); }}>Client: {clientName} ✕</button> : null}
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="sh-empty sh-card">Nothing recorded{Object.keys(filter).length ? " for this filter" : " yet"}. People’s and ASAP’s actions appear here as they happen.</p>
      ) : (
        <ol className="sh-activity" aria-label="What happened, newest first">
          {rows.slice(0, 120).map((r) => (
            <li key={r.id} className="sh-activity-row">
              <span className={`sh-actor ${r.asap ? "sh-actor-asap" : ""}`} aria-hidden>{r.asap ? "✦" : "◉"}</span>
              <div className="sh-row-main">
                <p className="sh-sentence">{r.sentence}</p>
                <small>{[r.when, r.client?.name, r.external ? "External" : null, r.approval ? "Approval" : null].filter(Boolean).join(" · ")}</small>
              </div>
              {r.ref ? <button type="button" className="sh-link" onClick={() => onOpen(r.ref as Ref)}>Open</button> : null}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
