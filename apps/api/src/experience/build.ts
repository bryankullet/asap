import { createHash } from "node:crypto";
import {
  ACTION_CLASS,
  EXPERIENCE_COMPONENTS,
  subjectKey,
  type ActionPayload,
  type ActionSpec,
  type ComponentInstance,
  type ExperienceComponentId,
  type ExperienceProps,
  type LayoutNode,
  type SourceRef,
  type SubjectRef,
} from "@asap/schema";

/**
 * A small builder for compositions (D-172). Composers describe *what* the person needs next; these
 * helpers produce the declarative contract — nodes, slots, registered instances, governed actions —
 * and record every record reference used, so validation can refuse anything the composer did not
 * itself load under the viewer's session.
 */

const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 16);
export const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
export const fmtDate = (d: string | null | undefined) => (d ? new Date(d.length === 10 ? `${d}T00:00:00Z` : d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : null);
export const money = (amount: string | number | null | undefined, currency: string | null | undefined) =>
  amount == null || amount === "" || !currency ? null : `${currency} ${Number(amount).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const R = { narrow: "keep" as const };

export class Composition {
  readonly components: ComponentInstance[] = [];
  readonly actions: ActionSpec[] = [];
  /** Keys of records loaded under the viewer's session — the only ones the spec may reference. */
  readonly authorized = new Set<string>();

  allow(...refs: (Pick<SubjectRef, "type" | "id"> | null | undefined)[]): this {
    for (const r of refs) if (r) this.authorized.add(subjectKey(r));
    return this;
  }

  action(id: string, label: string, payload: ActionPayload, extra: { primary?: boolean; confirm?: ActionSpec["confirm"]; disabledReason?: string | null } = {}): string {
    if (!this.actions.some((a) => a.id === id))
      this.actions.push({ id, label: cut(label, 80), class: ACTION_CLASS[payload.kind], payload, primary: extra.primary ?? false, confirm: extra.confirm ?? null, disabledReason: extra.disabledReason ?? null });
    return id;
  }

  /** A registered component instance; returns its slot. */
  put<C extends ExperienceComponentId>(instance: string, component: C, props: ExperienceProps<C>, extra: { title?: string | null; actions?: (string | null)[]; sources?: SourceRef[]; continuity?: ComponentInstance["continuity"]; priority?: "primary" | "secondary"; narrow?: "keep" | "collapse" | "hide" } = {}): LayoutNode {
    const actions = (extra.actions ?? []).filter((a): a is string => !!a);
    const sources = (extra.sources ?? []).slice(0, 20);
    this.components.push({
      instance,
      component,
      version: EXPERIENCE_COMPONENTS[component].version,
      title: extra.title ?? null,
      props: props as Record<string, unknown>,
      sources,
      actions,
      continuity: extra.continuity ?? [],
      hash: hash({ component, props, sources, actions, title: extra.title ?? null }),
    });
    return { type: "slot", id: `s-${instance}`, instance, priority: extra.priority ?? "primary", responsive: { narrow: extra.narrow ?? "keep" } };
  }
}

export const L = {
  stack: (id: string, children: (LayoutNode | null)[], gap: "tight" | "normal" | "loose" = "normal"): LayoutNode => ({ type: "stack", id, gap, children: children.filter((c): c is LayoutNode => !!c), priority: "primary", responsive: R }),
  grid: (id: string, columns: 2 | 3 | 4, children: (LayoutNode | null)[]): LayoutNode => ({ type: "grid", id, columns, children: children.filter((c): c is LayoutNode => !!c), priority: "primary", responsive: R }),
  split: (id: string, a: LayoutNode, b: LayoutNode, ratio: "1:1" | "2:1" | "1:2" = "1:1", narrow: "stack" | "first" = "stack"): LayoutNode => ({ type: "split", id, ratio, narrow, children: [a, b], priority: "primary", responsive: R }),
  flow: (id: string, steps: { id: string; label: string; state: "done" | "current" | "next" }[], current: LayoutNode): LayoutNode => ({ type: "flow", id, steps, current, priority: "primary", responsive: R }),
  table: (id: string, table: LayoutNode, detail: LayoutNode | null): LayoutNode => ({ type: "table", id, table, detail, priority: "primary", responsive: R }),
  dock: (id: string, main: LayoutNode, dock: LayoutNode, side: "end" | "bottom" = "end"): LayoutNode => ({ type: "dock", id, main, dock, side, priority: "primary", responsive: R }),
  focus: (id: string, primary: LayoutNode, context: (LayoutNode | null)[], contextLabel: string): LayoutNode => ({ type: "focus", id, primary, context: context.filter((c): c is LayoutNode => !!c).map((c) => ({ ...c, priority: "secondary" as const, responsive: { narrow: "collapse" as const } })), contextLabel, priority: "primary", responsive: R }),
  /** Wraps a list: one child stays itself, several stack. */
  group: (id: string, children: (LayoutNode | null)[], gap: "tight" | "normal" | "loose" = "normal"): LayoutNode | null => {
    const kids = children.filter((c): c is LayoutNode => !!c);
    return kids.length === 0 ? null : kids.length === 1 ? kids[0]! : L.stack(id, kids, gap);
  },
};
