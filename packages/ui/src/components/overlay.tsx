import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "../lib/cn.js";
import { Button } from "./button.js";

function useDismiss(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    // The prototype's `.modal-open`: the page behind must not scroll under the overlay.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);
}

type OverlayProps = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  /** The row of actions at the foot. */
  actions?: ReactNode;
  className?: string;
};

function Panel({
  onClose,
  title,
  children,
  actions,
  className,
  placement,
}: Omit<OverlayProps, "open"> & { placement: "center" | "end" }) {
  return (
    <div
      className={cn(
        "fixed inset-0 z-60 grid bg-navy/[0.38] p-4 backdrop-blur-[3px]",
        placement === "center" ? "place-items-center" : "justify-items-end p-0",
      )}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
        className={cn(
          "overflow-auto bg-paper shadow-card",
          placement === "center"
            ? "max-h-[calc(100dvh-2rem)] w-[min(640px,100%)] rounded-[20px] p-6"
            : "h-dvh max-h-dvh w-[min(540px,100%)] rounded-l-[20px] p-6",
          className,
        )}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="font-heading text-xl font-semibold tracking-tight text-ink">{title}</h2>
          <Button variant="outline" size="icon" aria-label="Close" onClick={onClose}>
            ✕
          </Button>
        </div>
        {children}
        {actions ? <div className="mt-5 flex flex-wrap justify-end gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

/** The prototype's `.modal` over its `.modal-backdrop`. Escape closes; the page behind locks. */
export function Modal(props: OverlayProps) {
  useDismiss(props.open, props.onClose);
  if (!props.open) return null;
  return createPortal(<Panel {...props} placement="center" />, document.body);
}

/** The prototype's `.drawer`: the same panel, docked to the right edge, full height. */
export function Drawer(props: OverlayProps) {
  useDismiss(props.open, props.onClose);
  if (!props.open) return null;
  return createPortal(<Panel {...props} placement="end" />, document.body);
}

/**
 * The prototype's `.toast`: a navy pill at the bottom-right that announces what just happened.
 * It is polite, not an alert — nothing here needs interrupting a screen reader mid-sentence.
 */
export function Toast({ show, children }: { show: boolean; children: ReactNode }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "fixed right-6 bottom-6 z-90 rounded-control bg-navy px-4 py-3 text-sm text-paper shadow-card transition",
        "motion-reduce:transition-none",
        show ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-2.5 opacity-0",
      )}
    >
      {children}
    </div>
  );
}
