import {
  DRAFT_COLUMNS,
  DraftRow,
  POLICY_COLUMNS,
  POLICY_PERIOD_COLUMNS,
  RUN_COLUMNS,
  RunRow,
  currentStep,
  focusCard,
  type DraftRow as Draft,
  type RunRow as Run,
  type SpaceBlock,
  type SpacePlan,
  type SpaceView,
  type WorkItemRow,
} from "@asap/schema";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mapDatabaseError } from "../errors.js";

/**
 * The first Renewal Space, composed deterministically from the record the engine already keeps.
 *
 * No model is connected (D-059 gates that on the registry and the validator, both of which are
 * now in place, and on the model decision, which is not made). The plan is built from the shared
 * recipes and the record's own steps, so every value in it was read from a row by id.
 *
 * Composition follows the prototype's `recipe()` and Part 14: the focus block leads, and only the
 * blocks the current intent needs follow it. A follow-up question changes the view, which changes
 * the blocks — it does not navigate through an insurance module.
 *
 *   summary     the renewal as it stands: client, next step, cover period, who has answered
 *   blocker     what is in the way and what unblocks it — the narrowest view
 *   comparison  the terms side by side, with the evidence each one came from
 *   documents   what has been recorded against the record
 *   timeline    the steps and what ASAP did
 *   money       not built. Premium, levies and commission are the money phase (build spec 3).
 */

type Facts = {
  item: WorkItemRow;
  clientName: string;
  clientKind: "individual" | "corporate";
  fileStatus: string | null;
  period: {
    classOfBusiness: string;
    insurerName: string;
    policyNumber: string | null;
    periodStart: string;
    periodEnd: string;
  } | null;
  runs: Run[];
  drafts: Draft[];
};

/** Everything the plan needs, read under the caller's RLS in one pass. */
export async function loadRenewalFacts(db: SupabaseClient, item: WorkItemRow): Promise<Facts> {
  const [clientR, runsR, draftsR] = await Promise.all([
    item.client_id
      ? db.from("clients").select("name, kind, file_status").eq("id", item.client_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    db.from("runs").select(RUN_COLUMNS).eq("work_item_id", item.id).order("started_at", { ascending: false }),
    db.from("drafts").select(DRAFT_COLUMNS).eq("work_item_id", item.id).order("created_at", { ascending: true }),
  ]);
  if (clientR.error) throw mapDatabaseError(clientR.error);
  if (runsR.error) throw mapDatabaseError(runsR.error);
  if (draftsR.error) throw mapDatabaseError(draftsR.error);
  const client = clientR.data as { name: string; kind: string; file_status: string } | null;

  let period: Facts["period"] = null;
  if (item.policy_period_id) {
    const periodR = await db
      .from("policy_periods")
      .select(POLICY_PERIOD_COLUMNS)
      .eq("id", item.policy_period_id)
      .maybeSingle();
    if (periodR.error) throw mapDatabaseError(periodR.error);
    const row = periodR.data as { policy_id: string; period_start: string; period_end: string } | null;
    if (row) {
      const policyR = await db.from("policies").select(POLICY_COLUMNS).eq("id", row.policy_id).maybeSingle();
      if (policyR.error) throw mapDatabaseError(policyR.error);
      const policy = policyR.data as
        | { class_of_business: string; policy_number: string | null; insurer_id: string }
        | null;
      if (policy) {
        const insurerR = await db
          .from("insurers")
          .select("name")
          .eq("id", policy.insurer_id)
          .maybeSingle();
        if (insurerR.error) throw mapDatabaseError(insurerR.error);
        period = {
          classOfBusiness: policy.class_of_business,
          insurerName: ((insurerR.data as { name: string } | null)?.name) ?? "the insurer",
          policyNumber: policy.policy_number,
          periodStart: row.period_start,
          periodEnd: row.period_end,
        };
      }
    }
  }

  return {
    item,
    clientName: client?.name ?? "this client",
    clientKind: (client?.kind === "individual" ? "individual" : "corporate") as Facts["clientKind"],
    fileStatus: client?.file_status ?? null,
    period,
    runs: RunRow.array().parse(runsR.data ?? []),
    drafts: DraftRow.array().parse(draftsR.data ?? []),
  };
}

/** Evidence recorded against every step, in the shape a block cites it with. */
function allEvidence(item: WorkItemRow) {
  return item.steps.flatMap((s) =>
    s.recorded.map((r) => ({
      label: s.label,
      reference: r.reference,
      recordedBy: r.recordedBy,
      recordedAt: r.recordedAt,
    })),
  );
}

/**
 * Which insurers have answered. The names come from the terms step's party (the insurers a person
 * actually requested from) and the state from what has been recorded against that step. There is
 * no quotes table yet — Architecture Phase 9 — so this is what is genuinely on file, and nothing
 * is inferred about an insurer nobody recorded anything for.
 */
function insurerRows(item: WorkItemRow) {
  const step = item.steps.find((s) => s.id === "terms_return");
  if (!step) return [];
  const names = (step.party ?? "")
    .split(",")
    .map((n) => n.trim())
    .filter((n) => n.length > 0);
  return names.map((name) => {
    const record = step.recorded.find((r) => r.reference.toLowerCase().includes(name.toLowerCase()));
    return {
      name,
      state: (record ? "on_file" : "not_on_file") as "on_file" | "not_on_file" | "declined",
      reference: record?.reference ?? null,
      recordedAt: record?.recordedAt ?? null,
    };
  });
}

/** The action the focus block offers: the current step's own actions, with their own reasons. */
function focusActions(item: WorkItemRow): SpaceBlock["actions"] {
  const step = currentStep(item);
  if (!step) return [];
  return step.actions.slice(0, 3).map((a) => ({
    verb: a.verb,
    label: a.label,
    stepId: step.id,
    disabledReason: a.disabledReason,
  }));
}

const block = (
  component: SpaceBlock["component"],
  props: Record<string, unknown>,
  extra: Partial<Pick<SpaceBlock, "evidence" | "actions">> = {},
): SpaceBlock => ({
  component,
  version: 1,
  props,
  evidence: extra.evidence ?? [],
  actions: extra.actions ?? [],
});

function clientHeader(f: Facts): SpaceBlock {
  return block("ClientHeader", {
    clientName: f.clientName,
    clientKind: f.clientKind,
    taskStatus: f.item.task_status,
    taskParty: f.item.task_party,
    taskSince: f.item.task_since,
    fileStatus: f.fileStatus,
  });
}

function focusBlock(f: Facts): SpaceBlock {
  const step = currentStep(f.item);
  const card = focusCard(f.item, step);
  return block(
    "RenewalReadiness",
    {
      eyebrow: "Next step" as const,
      headline: card.headline,
      why: card.why,
      blockedBy: card.blockedBy,
      ready: f.item.steps.filter((s) => s.state === "done").map((s) => s.label),
      outstanding: f.item.steps.filter((s) => s.state !== "done").map((s) => s.label),
    },
    { actions: focusActions(f.item) },
  );
}

function policyBlock(f: Facts): SpaceBlock | null {
  if (!f.period) return null;
  const evidence = allEvidence(f.item).filter((e) => /cover|confirm/i.test(e.label));
  return block(
    "PolicyCard",
    {
      classOfBusiness: f.period.classOfBusiness,
      insurerName: f.period.insurerName,
      policyNumber: f.period.policyNumber,
      periodStart: f.period.periodStart,
      periodEnd: f.period.periodEnd,
      coverStatus: f.item.cover_status,
    },
    {
      // The registry marks PolicyCard as requiring evidence: cover is never asserted uncited.
      evidence:
        evidence.length > 0
          ? evidence
          : [
              {
                label: "Cover for this period",
                reference: "No confirmation recorded yet",
                recordedBy: null,
                recordedAt: null,
              },
            ],
    },
  );
}

function trackerBlock(f: Facts): SpaceBlock | null {
  const insurers = insurerRows(f.item);
  if (insurers.length === 0) return null;
  const onFile = insurers.filter((i) => i.reference !== null);
  return block(
    "InsurerResponseTracker",
    { insurers },
    {
      evidence:
        onFile.length > 0
          ? onFile.map((i) => ({
              label: `${i.name} terms`,
              reference: i.reference!,
              recordedBy: null,
              recordedAt: i.recordedAt,
            }))
          : [
              {
                label: "Insurer terms",
                reference: "Nothing recorded against the terms step yet",
                recordedBy: null,
                recordedAt: null,
              },
            ],
    },
  );
}

function comparisonBlock(f: Facts): SpaceBlock | null {
  const insurers = insurerRows(f.item).filter((i) => i.reference !== null);
  if (insurers.length === 0) return null;
  return block(
    "TermComparison",
    {
      rows: [
        {
          fact: "Terms on file",
          values: insurers.map((i) => ({ insurerName: i.name, value: i.reference! })),
        },
      ],
      // Honest about the limit rather than filling the table with figures nobody recorded.
      note:
        "Premium, levies and commission are not compared yet: the money components arrive with the money phase. What is on file is listed above, with its source.",
    },
    {
      evidence: insurers.map((i) => ({
        label: `${i.name} terms`,
        reference: i.reference!,
        recordedBy: null,
        recordedAt: i.recordedAt,
      })),
    },
  );
}

function draftBlock(f: Facts): SpaceBlock | null {
  const step = currentStep(f.item);
  const draft = [...f.drafts].reverse().find((d) => !step || d.step_id === step.id);
  if (!draft) return null;
  return block(
    "DraftEmail",
    {
      to: draft.to_address,
      subject: draft.subject,
      body: draft.body,
      sentAt: draft.sent_at,
      sentEvidence: draft.sent_evidence,
    },
    {
      actions: step
        ? step.actions
            .filter((a) => a.verb === "record_send")
            .map((a) => ({
              verb: a.verb,
              label: a.label,
              stepId: step.id,
              disabledReason: a.disabledReason,
            }))
        : [],
    },
  );
}

function evidenceBlock(f: Facts): SpaceBlock | null {
  const items = allEvidence(f.item);
  if (items.length === 0) return null;
  return block("SourceEvidence", { items }, { evidence: items });
}

function activityBlock(f: Facts): SpaceBlock | null {
  if (f.runs.length === 0 && allEvidence(f.item).length === 0) return null;
  return block("ActivityFeed", {
    runs: f.runs.map((r) => ({
      title: r.title,
      status: r.status,
      nextStep: r.next_step,
      startedAt: r.started_at,
      endedAt: r.ended_at,
    })),
    recorded: allEvidence(f.item).map((e) => ({
      label: e.label,
      reference: e.reference,
      recordedBy: e.recordedBy,
    })),
  });
}

function checklistBlock(f: Facts): SpaceBlock {
  return block("Checklist", {
    items: f.item.steps.map((s) => ({
      label: s.label,
      state: s.state,
      actor: s.actor,
      note: s.reason,
    })),
  });
}

/** Follow-ups a person would type, as words. Never more than four (UiIntent). */
function suggestions(f: Facts, view: SpaceView): string[] {
  const out: string[] = [];
  if (view !== "comparison" && insurerRows(f.item).some((i) => i.reference !== null))
    out.push("Compare the terms");
  if (view !== "blocker") out.push("What is outstanding?");
  if (view !== "policy" && f.period) out.push("Show me the current policy");
  if (view !== "timeline") out.push("What has ASAP done?");
  return out.slice(0, 4);
}

/**
 * Compose the plan for one view. A block that has nothing to put in it does not render — Part 14's
 * rule, and the reason a renewal with no terms on file does not grow an empty comparison table.
 */
export function renewalPlan(f: Facts, view: SpaceView): SpacePlan {
  const blocks: (SpaceBlock | null)[] = [];
  switch (view) {
    case "blocker":
      blocks.push(focusBlock(f), clientHeader(f), trackerBlock(f), checklistBlock(f));
      break;
    case "comparison":
      blocks.push(focusBlock(f), clientHeader(f), comparisonBlock(f), trackerBlock(f), evidenceBlock(f));
      break;
    case "policy":
      // "Show me the current policy": the policy blocks, keeping the client's context.
      blocks.push(clientHeader(f), policyBlock(f), evidenceBlock(f), checklistBlock(f));
      break;
    case "documents":
      blocks.push(clientHeader(f), evidenceBlock(f), checklistBlock(f));
      break;
    case "timeline":
      blocks.push(clientHeader(f), checklistBlock(f), activityBlock(f));
      break;
    case "money":
      // Nothing is invented here. The money components are build spec Phase 3.
      blocks.push(focusBlock(f), clientHeader(f));
      break;
    case "summary":
    default:
      blocks.push(
        focusBlock(f),
        clientHeader(f),
        policyBlock(f),
        trackerBlock(f),
        draftBlock(f),
        activityBlock(f),
      );
      break;
  }
  return {
    spaceType: "renewal",
    view,
    recordId: f.item.id,
    // Titled as itself (ui-contract): the record's own title, never "Renewal Space".
    title: f.item.title,
    blocks: blocks.filter((b): b is SpaceBlock => b !== null),
    source: "recipe",
    suggestions: suggestions(f, view),
  };
}
