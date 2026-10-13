import { useEffect, useRef, useState } from "react";

const DRAFT_KEY = "asap-next:home-draft";
const STARTERS = ["Add a new client", "Show me motor policies expiring this month", "Help me renew a client's motor policy"];

/**
 * The main intention composer. Natural language, or a starter. Only the unsent text lives in the
 * browser (sessionStorage); everything sent becomes an experience on the server.
 */
export function IntentComposer({ busy, onSubmit }: { busy: boolean; onSubmit: (text: string) => void }) {
  const [text, setText] = useState(() => {
    try {
      return sessionStorage.getItem(DRAFT_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    try {
      if (text) sessionStorage.setItem(DRAFT_KEY, text);
      else sessionStorage.removeItem(DRAFT_KEY);
    } catch {
      /* private mode: the draft simply is not kept */
    }
  }, [text]);
  useEffect(() => ref.current?.focus(), []);

  const send = (t: string) => {
    const v = t.trim();
    if (!v || busy) return;
    setText("");
    onSubmit(v);
  };

  return (
    <form
      className="x-composer"
      onSubmit={(e) => {
        e.preventDefault();
        send(text);
      }}
    >
      <label htmlFor="intent" className="x-sr">
        What would you like ASAP to handle?
      </label>
      <textarea
        id="intent"
        ref={ref}
        rows={2}
        maxLength={500}
        value={text}
        placeholder="Describe what you want to get done — “Help me renew Acme's motor fleet”"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send(text);
          }
        }}
      />
      <div className="x-composer-foot">
        <div className="x-suggest" aria-label="Ways to begin">
          {STARTERS.map((s) => (
            <button key={s} type="button" className="x-btn x-btn-sm" onClick={() => (s.includes("a client's") ? (setText("Help me renew "), ref.current?.focus()) : send(s))}>
              {s}
            </button>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        <button type="submit" className="x-btn" data-primary="true" aria-disabled={busy || !text.trim() ? "true" : "false"}>
          {busy ? <span className="x-working">Composing</span> : "Start"}
        </button>
      </div>
    </form>
  );
}
