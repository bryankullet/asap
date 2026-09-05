import { Card, CardDescription, CardTitle, Notice } from "@asap/ui";
import { useMe } from "../lib/me.js";

/** Placeholder home until Phase 4 brings Discover. Confirms which brokerage is active. */
export function Home() {
  const me = useMe();
  const org = me.data?.active_organization;
  if (!org) return <Notice tone="waiting">Choose a brokerage from the switcher above.</Notice>;
  return (
    <Card className="flex flex-col gap-2">
      <CardTitle>{org.name}</CardTitle>
      <CardDescription>
        {org.country} · {org.currency} · {org.timezone}
      </CardDescription>
      <p className="text-sm text-ink-secondary">
        Your workspace is ready. Discover, Spaces and Ask ASAP arrive in later phases; for now you
        can manage members.
      </p>
    </Card>
  );
}
