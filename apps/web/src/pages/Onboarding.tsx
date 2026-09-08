import { Button, Card, CardDescription, CardTitle } from "@asap/ui";
import { Link } from "@tanstack/react-router";
import { AuthLayout } from "../components/AuthLayout.js";
import { supabase } from "../lib/supabase.js";

/**
 * Work item 4 acceptance: a new signup with no organization lands here, not on a broken
 * dashboard. Joining happens through an invitation link; there is no public directory of
 * brokerages to browse.
 */
export function Onboarding() {
  return (
    <AuthLayout
      title="Create or join a brokerage"
      subtitle="You are signed in, but not yet part of a brokerage workspace."
    >
      <Card className="flex flex-col gap-3">
        <CardTitle>Create a brokerage</CardTitle>
        <CardDescription>
          Set up a private workspace for your brokerage. You become its administrator.
        </CardDescription>
        <Button asChild variant="accent">
          <Link to="/onboarding/create">Create a brokerage</Link>
        </Button>
      </Card>
      <Card className="flex flex-col gap-3">
        <CardTitle>Join an existing brokerage</CardTitle>
        <CardDescription>
          Ask your brokerage administrator to invite you. The invitation email contains a link that
          brings you straight in.
        </CardDescription>
      </Card>
      <Button
        variant="ghost"
        size="sm"
        className="self-start"
        onClick={() => void supabase.auth.signOut()}
      >
        Sign out
      </Button>
    </AuthLayout>
  );
}
