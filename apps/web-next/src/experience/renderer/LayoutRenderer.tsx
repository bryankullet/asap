import type { LayoutNode } from "@asap/schema";
import { useState, type ReactNode } from "react";
import { useExperience } from "../context/ExperienceContext.js";
import { ComponentFrame } from "./ExperienceRenderer.js";

/**
 * The generic layout renderer (D-172). It knows nine spatial primitives and nothing about insurance:
 * a split is two compatible regions, a flow is a guided sequence, a table is a list with a detail.
 * Narrow screens follow each node's validated responsive rule — keep, collapse behind a disclosure,
 * or hide secondary content — so a desktop split becomes a focused sequence on a phone without a
 * separate screen. Keys are the nodes' stable ids, so recomposition keeps what did not change.
 */
export function LayoutRenderer({ node }: { node: LayoutNode }): ReactNode {
  const { narrow } = useExperience();
  if (narrow && node.responsive.narrow === "hide" && node.priority === "secondary") return null;
  const inner = <Primitive node={node} />;
  if (narrow && node.responsive.narrow === "collapse") {
    return (
      <details className="x-collapsible" data-node={node.id}>
        <summary>{labelOf(node)}</summary>
        {inner}
      </details>
    );
  }
  return inner;
}

function labelOf(node: LayoutNode): string {
  if (node.type === "focus") return node.contextLabel;
  return "More";
}

function Primitive({ node }: { node: LayoutNode }): ReactNode {
  const { narrow, spec } = useExperience();
  switch (node.type) {
    case "slot": {
      const instance = spec.components.find((c) => c.instance === node.instance);
      return instance ? <ComponentFrame key={instance.instance} instance={instance} /> : null;
    }
    case "stack":
      return (
        <div className="x-l-stack" data-gap={node.gap} data-node={node.id}>
          {node.children.map((c) => (
            <LayoutRenderer key={c.id} node={c} />
          ))}
        </div>
      );
    case "grid":
      return (
        <div className="x-l-grid" data-cols={node.columns} data-node={node.id}>
          {node.children.map((c) => (
            <LayoutRenderer key={c.id} node={c} />
          ))}
        </div>
      );
    case "split": {
      const [a, b] = node.children;
      if (narrow && node.narrow === "first")
        return (
          <div className="x-l-stack" data-gap="normal" data-node={node.id}>
            <LayoutRenderer node={a} />
            <details className="x-collapsible">
              <summary>Beside this</summary>
              <LayoutRenderer node={b} />
            </details>
          </div>
        );
      return (
        <div className="x-l-split" data-ratio={node.ratio} data-node={node.id}>
          <LayoutRenderer key={a.id} node={a} />
          <LayoutRenderer key={b.id} node={b} />
        </div>
      );
    }
    case "flow":
      return (
        <section className="x-l-flow" data-node={node.id} aria-label="Steps">
          <ol className="x-flow-steps">
            {node.steps.map((s) => (
              <li key={s.id} data-state={s.state} aria-current={s.state === "current" ? "step" : undefined}>
                {s.label}
              </li>
            ))}
          </ol>
          <LayoutRenderer node={node.current} />
        </section>
      );
    case "table":
      return (
        <div className="x-l-table" data-detail={node.detail ? "true" : "false"} data-node={node.id}>
          <LayoutRenderer key={node.table.id} node={node.table} />
          {node.detail ? <LayoutRenderer key={node.detail.id} node={node.detail} /> : null}
        </div>
      );
    case "tabs":
      return <Tabs node={node} />;
    case "overlay":
      return (
        <div data-node={node.id}>
          <LayoutRenderer node={node.base} />
          {node.overlay ? (
            <div className="x-overlay-scrim" role="presentation">
              <div className="x-overlay-sheet" role="dialog" aria-modal="true" aria-label={node.title ?? "Details"}>
                <div className="x-overlay-body">
                  <LayoutRenderer node={node.overlay} />
                </div>
              </div>
            </div>
          ) : null}
        </div>
      );
    case "dock":
      return (
        <div className="x-l-dock" data-side={node.side} data-node={node.id}>
          <div className="x-l-dock-main">
            <LayoutRenderer node={node.main} />
          </div>
          <aside className="x-l-dock-side" aria-label="Context">
            <LayoutRenderer node={node.dock} />
          </aside>
        </div>
      );
    case "focus":
      return (
        <div className="x-l-focus" data-node={node.id}>
          <LayoutRenderer node={node.primary} />
          {node.context.length ? (
            <details className="x-l-focus-context">
              <summary>{node.contextLabel}</summary>
              <div className="x-l-stack" data-gap="normal">
                {node.context.map((c) => (
                  <LayoutRenderer key={c.id} node={{ ...c, responsive: { narrow: "keep" } }} />
                ))}
              </div>
            </details>
          ) : null}
        </div>
      );
  }
}

function Tabs({ node }: { node: Extract<LayoutNode, { type: "tabs" }> }) {
  const [active, setActive] = useState(node.active);
  const current = node.tabs.find((t) => t.id === active) ?? node.tabs[0]!;
  return (
    <div className="x-l-tabs" data-node={node.id}>
      <div role="tablist" aria-label="Views">
        {node.tabs.map((t, i) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${node.id}-${t.id}`}
            aria-selected={t.id === current.id}
            aria-controls={`panel-${node.id}`}
            tabIndex={t.id === current.id ? 0 : -1}
            className="x-btn x-btn-sm"
            onClick={() => setActive(t.id)}
            onKeyDown={(e) => {
              if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
              const next = node.tabs[(i + (e.key === "ArrowRight" ? 1 : node.tabs.length - 1)) % node.tabs.length]!;
              setActive(next.id);
              document.getElementById(`tab-${node.id}-${next.id}`)?.focus();
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${node.id}`} aria-labelledby={`tab-${node.id}-${current.id}`}>
        <LayoutRenderer node={current.child} />
      </div>
    </div>
  );
}
