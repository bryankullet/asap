import { EXPERIENCE_COMPONENTS, type ComponentInstance } from "@asap/schema";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { REGISTRY } from "../registry/ComponentRegistry.js";
import { useExperience } from "../context/ExperienceContext.js";
import { LayoutRenderer } from "./LayoutRenderer.js";

/** Renders a validated composition: its notices, then its layout tree. */
export function ExperienceRenderer() {
  const { spec } = useExperience();
  return (
    <div className="x-l-stack" data-gap="normal">
      {spec.notices.map((n) => (
        <p key={n.text} className={`x-notice x-tone-${n.tone}`} role="status">
          {n.text}
        </p>
      ))}
      {spec.withdrawn.map((w) => (
        <p key={w.action} className="x-notice x-tone-gold" role="status">
          {w.reason}
        </p>
      ))}
      {spec.context.unavailable.map((u) => (
        <p key={u} className="x-notice x-tone-gold">
          {u}
        </p>
      ))}
      <LayoutRenderer node={spec.layout} />
    </div>
  );
}

/**
 * One registered instance. Its props are validated again against the component's contract before
 * rendering (the server validated the whole spec; this is the second line), and an unregistered or
 * invalid instance renders as an error state, never as anything else.
 */
export function ComponentFrame({ instance }: { instance: ComponentInstance }) {
  const { changed, added } = useExperience();
  const def = EXPERIENCE_COMPONENTS[instance.component];
  const View = REGISTRY[instance.component];
  const props = def?.props.safeParse(instance.props);
  if (!def || !View || !props?.success || def.version !== instance.version) {
    return (
      <section className="x-card" role="alert">
        <p className="x-muted">This part could not be shown safely, so it is left out.</p>
      </section>
    );
  }
  const updated = changed.has(instance.instance);
  return (
    <section className={`x-card${added.has(instance.instance) ? " x-card-enter" : ""}`} data-component={instance.component} data-instance={instance.instance} data-updated={updated ? "true" : "false"} aria-label={instance.title ?? undefined}>
      {instance.title || updated ? (
        <div className="x-card-head">
          {instance.title ? <h2 className="x-card-title">{instance.title}</h2> : <span />}
          {updated ? <span className="x-updated">Updated</span> : null}
        </div>
      ) : null}
      <Boundary>
        <View instance={instance} props={props.data as never} />
      </Boundary>
    </section>
  );
}

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(_e: Error, _i: ErrorInfo) {}
  override render() {
    return this.state.failed ? <p className="x-muted">This part failed to display. The rest of the work is unaffected.</p> : this.props.children;
  }
}
