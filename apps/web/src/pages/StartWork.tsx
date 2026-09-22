import { useMutation } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type {
  CreateClientResponse,
  CreatePolicyResponse,
  CreateWorkItemResponse,
  SpaceFrameAction,
} from "@asap/schema";
import { CREATE_KINDS, createSpace, createSpaceTitle, type CreateKind } from "../live/create-space.js";
import { api, describeApiError } from "../lib/api.js";
import { useWorkspaceTabs } from "../shell/workspace-tabs.js";
import { SpaceFrameView } from "../space/SpaceFrame.js";

/**
 * One creation flow, as its own Space.
 *
 * This replaces the page that carried six forms behind a tab row. Every field, every `required`
 * and every piece of copy came with it; what changed is that each flow is now its own Space with
 * its own address and its own tab, so starting a claim and starting a renewal are two pieces of
 * work rather than two states of one screen.
 *
 * **Nothing is created by arriving here.** The sheet that opened it wrote nothing, and this writes
 * only when a person fills the form in and submits it. The submit button disables itself while the
 * request is in flight, so one click is one write.
 */
export function StartWork() {
  const { kind: raw } = useParams({ strict: false }) as { kind?: string };
  const navigate = useNavigate();
  const kind: CreateKind = CREATE_KINDS.includes(raw as CreateKind)
    ? (raw as CreateKind)
    : "client";
  const tabs = useWorkspaceTabs(`/new/${kind}`);

  const [outcome, setOutcome] = useState<
    CreateClientResponse | CreatePolicyResponse | CreateWorkItemResponse | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  /** What was typed last, so answering "which client?" does not retype the whole form. */
  const [last, setLast] = useState<Record<string, string>>({});

  useEffect(() => {
    tabs.open({
      spaceType: "route",
      recordType: "creation",
      recordId: kind,
      kind: "NEW",
      title: createSpaceTitle(kind),
      path: `/new/${kind}`,
    });
  }, [kind]);

  const fail = (e: unknown) => setError(describeApiError(e));

  const createClient = useMutation({
    mutationFn: (input: { name: string; kind: "corporate" | "individual"; confirmNew: boolean }) =>
      api.createClient(input),
    onMutate: () => setError(null),
    onError: fail,
    onSuccess: (res) => {
      setOutcome(res);
      if (res.outcome === "created") {
        void navigate({ to: "/files/$clientId", params: { clientId: res.file.client.id } });
      }
    },
  });

  const createPolicy = useMutation({
    mutationFn: api.createPolicy,
    onMutate: () => setError(null),
    onError: fail,
    onSuccess: (res) => {
      setOutcome(res);
      if (res.outcome === "recorded") {
        void navigate({
          to: "/r/$recordId",
          params: { recordId: res.policy.policy.id },
          search: { kind: "policy" },
        });
      }
    },
  });

  const createWork = useMutation({
    mutationFn: api.createWorkItem,
    onMutate: () => setError(null),
    onError: fail,
    onSuccess: (res) => {
      setOutcome(res);
      // Opened — including reopened — is the only outcome that leads anywhere on its own.
      if (res.outcome === "opened") {
        void navigate({ to: "/r/$recordId", params: { recordId: res.item.id } });
      }
    },
  });

  const busy = createClient.isPending || createPolicy.isPending || createWork.isPending;

  /** Submit, with either the typed client name or the id a person just chose. */
  function submit(values: Record<string, string>, clientId?: string, confirmNew = false) {
    setLast(values);
    const named = (k: string) => (values[k] ?? "").trim();
    const base = clientId ? { clientId } : { clientName: named("clientName") };

    if (kind === "client") {
      createClient.mutate({
        name: named("clientName"),
        kind: named("clientKind") === "individual" ? "individual" : "corporate",
        confirmNew,
      });
      return;
    }
    if (kind === "policy") {
      createPolicy.mutate({
        ...base,
        insurerName: named("insurerName"),
        classOfBusiness: named("classOfBusiness"),
        ...(named("policyNumber") ? { policyNumber: named("policyNumber") } : {}),
        periodStart: named("periodStart"),
        periodEnd: named("periodEnd"),
      });
      return;
    }
    if (kind === "renewal") {
      createWork.mutate({
        kind,
        ...base,
        insurers: named("insurers")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      });
      return;
    }
    if (kind === "claim") {
      createWork.mutate({
        kind,
        ...base,
        incidentOn: named("incidentOn"),
        incidentSummary: named("incidentSummary"),
        source: "manual",
      });
      return;
    }
    createWork.mutate({
      kind,
      ...base,
      requestText: named("requestText"),
      requestedBy: "policyholder",
      ...(named("effectiveOn") ? { effectiveOn: named("effectiveOn") } : {}),
    });
  }

  const space = createSpace(kind, { busy, error, outcome });

  return (
    <SpaceFrameView
      space={space}
      onAct={(action) => {
        if (action.verb === "open" && action.to) {
          void navigate({ to: action.to.path });
          return;
        }
        /* The form hands its values through; every other action reuses the last ones. */
        const values = (action as SpaceFrameAction & { values?: Record<string, string> }).values ?? last;
        const step = action.stepId ?? "";
        if (step === "create") submit(values);
        else if (step === "confirm-new") submit(values, undefined, true);
        else if (step.startsWith("choose:")) submit(values, step.slice("choose:".length));
      }}
    />
  );
}

/**
 * `/new`, the linkable address of the sheet.
 *
 * The sheet itself belongs to the shell, so that what is behind it stays mounted. This component
 * is what a link to `/new` lands on: it sends the person to Today, and the shell opens the sheet
 * over it. The address is the point — a sheet nobody can link to is a sheet nobody can share.
 */
export function OpenNewSheet() {
  const navigate = useNavigate();
  useEffect(() => {
    void navigate({ to: "/today", replace: true });
  }, [navigate]);
  return null;
}
