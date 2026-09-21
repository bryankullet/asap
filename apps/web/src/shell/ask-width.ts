import { useCallback, useEffect, useState } from "react";

/**
 * How wide the Ask panel is, and whether it is showing at all.
 *
 * The width is a harmless interface preference, so it persists in `localStorage`. Nothing business
 * depends on it and losing it costs a person a drag.
 *
 * **The default is exactly 400px and reset returns exactly 400px.** Measured off the prototype at
 * both desktop viewports: going from 1360 to 1440 the workspace pane absorbs all eighty extra
 * pixels and Ask does not move. So this is a fixed pixel width, never a fraction of the viewport —
 * a percentage would be right at the first viewport and wrong at the second, which is the kind of
 * parity failure that looks fine in one screenshot.
 */

export const ASK_DEFAULT_WIDTH = 400;
/** Narrow enough to be worth keeping open; wide enough to stop it eating the workspace. */
export const ASK_MIN_WIDTH = 320;
export const ASK_MAX_WIDTH = 640;

const WIDTH_KEY = "asap.ask.width.v1";
const OPEN_KEY = "asap.ask.open.v1";

function clamp(px: number): number {
  return Math.min(ASK_MAX_WIDTH, Math.max(ASK_MIN_WIDTH, Math.round(px)));
}

function read(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    // Private windows and blocked site data both throw here. An absent preference is the default,
    // which is the correct answer anyway.
    return null;
  }
}
function write(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    /* A preference that cannot be saved is not worth an error state. */
  }
}

export type AskPanelState = {
  width: number;
  open: boolean;
  setWidth: (px: number) => void;
  /** Back to exactly 400px. */
  resetWidth: () => void;
  toggle: () => void;
  /** True when the person has moved it, so the interface can offer the reset. */
  resized: boolean;
};

export function useAskPanel(): AskPanelState {
  const [width, setWidthState] = useState<number>(() => {
    const stored = read(WIDTH_KEY);
    if (stored === null) return ASK_DEFAULT_WIDTH;
    const n = Number(stored);
    // A corrupted or hand-edited value must not be able to produce a 4px panel.
    return Number.isFinite(n) ? clamp(n) : ASK_DEFAULT_WIDTH;
  });
  const [open, setOpen] = useState<boolean>(() => read(OPEN_KEY) !== "false");

  useEffect(() => write(WIDTH_KEY, String(width)), [width]);
  useEffect(() => write(OPEN_KEY, String(open)), [open]);

  const setWidth = useCallback((px: number) => setWidthState(clamp(px)), []);
  const resetWidth = useCallback(() => setWidthState(ASK_DEFAULT_WIDTH), []);
  const toggle = useCallback(() => setOpen((v) => !v), []);

  return { width, open, setWidth, resetWidth, toggle, resized: width !== ASK_DEFAULT_WIDTH };
}
