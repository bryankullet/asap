import {
  COVER_LABELS,
  MONEY_LABELS,
  RUN_LABELS,
  TASK_LABELS,
  FILE_LABELS,
  STOCK_LABELS,
  taskLabel,
  type CoverStatus as CoverStatusValue,
  type FileStatus as FileStatusValue,
  type MoneyStatus as MoneyStatusValue,
  type RunStatus as RunStatusValue,
  type StockStatus as StockStatusValue,
  type TaskStatus as TaskStatusValue,
} from "@asap/schema";
import { Badge, type BadgeTone } from "@asap/ui";
import { createContext, useContext, type ReactNode } from "react";

/**
 * Position is enforced by component, not by discipline (UI Build Spec v1 Part 2.3). Each status
 * component reads the slot it is rendered in and throws when the slot is wrong, in every build:
 * a status word in the wrong place is a defect, not a styling issue.
 */
export type Slot =
  | "CardHeadline"
  | "RecordHeader.Task"
  | "PolicyPeriodLine"
  | "MoneyRow"
  | "ActivityPanel"
  | "RunDetail"
  | "ClientHeader"
  | "FilesScreen"
  | "CertificatesScreen"
  | "WorkCard";

const SlotContext = createContext<Slot[]>([]);

export function SlotProvider({ slot, children }: { slot: Slot; children: ReactNode }) {
  const outer = useContext(SlotContext);
  return <SlotContext.Provider value={[...outer, slot]}>{children}</SlotContext.Provider>;
}

function useRequireSlot(
  component: string,
  allowed: readonly Slot[],
  forbidden: readonly Slot[] = [],
) {
  const slots = useContext(SlotContext);
  const current = slots[slots.length - 1];
  if (!current || !allowed.includes(current)) {
    throw new Error(
      `<${component}> may only render inside ${allowed.map((s) => `<${s}>`).join(", ")}; found ${current ? `<${current}>` : "no slot"}.`,
    );
  }
  for (const f of forbidden) {
    if (slots.includes(f)) throw new Error(`<${component}> must never appear inside <${f}>.`);
  }
}

// ---- slots -------------------------------------------------------------------------------------

export function CardHeadline({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <SlotProvider slot="CardHeadline">
      <div className={className ?? "flex flex-wrap items-center gap-2"}>{children}</div>
    </SlotProvider>
  );
}

export function RecordHeaderTask({ children }: { children: ReactNode }) {
  return <SlotProvider slot="RecordHeader.Task">{children}</SlotProvider>;
}

export function PolicyPeriodLine({ children }: { children: ReactNode }) {
  return (
    <SlotProvider slot="PolicyPeriodLine">
      <div className="flex flex-wrap items-center gap-2 text-sm text-ink-secondary">{children}</div>
    </SlotProvider>
  );
}

export function MoneyRow({ children }: { children: ReactNode }) {
  return (
    <SlotProvider slot="MoneyRow">
      <div className="flex flex-wrap items-center gap-2 text-sm text-ink-secondary">{children}</div>
    </SlotProvider>
  );
}

export function ActivityPanelSlot({ children }: { children: ReactNode }) {
  return <SlotProvider slot="ActivityPanel">{children}</SlotProvider>;
}

export function RunDetailSlot({ children }: { children: ReactNode }) {
  return <SlotProvider slot="RunDetail">{children}</SlotProvider>;
}

export function WorkCardSlot({ children }: { children: ReactNode }) {
  return <SlotProvider slot="WorkCard">{children}</SlotProvider>;
}

// ---- status components ---------------------------------------------------------------------

const TASK_TONE: Record<TaskStatusValue, BadgeTone> = {
  needs_you: "review",
  with_party: "waiting",
  in_progress: "active",
  done: "neutral",
};

export function formatSince(since: string | Date): string {
  const d = typeof since === "string" ? new Date(since) : since;
  return d.toLocaleDateString("en-KE", { day: "numeric", month: "short" });
}

export type TaskStatusProps = {
  status: TaskStatusValue;
  party?: string | null | undefined;
  since?: string | null | undefined;
};

/** `with_party` cannot be constructed without a party and a since date: taskLabel() throws. */
export function TaskStatus({ status, party, since }: TaskStatusProps) {
  useRequireSlot("TaskStatus", ["CardHeadline", "RecordHeader.Task"]);
  const label = taskLabel({ status, party, since });
  return (
    <Badge tone={TASK_TONE[status]} data-layer="task">
      {label}
      {status === "with_party" && since ? ` since ${formatSince(since)}` : null}
    </Badge>
  );
}

const COVER_TONE: Record<CoverStatusValue, BadgeTone> = {
  draft: "neutral",
  requested: "waiting",
  submitted: "waiting",
  confirmed: "active",
  active: "active",
  expired: "review",
  cancelled: "neutral",
};

export function CoverStatus({ status }: { status: CoverStatusValue }) {
  useRequireSlot("CoverStatus", ["PolicyPeriodLine"]);
  return (
    <Badge tone={COVER_TONE[status]} data-layer="cover">
      {COVER_LABELS[status]}
    </Badge>
  );
}

const MONEY_TONE: Record<MoneyStatusValue, BadgeTone> = {
  not_invoiced: "neutral",
  unpaid: "waiting",
  part_paid: "waiting",
  paid: "active",
  received: "active",
  reconciled: "neutral",
  disputed: "review",
  due_to_insurer: "waiting",
  settled: "neutral",
};

export function MoneyStatus({ status }: { status: MoneyStatusValue }) {
  useRequireSlot("MoneyStatus", ["MoneyRow"]);
  return (
    <Badge tone={MONEY_TONE[status]} data-layer="money">
      {MONEY_LABELS[status]}
    </Badge>
  );
}

const RUN_TONE: Record<RunStatusValue, BadgeTone> = {
  working: "active",
  paused: "waiting",
  finished: "neutral",
  could_not_finish: "review",
  stopped: "review",
};

export function RunStatus({ status }: { status: RunStatusValue }) {
  useRequireSlot("RunStatus", ["ActivityPanel", "RunDetail"]);
  return (
    <Badge tone={RUN_TONE[status]} data-layer="run">
      {RUN_LABELS[status]}
    </Badge>
  );
}

/** Part 2.4: never inside a work card. An incomplete file is a blocked step there, with a reason. */
export function FileStatus({ status }: { status: FileStatusValue }) {
  useRequireSlot("FileStatus", ["ClientHeader", "FilesScreen"], ["WorkCard"]);
  return <Badge data-layer="file">{FILE_LABELS[status]}</Badge>;
}

export function StockStatus({ status }: { status: StockStatusValue }) {
  useRequireSlot("StockStatus", ["CertificatesScreen"], ["WorkCard"]);
  return <Badge data-layer="stock">{STOCK_LABELS[status]}</Badge>;
}

export { TASK_LABELS };
