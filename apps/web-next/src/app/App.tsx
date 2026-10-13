import type { MeResponse } from "@asap/schema";
import type { Session } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import { ExperienceHost } from "../experience/ExperienceHost.js";
import { Home } from "../home/Home.js";
import { ApiError, api } from "../services/asap-api.js";
import { supabase } from "../services/auth.js";
import { navigate, useRoute } from "./router.js";
import { SignIn } from "./SignIn.js";

/**
 * The application frame. Every destination requires a session and an active brokerage, resolved by
 * the API from that session — the browser never asserts either. A brokerage switch returns to Home:
 * experiences belong to one person in one brokerage, so nothing from the previous one carries over.
 */
export function App() {
  const [session, setSession] = useState<Session | null | "loading">("loading");
  const [me, setMe] = useState<MeResponse | "loading" | "error">("loading");
  const [title, setTitle] = useState("");
  const route = useRoute();

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const loadMe = useCallback(() => {
    setMe("loading");
    api
      .me()
      .then(setMe)
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) void supabase.auth.signOut();
        setMe("error");
      });
  }, []);
  useEffect(() => {
    if (session && session !== "loading") loadMe();
  }, [session, loadMe]);

  useEffect(() => {
    if (route.name === "home") setTitle("");
  }, [route]);

  if (session === "loading") return <div className="x-main" aria-busy="true" />;
  if (!session) return <SignIn />;
  if (me === "loading") return <div className="x-main" aria-busy="true" aria-label="Signing in" />;
  if (me === "error")
    return (
      <main className="x-main">
        <div className="x-card" role="alert" style={{ maxWidth: 560 }}>
          <h2>Not connected</h2>
          <p className="x-muted" style={{ marginTop: 8 }}>
            ASAP could not confirm your account. Check the connection and try again.
          </p>
          <div className="x-row" style={{ marginTop: 16 }}>
            <button type="button" className="x-btn" onClick={loadMe}>
              Try again
            </button>
            <button type="button" className="x-btn" data-quiet="true" onClick={() => void supabase.auth.signOut()}>
              Sign out
            </button>
          </div>
        </div>
      </main>
    );
  if (!me.active_organization)
    return (
      <main className="x-main">
        <div className="x-card" style={{ maxWidth: 560 }}>
          <h2>No brokerage yet</h2>
          <p className="x-muted" style={{ marginTop: 8 }}>
            Your account is not a member of a brokerage. Accept an invitation, or set one up in the current ASAP app.
          </p>
        </div>
      </main>
    );

  const active = me.active_organization;
  const switchTo = async (orgId: string) => {
    if (orgId === active.id) return;
    await api.setActiveOrganization(orgId);
    navigate("/", { replace: true });
    loadMe();
  };

  return (
    <div className="x-app">
      <header className="x-top">
        <a
          className="x-brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate("/");
          }}
        >
          ASAP
        </a>
        <span className="x-top-title" aria-live="polite">
          {route.name === "experience" ? title : ""}
        </span>
        <div className="x-org">
          {me.memberships.filter((m) => m.status === "active").length > 1 ? (
            <>
              <label htmlFor="org" className="x-sr">
                Brokerage
              </label>
              <select id="org" className="x-select" style={{ minHeight: 34, padding: "4px 10px", width: "auto" }} value={active.id} onChange={(e) => void switchTo(e.target.value)}>
                {me.memberships
                  .filter((m) => m.status === "active")
                  .map((m) => (
                    <option key={m.organization.id} value={m.organization.id}>
                      {m.organization.name}
                    </option>
                  ))}
              </select>
            </>
          ) : (
            <span className="x-small x-muted">{active.name}</span>
          )}
          <button type="button" className="x-btn x-btn-sm" data-quiet="true" onClick={() => void supabase.auth.signOut()}>
            Sign out
          </button>
        </div>
      </header>
      <main className="x-main" key={active.id}>
        {route.name === "home" ? <Home /> : route.name === "experience" ? <ExperienceHost key={route.id} id={route.id} onTitle={setTitle} /> : <NotFound />}
      </main>
    </div>
  );
}

function NotFound() {
  return (
    <div className="x-card" style={{ maxWidth: 560 }}>
      <h2>Nothing here</h2>
      <p className="x-muted" style={{ marginTop: 8 }}>
        This address does not open anything.
      </p>
      <button type="button" className="x-btn" style={{ marginTop: 16 }} onClick={() => navigate("/")}>
        Back to Home
      </button>
    </div>
  );
}
