import { Notice } from "@asap/ui";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router";
import { Shell } from "./components/Shell.js";
import { useAuth } from "./lib/auth.js";
import { useMe } from "./lib/me.js";
import { AcceptInvitation } from "./pages/AcceptInvitation.js";
import { AuthCallback } from "./pages/AuthCallback.js";
import { CreateOrganization } from "./pages/CreateOrganization.js";
import { Home } from "./pages/Home.js";
import { Members } from "./pages/Members.js";
import { Onboarding } from "./pages/Onboarding.js";
import { SignIn } from "./pages/SignIn.js";
import { SignUp } from "./pages/SignUp.js";

/** Requires a session; sends visitors to sign-in and back again afterwards. */
function RequireSession() {
  const { session, loading } = useAuth();
  const location = useLocation();
  if (loading)
    return (
      <Notice tone="info" className="m-6">
        Loading…
      </Notice>
    );
  if (!session) return <Navigate to="/sign-in" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}

/** Requires at least one active membership; otherwise the create-or-join screen. */
function RequireMembership() {
  const me = useMe();
  if (me.isPending)
    return (
      <Notice tone="info" className="m-6">
        Loading your workspace…
      </Notice>
    );
  if (me.isError)
    return (
      <Notice tone="error" className="m-6">
        We could not load your account. Refresh, or sign in again.
      </Notice>
    );
  const active = me.data.memberships.filter((m) => m.status === "active");
  if (active.length === 0) return <Navigate to="/onboarding" replace />;
  return <Outlet />;
}

export function App() {
  return (
    <Routes>
      <Route path="/sign-in" element={<SignIn />} />
      <Route path="/sign-up" element={<SignUp />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/invite/:token" element={<AcceptInvitation />} />

      <Route element={<RequireSession />}>
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/onboarding/create" element={<CreateOrganization />} />
        <Route element={<RequireMembership />}>
          <Route element={<Shell />}>
            <Route index element={<Home />} />
            <Route path="/members" element={<Members />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
