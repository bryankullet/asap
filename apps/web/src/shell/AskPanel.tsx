import { useCallback, useEffect, useRef } from "react";
import { AskComposer } from "./AskComposer.js";
import {
  ASK_DEFAULT_WIDTH,
  ASK_MAX_WIDTH,
  ASK_MIN_WIDTH,
  type AskPanelState,
} from "./ask-width.js";

/**
 * Ask ASAP, as the prototype's right-hand panel.
 *
 * This replaces the bottom dock. Both were never meant to exist at once: two composers on one
 * screen is two places to type the same question, and the one you did not use looks broken.
 *
 * The panel is a fixed 400px column, resizable by its leading edge, and reset returns it to exactly
 * 400px. Everything about the conversation itself — the model, the gateway, the tools, the
 * validation — stays on the server: `AskComposer` posts to `POST /ask` and no key or model call
 * exists in the browser (§45 rule 4).
 */
export function AskPanel(props: {
  state: AskPanelState;
  /** What the panel says it is looking at, so "this" is never ambiguous. */
  contextLabel: string;
}) {
  const { width, setWidth, resetWidth, resized } = props.state;
  const dragging = useRef(false);
  const panel = useRef<HTMLElement>(null);

  /*
   * Resizing measures from the panel's right edge rather than tracking a delta, so a pointer that
   * outruns the handler (or leaves the window and comes back) cannot leave the width drifting.
   */
  const onMove = useCallback(
    (e: PointerEvent) => {
      if (!dragging.current || !panel.current) return;
      setWidth(panel.current.getBoundingClientRect().right - e.clientX);
    },
    [setWidth],
  );

  const stop = useCallback(() => {
    dragging.current = false;
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
  }, []);

  useEffect(() => {
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", stop);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", stop);
    };
  }, [onMove, stop]);

  return (
    <aside ref={panel} className="shell-ask" aria-label="Ask ASAP">
      {/*
       * The grip is a button, not a bare div: dragging is a mouse gesture, and the arrow keys are
       * how the panel is resizable without one.
       */}
      <button
        type="button"
        className="shell-ask-grip"
        aria-label="Resize the Ask panel"
        aria-valuenow={width}
        aria-valuemin={ASK_MIN_WIDTH}
        aria-valuemax={ASK_MAX_WIDTH}
        role="slider"
        onPointerDown={(e) => {
          dragging.current = true;
          /*
           * Capture keeps the drag alive when the pointer outruns the 6px grip, but it is an
           * enhancement: the window listeners below do the actual work. Not every engine
           * implements it, and a throw here would abandon the drag it was meant to help.
           */
          try {
            e.currentTarget.setPointerCapture?.(e.pointerId);
          } catch {
            /* Dragging still works without capture. */
          }
          document.body.style.cursor = "col-resize";
          document.body.style.userSelect = "none";
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") setWidth(width + 16);
          else if (e.key === "ArrowRight") setWidth(width - 16);
          else if (e.key === "Home") resetWidth();
          else return;
          e.preventDefault();
        }}
      />

      <div className="shell-ask-head">
        <div style={{ minWidth: 0 }}>
          <div className="shell-eyebrow">ASK ASAP</div>
          {/* The context chip: the Space this conversation is about. */}
          <div className="shell-ask-context" title={props.contextLabel}>
            {props.contextLabel}
          </div>
        </div>
        {resized && (
          <button
            type="button"
            className="shell-wsbtn"
            onClick={resetWidth}
            title={`Back to ${ASK_DEFAULT_WIDTH}px`}
          >
            Reset width
          </button>
        )}
      </div>

      <div className="shell-ask-body">
        <AskComposer />
      </div>
    </aside>
  );
}
