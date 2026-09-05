import { Notice } from "@asap/ui";
import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { AuthLayout } from "../components/AuthLayout.js";
import { useAuth } from "../lib/auth.js";

/** Landing for magic links and email confirmations. supabase-js exchanges the code on load. */
export function AuthCallback() {
  const { session, loading } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    const next = params.get("next");
    navigate(session ? (next && next.startsWith("/") ? next : "/") : "/sign-in", { replace: true });
  }, [loading, session, params, navigate]);

  return (
    <AuthLayout title="Signing you in…">
      <Notice tone="info">One moment.</Notice>
    </AuthLayout>
  );
}
