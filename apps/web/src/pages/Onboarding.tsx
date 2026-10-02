import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { api, describeApiError } from "../lib/api.js";
import { activeMemberships } from "../lib/guards.js";
import { useInvalidateMe, useMe } from "../lib/me.js";

/** How long the hand-off to the workspace may take before the screen says so and offers a way on. */
export const OPENING_TIMEOUT_MS = 15_000;
const FLAG = "asap.brokerage.created";

/**
 * Creating the brokerage — the one step that must happen before the ASAP interface has anything
 * to open over. Everything after it (importing a book, filing documents, connecting a mailbox)
 * happens inside the interface itself.
 *
 * Styled with the approved interface's own palette and type so the first screen a new brokerage
 * sees is the same product as every screen after it.
 */
export function Onboarding() {
  const navigate = useNavigate();
  const invalidate = useInvalidateMe();
  /* One key for the life of this screen: a double submit or a retry is the same brokerage (0029). */
  const [requestKey] = useState(() => crypto.randomUUID());
  const [name, setName] = useState("");
  const [accepted, setAccepted] = useState(false);
  /*
   * Set the moment the brokerage exists. From then on this screen says it is opening the workspace
   * and never shows the empty form again — re-reading the account can remount it, and a blank form
   * after a successful create reads as a failure.
   */
  const [created, setCreated] = useState(false);

  const create = useMutation({
    mutationFn: () =>
      api.createOrganization({
        name: name.trim(),
        country: "KE",
        currency: "KES",
        timezone: "Africa/Nairobi",
        accepted_terms: true,
        request_key: requestKey,
      }),
    onSuccess: () => {
      setCreated(true);
      try {
        sessionStorage.setItem(FLAG, "1");
      } catch {
        /* storage blocked: the in-memory flag still holds for this mount */
      }
      // Re-read the account; the effect below moves on the moment it shows the new brokerage.
      void invalidate();
    },
  });

  /*
   * The hand-off (the cause of the screen that never moved on): it used to wait on one re-read and
   * a navigation, and nothing re-checked after that. A refresh with the "just created" flag set
   * showed this screen forever. Now it watches the account itself: as soon as the brokerage is
   * there it opens the workspace; if it is not there in OPENING_TIMEOUT_MS it says so and offers a
   * retry (the same request key — no second brokerage) and a way on.
   */
  const me = useMe();
  const hasBrokerage = activeMemberships(me.data).length > 0 && Boolean(me.data?.active_organization);
  const [timedOut, setTimedOut] = useState(false);
  const [phase, setPhase] = useState("Creating your private workspace");

  const canSubmit = name.trim().length >= 2 && accepted && !create.isPending;
  let justCreated = created;
  try {
    justCreated ||= sessionStorage.getItem(FLAG) === "1";
  } catch {
    /* storage blocked */
  }

  useEffect(() => {
    if (!justCreated) return;
    if (hasBrokerage) {
      setPhase("Opening your workspace");
      void navigate({ to: "/", replace: true });
      return;
    }
    setPhase(me.isFetching ? "Confirming your brokerage" : "Waiting for your brokerage to appear");
    const poll = setInterval(() => void invalidate(), 2_000);
    const stop = setTimeout(() => setTimedOut(true), OPENING_TIMEOUT_MS);
    return () => {
      clearInterval(poll);
      clearTimeout(stop);
    };
  }, [justCreated, hasBrokerage]);

  const forget = () => {
    try {
      sessionStorage.removeItem(FLAG);
    } catch {
      /* storage blocked */
    }
  };
  const field = { width: "100%", border: "1px solid #d7ded8", borderRadius: 11, padding: "10px 11px", outline: 0, fontSize: 14 } as const;

  const btn = { border: 0, background: "#1f6c49", color: "#fff", borderRadius: 11, padding: "10px 14px", fontFamily: "var(--font-display)", fontSize: 14, fontWeight: 600 } as const;
  const ghost = { border: "1px solid #d7ded8", background: "#fff", color: "#18231c", borderRadius: 11, padding: "10px 14px", fontFamily: "var(--font-display)", fontSize: 14, fontWeight: 600 } as const;
  if (justCreated)
    return (
      <div role="status" aria-live="polite" style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 16, background: "#fbfcfa", color: "#18231c", fontFamily: "var(--font-body)" }}>
        <div style={{ textAlign: "center", maxWidth: 420 }}>
          <div style={{ fontSize: 12, letterSpacing: "0.04em", fontWeight: 400, color: timedOut ? "#a43b32" : "#1f6c49" }}>{timedOut ? "TAKING LONGER THAN IT SHOULD" : "BROKERAGE CREATED"}</div>
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 20, letterSpacing: "-0.02em", margin: "6px 0 6px" }}>{timedOut ? "Your workspace has not opened yet" : phase + "…"}</h1>
          <p style={{ color: "#4c564e", fontSize: 14, margin: 0, lineHeight: 1.55 }}>
            {timedOut
              ? me.isError
                ? `Your account could not be read: ${describeApiError(me.error)} Retrying is safe — it never creates a second brokerage.`
                : "The brokerage was created, but your account does not show it yet. Retrying is safe — it never creates a second brokerage."
              : "This takes a few seconds."}
          </p>
          {timedOut && (
            <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 16, flexWrap: "wrap" }}>
              <button type="button" style={btn} onClick={() => { setTimedOut(false); void invalidate(); if (name.trim()) create.mutate(); }}>Retry</button>
              <button type="button" style={ghost} onClick={() => { forget(); window.location.assign("/"); }}>Continue to workspace</button>
            </div>
          )}
        </div>
      </div>
    );

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 16, background: "#fbfcfa", color: "#18231c", fontFamily: "var(--font-body)" }}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) create.mutate();
        }}
        style={{ width: "100%", maxWidth: 440, background: "#fff", border: "1px solid #e5e9e5", borderRadius: 16, padding: 22 }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 20, letterSpacing: "-0.01em", marginBottom: 18 }}>
          <span style={{ width: 30, height: 30, borderRadius: 10, background: "#18231c", color: "#fff", display: "grid", placeItems: "center", fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18 }}>A</span>
          ASAP
        </div>
        <div style={{ fontSize: 12, letterSpacing: "0.04em", fontWeight: 400, color: "#1f6c49" }}>SETUP</div>
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 20, letterSpacing: "-0.02em", margin: "6px 0 6px" }}>Create your brokerage</h1>
        <p style={{ color: "#4c564e", fontSize: 14, lineHeight: 1.55, margin: "0 0 16px" }}>
          Your brokerage is a private workspace over your own clients, policies, documents and email. Nobody outside it can see them.
        </p>
        <label style={{ display: "block", fontSize: 12, fontFamily: "var(--font-display)", fontWeight: 600, color: "#4c564e", marginBottom: 6 }} htmlFor="brokerage-name">
          Brokerage name
        </label>
        <input id="brokerage-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus style={field} />
        <label style={{ display: "flex", gap: 9, alignItems: "flex-start", marginTop: 14, fontSize: 13, color: "#4c564e", lineHeight: 1.5 }}>
          <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} style={{ marginTop: 3 }} />
          I accept the data-processing and security terms for this brokerage.
        </label>
        {create.isError && (
          <div role="alert" style={{ marginTop: 14, background: "#fdeae7", color: "#a43b32", borderRadius: 11, padding: "10px 12px", fontSize: 13 }}>
            {describeApiError(create.error)} Nothing was created — you can retry.
          </div>
        )}
        <button
          type="submit"
          disabled={!canSubmit}
          style={{ marginTop: 18, width: "100%", border: 0, background: "#1f6c49", color: "#fff", borderRadius: 11, padding: "11px 14px", fontFamily: "var(--font-display)", fontSize: 15, fontWeight: 600 }}
        >
          {create.isPending ? "Creating…" : "Create brokerage"}
        </button>
      </form>
    </div>
  );
}
