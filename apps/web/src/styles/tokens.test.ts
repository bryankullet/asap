import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The design tokens must be the prototype's own values.
 *
 * Every number here was measured out of `ASAP.dc.html` — its stylesheet for the globals, a census
 * of its inline styles for the rest, and `scripts/visual/capture.mjs` for the geometry. They are
 * asserted rather than trusted because the failure they guard against is silent: a token nudged to
 * a "nicer" value still builds, still passes every other test, and shows up only as a screenshot
 * diff nobody can explain a week later.
 *
 * If the prototype is revised, re-measure and change these deliberately. Do not relax them to make
 * a diff pass.
 */

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const tokens = read("../../packages/ui/src/styles.css");
const shell = read("src/styles/shell.css");

/** The declared value of one custom property, as written in the token file. */
function token(name: string): string | undefined {
  const m = new RegExp(`^\\s*${name}:\\s*([^;]+);`, "m").exec(tokens);
  return m?.[1]?.trim();
}

describe("the prototype's colours", () => {
  const expected: Record<string, string> = {
    "--color-wash": "#fbfcfa",
    "--color-ink": "#18231c",
    "--color-accent-green": "#1f6c49",
    "--color-sidebar": "#f1f4f0",
    "--color-line": "#e5e9e5",
    "--color-sidebar-line": "#e0e5e0",
    // The two mid inks carry most of the interface; collapsing them loses the hierarchy.
    "--color-ink-secondary": "#4c564e",
    "--color-ink-muted": "#6e776f",
    "--color-paper": "#ffffff",
    "--color-surface-sunken": "#f5f7f4",
    "--color-line-strong": "#d7ded8",
    "--color-line-soft": "#eef1ee",
    "--color-accent-green-soft": "#dff2e6",
    "--color-accent-red": "#a43b32",
    "--color-accent-blue": "#275f8a",
  };

  for (const [name, value] of Object.entries(expected)) {
    it(`${name} is ${value}`, () => {
      expect(token(name)).toBe(value);
    });
  }
});

describe("the prototype's typefaces", () => {
  it("uses DM Sans for interface text", () => {
    expect(token("--font-sans")).toMatch(/^"DM Sans"/);
  });

  it("uses Manrope for headings", () => {
    expect(token("--font-heading")).toMatch(/^"Manrope"/);
  });

  /*
   * The old system's faces have to be gone from the request as well as from the tokens: a font the
   * app no longer uses is still two downloads on every first load, and leaving them invites a
   * component to reach for one.
   */
  it("no longer requests Figtree or Outfit", () => {
    const html = read("index.html");
    expect(html).not.toMatch(/Figtree|Outfit/);
  });

  it("no longer declares the superseded palette anywhere", () => {
    for (const dead of ["#102a43", "#0f7b5a", "#334e68", "#66788a", "#f6f8f9", "#dfe6ea"]) {
      expect(tokens, `${dead} is from the retired system`).not.toContain(dead);
    }
  });
});

describe("shell geometry, as measured", () => {
  const expected: Record<string, string> = {
    "--spacing-sidebar": "228px",
    "--spacing-sidebar-collapsed": "68px",
    "--spacing-workspace-header": "61px",
    "--spacing-ask": "400px",
    "--spacing-mobilenav": "59px",
  };

  for (const [name, value] of Object.entries(expected)) {
    it(`${name} is ${value}`, () => {
      expect(token(name)).toBe(value);
    });
  }

  it("keeps the prototype's two breakpoints", () => {
    expect(token("--breakpoint-ask-stack")).toBe("980px");
    expect(token("--breakpoint-mobile")).toBe("720px");
  });

  /*
   * Ask is a fixed width, not a fraction. Measured: from 1360px to 1440px the pane grows 732→812
   * and Ask stays 400. A percentage would look right at the first viewport and wrong at the second.
   */
  it("expresses the Ask panel as a fixed width", () => {
    expect(token("--spacing-ask")).toMatch(/^\d+px$/);
  });
});

describe("the prototype's radii", () => {
  it("makes the card 13px, its most-used radius", () => {
    expect(token("--radius-card")).toBe("13px");
  });

  it("keeps the control, chip and pill radii distinct", () => {
    expect(token("--radius-control")).toBe("11px");
    expect(token("--radius-chip")).toBe("9px");
    expect(token("--radius-pill")).toBe("99px");
  });
});

describe("one source for a colour", () => {
  /*
   * shell.css was ported with its own `:root` block holding the same hex values. Two copies of a
   * palette drift — that is the whole reason CLAUDE.md names one source — so its short names now
   * resolve through the token file instead of repeating it.
   */
  it("shell.css derives its palette rather than repeating it", () => {
    const root = /:root\s*\{([\s\S]*?)\}/.exec(shell)?.[1] ?? "";
    expect(root).toContain("var(--color-ink)");
    expect(root).toContain("var(--color-accent-green)");
    expect(root).not.toMatch(/#[0-9a-f]{6}/i);
  });
});

/**
 * Three defects that measurement found and no test could have.
 *
 * Each of them built, passed the whole suite, and was wrong on screen: a class name that Tailwind
 * claimed as a utility, a fallback font with different metrics, and a custom property set on the
 * wrong side of a grid. They are asserted here because none of them announces itself.
 */
describe("what measurement caught", () => {
  const shellCss = read("src/styles/prototype-shell.css");

  /*
   * `ps-ask` is not just a name: Tailwind v4 reads `ps-*` as padding-inline-start and `ask` as a
   * spacing token, so `.ps-ask` was silently given `padding-inline-start: 400px`. Any of these
   * prefixes would do the same, so none of them may begin a shell class.
   */
  it("uses no class name Tailwind would read as a spacing utility", () => {
    const reserved = ["p", "px", "py", "ps", "pe", "pt", "pr", "pb", "pl", "m", "mx", "my", "ms", "me", "mt", "mr", "mb", "ml", "w", "h", "gap"];
    const classes = new Set(shellCss.match(/\.[a-z][a-z0-9-]*/g)?.map((c) => c.slice(1)) ?? []);
    const claimed = [...classes].filter((c) => reserved.includes(c.split("-")[0] ?? ""));
    expect(claimed).toEqual([]);
  });

  /*
   * The fallback tail is load-bearing. Until DM Sans arrives the page renders in whatever comes
   * next, and `system-ui` and a bare `sans-serif` do not share metrics — measured, a 1px taller
   * line at 13.5px moved the tab row by 3px. This is the prototype's stack exactly.
   */
  it("falls back the way the prototype falls back", () => {
    expect(token("--font-sans")).toBe('"DM Sans", system-ui, sans-serif');
  });

  /* A second copy of the stack in the shell is how that fallback drifted in the first place. */
  it("keeps one font stack, in the token file", () => {
    expect(shell).not.toMatch(/font-family:\s*"DM Sans",\s*sans-serif/);
  });

  /*
   * The Ask width sizes a grid track, so it has to be declared on the grid container. Set on the
   * panel it would cascade nowhere useful and the grip would move a number nothing read.
   */
  it("declares the Ask width on the grid container, not the panel", () => {
    const shellTsx = read("src/shell/Shell.tsx");
    const askTsx = read("src/shell/AskPanel.tsx");
    expect(shellTsx).toContain("--shell-ask-width");
    expect(askTsx).not.toContain('["--shell-ask-width"');
  });

  /* The dock and the panel were never meant to exist at once, and dead CSS outlives a component. */
  it("has no trace of the bottom Ask dock", () => {
    expect(shell).not.toContain("ask-dock");
    expect(shellCss).not.toContain("ask-dock");
  });
});
