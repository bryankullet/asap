import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import type { SaveOnboardingRequest } from "@asap/schema";
import { useDocumentUpload } from "../features/documents/upload.js";
import { onboardingSpace } from "../live/onboarding-space.js";
import { api, describeApiError } from "../lib/api.js";
import { useInvalidateMe } from "../lib/me.js";
import { SpaceFrameView } from "../space/SpaceFrame.js";

/**
 * A person's first day (D-082).
 *
 * Four short steps through the one Space renderer, over the real APIs: the brokerage is created
 * by the same idempotent function the sign-up flow used, a file goes through the same upload as
 * the Documents Space, a spreadsheet goes to the same import, and connecting Gmail is the OAuth
 * flow built in 4A-3 — there is no onboarding-shaped copy of any of them.
 *
 * Where it got to is a server row, so a refresh returns a person to the step they were on. Where
 * it has not got to yet is honest: a deployment without Google credentials says Gmail connection
 * is not configured and offers Skip, and Skip is recorded as a decision rather than as navigation.
 */
export function Onboarding() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const invalidate = useInvalidateMe();
  const upload = useDocumentUpload();

  /*
   * One request key for the life of this screen. A second submit, a retry after a lost response,
   * or a double click all carry the same key, and the database returns the same brokerage (0029).
   */
  const [requestKey] = useState(() => crypto.randomUUID());
  /** The step before an organization exists. There is no row to keep it in yet. */
  const [preStep, setPreStep] = useState(1);
  const [failure, setFailure] = useState<string | null>(null);

  const live = useQuery({
    queryKey: ["onboarding"],
    queryFn: () => api.onboarding(),
    retry: false,
  });

  const save = useMutation({
    mutationFn: (input: SaveOnboardingRequest) => api.saveOnboarding(input),
    onSuccess: (res) => qc.setQueryData(["onboarding"], res),
    onError: (e) => setFailure(describeApiError(e)),
  });

  const createCompany = useMutation({
    mutationFn: (v: Record<string, string>) =>
      api.createOrganization({
        name: v["name"] ?? "",
        country: v["country"] ?? "KE",
        currency: v["currency"] ?? "KES",
        timezone: v["timezone"] ?? "Africa/Nairobi",
        accepted_terms: true,
        request_key: requestKey,
      }),
    onSuccess: async () => {
      // The session's active brokerage changed, so everything keyed on it has to be re-read.
      await invalidate();
      await qc.invalidateQueries({ queryKey: ["onboarding"] });
      save.mutate({ step: 2 });
    },
    onError: (e) => setFailure(describeApiError(e)),
  });

  const finish = useMutation({
    mutationFn: () => api.completeOnboarding(),
    onSuccess: (res) => {
      qc.setQueryData(["onboarding"], res);
      void navigate({ to: "/today", replace: true });
    },
    onError: (e) => setFailure(describeApiError(e)),
  });

  const connectGmail = useMutation({
    mutationFn: () => api.connectMailbox("gmail"),
    onSuccess: (res) => {
      if (res.outcome === "authorise") {
        // Google's own page. Nothing is connected until it sends the person back.
        window.location.assign(res.url);
        return;
      }
      /* Never a fake success: what the server said, in its own words. */
      setFailure(res.reason);
    },
    onError: (e) => setFailure(describeApiError(e)),
  });

  const busy =
    save.isPending ||
    createCompany.isPending ||
    finish.isPending ||
    connectGmail.isPending ||
    upload.busy;

  /*
   * Before a brokerage exists there is no row to hold the step, so the first screen is driven
   * locally — and there is nothing to lose to a refresh, because nothing has been created.
   */
  const state = live.data?.onboarding;
  const shown =
    state === undefined ? undefined : state.company === null ? { ...state, step: preStep } : state;

  const space = onboardingSpace(shown, {
    loading: live.isPending,
    /* An onboarding read failing is a different thing to a step failing, and both are shown. */
    error: live.isError ? describeApiError(live.error) : null,
    busy,
    upload: upload.progress,
    uploaded: upload.uploaded,
    uploadError: failure ?? upload.error,
  });

  return (
    <SpaceFrameView
      space={space}
      onAct={(action) => {
        if (action.verb === "open" && action.to) {
          void navigate({ to: action.to.path });
          return;
        }
        // One thing at a time, so a double click cannot write twice.
        if (busy) return;
        setFailure(null);

        const step = action.stepId ?? "";
        const values = (action as { values?: Record<string, string> }).values;
        const files = (action as { files?: File[] }).files ?? [];

        if (step === "company" && values) {
          if (state?.company === null || state?.company === undefined) createCompany.mutate(values);
          else save.mutate({ step: 2 });
          return;
        }
        if (step === "pick" && files[0]) {
          /* The real pipeline: hash, allocate, transfer, tell the API. Nothing onboarding-shaped. */
          upload.send(files[0]);
          save.mutate({ recordsChoice: "upload" });
          return;
        }
        if (step === "records:import") {
          // Recorded before leaving, so the choice survives the trip to the import screen.
          save.mutate({ recordsChoice: "import" });
          void navigate({ to: "/import" });
          return;
        }
        if (step === "records:skip") {
          save.mutate({ recordsChoice: "skip", step: 3 });
          return;
        }
        if (step === "mailbox:connect") {
          save.mutate({ mailboxChoice: "connect" });
          connectGmail.mutate();
          return;
        }
        if (step === "mailbox:skip") {
          save.mutate({ mailboxChoice: "skip", step: 4 });
          return;
        }
        if (step === "finish") {
          finish.mutate();
          return;
        }
        if (step.startsWith("go:")) {
          const to = Number(step.slice(3));
          if (!Number.isInteger(to) || to < 1 || to > 4) return;
          /* Before a brokerage exists there is nowhere to save it; afterwards there always is. */
          if (state?.company === null || state === undefined) setPreStep(to);
          else save.mutate({ step: to });
        }
      }}
    />
  );
}
