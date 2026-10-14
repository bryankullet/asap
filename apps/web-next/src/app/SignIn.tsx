import { useState } from "react";
import { supabase } from "../services/auth.js";

/** Sign in with the same Supabase account as the current ASAP app. */
export function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<"idle" | "busy" | { error: string }>("idle");
  return (
    <main className="x-main">
      <form
        className="x-signin x-card"
        onSubmit={async (e) => {
          e.preventDefault();
          setState("busy");
          const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
          setState(error ? { error: error.message === "Invalid login credentials" ? "That email and password do not match an account." : "Signing in did not work. Try again." } : "idle");
        }}
      >
        <h1>Sign in to ASAP</h1>
        <div>
          <label className="x-label" htmlFor="email">
            Email
          </label>
          <input id="email" className="x-input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="x-label" htmlFor="password">
            Password
          </label>
          <input id="password" className="x-input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {typeof state === "object" ? (
          <p className="x-field-error" role="alert">
            {state.error}
          </p>
        ) : null}
        <button type="submit" className="x-btn" data-primary="true" aria-disabled={state === "busy" ? "true" : "false"}>
          {state === "busy" ? <span className="x-working">Signing in</span> : "Sign in"}
        </button>
      </form>
    </main>
  );
}
