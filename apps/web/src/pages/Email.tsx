import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { communicationListSpace, communicationSpace } from "../live/communication-space.js";
import { api, describeApiError } from "../lib/api.js";
import { useMe } from "../lib/me.js";
import { useWorkspaceTabs } from "../shell/workspace-tabs.js";
import { SpaceFrameView } from "../space/SpaceFrame.js";

/**
 * Connected email, through the one Space renderer.
 *
 * The line this file will not cross: **nothing is sent from here.** A reply is written, saved on
 * the server and approved; it leaves ASAP only through a provider send that records the
 * provider's own message id, and this deployment has none — so the Space says so where a Send
 * button would be, rather than offering one whose only effect is a toast.
 */
export function Email() {
  const me = useMe();
  const tabs = useWorkspaceTabs("/email");

  const threads = useQuery({
    queryKey: ["email_threads", me.data?.active_organization?.id],
    queryFn: () => api.emailThreads(),
    enabled: Boolean(me.data?.active_organization?.id),
    retry: false,
  });

  useEffect(() => {
    tabs.open({
      spaceType: "communication",
      recordType: "organization",
      recordId: "email",
      kind: "COMMUNICATION",
      title: "Communication",
      path: "/email",
    });
  }, []);

  const navigate = useNavigate();
  const space = communicationListSpace(threads.data, {
    loading: threads.isPending,
    error: threads.isError ? describeApiError(threads.error) : null,
  });

  return (
    <SpaceFrameView
      space={space}
      onAct={(action) => {
        if (action.verb === "open" && action.to) void navigate({ to: action.to.path });
      }}
    />
  );
}

/**
 * One conversation, as its own tab.
 *
 * Keyed by the thread's id, so opening the same conversation twice focuses the tab that is
 * already there — and two open conversations never share a draft, a recipient list or a link,
 * because the composer's state is keyed by the same id and the saved draft is a server row.
 */
export function EmailThread() {
  const { threadId = "" } = useParams({ strict: false }) as { threadId?: string };
  const qc = useQueryClient();
  const navigate = useNavigate();
  const tabs = useWorkspaceTabs(`/email/${threadId}`);

  /** What is in the composer but not yet saved. Reset whenever the conversation changes. */
  const [composer, setComposer] = useState<
    { to: string; cc: string; subject: string; body: string } | null
  >(null);
  useEffect(() => setComposer(null), [threadId]);

  const detail = useQuery({
    queryKey: ["email_thread", threadId],
    queryFn: () => api.emailThread(threadId),
    retry: false,
  });

  const title = detail.data?.thread.subject;
  useEffect(() => {
    if (title === undefined) return;
    tabs.open({
      spaceType: "communication",
      recordType: "email_thread",
      recordId: threadId,
      kind: "CONVERSATION",
      title: title || "(No subject)",
      path: `/email/${threadId}`,
    });
  }, [title, threadId]);

  const refresh = () => void qc.invalidateQueries({ queryKey: ["email_thread", threadId] });

  const saveDraft = useMutation({
    mutationFn: (v: { to: string; cc: string; subject: string; body: string }) =>
      api.saveEmailDraft(threadId, {
        to: addresses(v.to),
        cc: addresses(v.cc),
        subject: v.subject,
        body: v.body,
      }),
    onSuccess: () => {
      // The server's answer is the truth about the draft, including whether the approval survived.
      setComposer(null);
      refresh();
    },
  });

  const approve = useMutation({
    mutationFn: () => api.approveEmailDraft(threadId),
    onSuccess: refresh,
  });

  const link = useMutation({
    mutationFn: (input: Parameters<typeof api.linkEmailThread>[1]) =>
      api.linkEmailThread(threadId, input),
    onSuccess: refresh,
  });

  const busy = saveDraft.isPending || approve.isPending || link.isPending;
  const space = communicationSpace(
    detail.data,
    {
      loading: detail.isPending,
      error: detail.isError ? describeApiError(detail.error) : null,
      missing: !detail.isPending && !detail.isError && detail.data === undefined,
      busy,
      draft: composer,
    },
    threadId,
  );

  return (
    <SpaceFrameView
      space={space}
      onAct={(action) => {
        if (action.verb === "open" && action.to) {
          /* The provider's own copy is a URL, not a route: it opens rather than navigates. */
          if (action.to.path.startsWith("http")) window.open(action.to.path, "_blank", "noopener");
          else void navigate({ to: action.to.path });
          return;
        }
        // One change at a time, so a double click cannot write twice.
        if (busy) return;
        const step = action.stepId ?? "";

        if (step === "approve") {
          approve.mutate();
          return;
        }
        if (step.startsWith("link:")) {
          const [, target, id] = step.split(":");
          link.mutate(linkPatch(target ?? "", id ?? null));
          return;
        }
        if (step.startsWith("unlink:")) {
          const target = step.slice("unlink:".length);
          link.mutate(linkPatch(target, null));
          return;
        }

        const values = (action as { values?: Record<string, string> }).values;
        if (values) {
          setComposer({
            to: values["to"] ?? "",
            cc: values["cc"] ?? "",
            subject: values["subject"] ?? "",
            body: values["body"] ?? "",
          });
          saveDraft.mutate({
            to: values["to"] ?? "",
            cc: values["cc"] ?? "",
            subject: values["subject"] ?? "",
            body: values["body"] ?? "",
          });
        }
      }}
    />
  );
}

/** A typed recipient list, split the way a person writes one. Empty entries are not addresses. */
function addresses(value: string): string[] {
  return value
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

/** Which link the action is about. Unknown targets change nothing rather than guessing. */
function linkPatch(target: string, id: string | null) {
  if (target === "client") return { clientId: id };
  if (target === "policy") return { policyId: id };
  if (target === "work_item") return { workItemId: id };
  return {};
}
