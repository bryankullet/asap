import { useParams } from "@tanstack/react-router";
import { EmptyState, MissingData } from "../components/states.js";
import { useMe } from "../lib/me.js";

/** A01. Automations are built in Phase 7 of the UI spec; until then the list is honestly empty. */
export function Automations() {
  const me = useMe();
  const org = me.data?.active_organization;
  return (
    <EmptyState
      scope={`automations for ${org?.name ?? "your brokerage"}`}
      freshness="Nothing is switched on. Automations that send anything outside the brokerage always need approval first."
    />
  );
}

export function AutomationDetail() {
  const { id = "" } = useParams({ strict: false }) as { id?: string };
  return (
    <MissingData
      what="No automation with that id"
      why={`Nothing is switched on yet, so ${id} cannot be found.`}
    />
  );
}
