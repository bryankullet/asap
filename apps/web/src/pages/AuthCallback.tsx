import { Notice } from "@asap/ui";
import { useEffect } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { AuthLayout } from "../components/AuthLayout.js";
import { useAuth } from "../lib/auth.js";

/** Landing for magic links and email confirmations. supabase-js exchanges the code on load. */
export function AuthCallback() {
  const { session, loading } = useAuth();
  const { next } = useSearch({ strict: false }) as { next?: string };
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    if (session)
      void navigate({ to: next && next.startsWith("/") ? next : "/discover", replace: true });
    else void navigate({ to: "/sign-in", replace: true });
  }, [loading, session, next, navigate]);

  return (
    <AuthLayout title="Signing you in…">
      <Notice tone="info">One moment.</Notice>
    </AuthLayout>
  );
}
