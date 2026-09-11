import type { Session } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "./supabase.js";
import { DEMO_MODE } from "../demo/mode.js";

type AuthContextValue = {
  session: Session | null;
  /** True until the first session lookup has completed. */
  loading: boolean;
};

const AuthContext = createContext<AuthContextValue>({ session: null, loading: true });

/**
 * The public demonstration has no session and never looks for one (D-065): no `getSession`, no
 * token refresh, no auth listener. It is not "signed out waiting to sign in" — there is nothing to
 * sign in to — so `loading` is false from the first render and the shell mounts immediately.
 */
const DEMO_AUTH: AuthContextValue = { session: null, loading: false };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthContextValue>(
    DEMO_MODE ? DEMO_AUTH : { session: null, loading: true },
  );

  useEffect(() => {
    if (DEMO_MODE) return;
    let cancelled = false;
    void supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setState({ session: data.session, loading: false });
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setState({ session, loading: false });
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
