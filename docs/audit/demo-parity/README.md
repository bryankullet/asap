# Demo parity — measured evidence

The approved interactive demo is the controlling source for the visible product (D-064). This
directory is the evidence that the React implementation matches it, measured rather than asserted.

## How it is measured

```bash
# 1. serve the approved demo (from the zip) and a production build of the port
VITE_PUBLIC_DEMO_MODE=on pnpm --filter @asap/web build
#    original → http://127.0.0.1:4180   react → http://127.0.0.1:4177

# 2. capture both, at four viewports, with fonts/animation/clock/scale pinned
node apps/web/parity/capture.mjs discover ask

# 3. diff them and print the remaining difference
node apps/web/parity/diff.mjs docs/audit/demo-parity Discover-1440x900 Ask-1440x900 …

# 4. explain any residual by region
node apps/web/parity/regions.mjs docs/audit/demo-parity/diff/Ask-1440x900.png

# …or do all of it at once, and fail if anything has drifted past its budget
node apps/web/parity/check.mjs
```

`check.mjs` is the regression gate. It captures, diffs and judges every screen at every viewport
against the budgets recorded below, so a change that moves a card four pixels fails there rather
than in a review. The budgets are the measured numbers plus a small allowance — a loose threshold
that let a visibly different page pass would defeat the point. It needs both applications running;
it is not part of `pnpm test`, because that suite must not depend on a zip being served locally.

`apps/web/parity/capture.mjs` documents what is pinned and why. The one deliberate substitution is
the webfont: Manrope and DM Sans are served from Google, which this environment cannot reach, and
the two pages fall back *differently* (the demo's `font:` shorthand carries no fallback). Both are
therefore aliased to one local family, so the comparison measures structure, spacing, colour and
layout rather than a sandbox artefact.

## Baselines

| Screen | Original | React | Diff | Side by side |
|---|---|---|---|---|
| Discover | `original/Discover-<size>.png` | `react/Discover-<size>.png` | `diff/Discover-<size>.png` | `side-by-side/Discover-<size>.png` |
| Ask ASAP | `original/Ask-<size>.png` | `react/Ask-<size>.png` | `diff/Ask-<size>.png` | `side-by-side/Ask-<size>.png` |
| Work | `original/Work-<size>.png` | `react/Work-<size>.png` | `diff/Work-<size>.png` | `side-by-side/Work-<size>.png` |
| Jobs | `original/Jobs-<size>.png` | `react/Jobs-<size>.png` | `diff/Jobs-<size>.png` | `side-by-side/Jobs-<size>.png` |
| Automations | `original/Automations-<size>.png` | `react/Automations-<size>.png` | `diff/Automations-<size>.png` | `side-by-side/Automations-<size>.png` |

Sizes: `1440x900`, `1360x900`, `1024x768`, `390x844`.

## Measured difference

| Screen | 1440×900 | 1360×900 | 1024×768 | 390×844 |
|---|---|---|---|---|
| Discover | 0.12% | 0.13% | 0.19% | 0.46% |
| Ask ASAP | 0.04% | 0.04% | 0.07% | 0.61% |
| Work | 0.12% | 0.13% | 0.20% | 0.60% |
| Jobs | 0.32% | 0.34% | 0.53% | 1.38% |
| Automations | 0.67% | 0.70% | 0.67% | 0.34% |

### What the residual is

On Discover, Ask and Work the residual is symbol-glyph rendering: the presenter bar's arrows and
check marks, the sidebar's `✦ ⌁ ▱ ◴ ⌘` icons, `⌕`, `＋`. Those glyphs come from a fallback font in
this sandbox and render identically wherever the real webfonts load.

Jobs and Automations each carry one further difference, and both are content, not layout:

- **Jobs** shows a job the demo counts but does not draw. The demo's Work group is headed "2" above
  a single card; the port draws both — the prepared notification and the extraction that could not
  finish. Showing a job that failed is the point of the board.
- **Automations** has six standing instructions where the demo's grid draws three. The other three
  are in the approved catalogue and are real capability; deleting them to match a screenshot would
  be the wrong direction of fit. Every card is the demo's card, and the intro counts what is
  actually switched on.

Both are visible in the side-by-side images, and both are the reason those two screens carry a
larger budget in `check.mjs` than Discover, Ask and Work.

## What was wrong, and how it was found

Every fix below came from a measurement, not from looking at the page:

- Tailwind's preflight cascades `line-height: 1.5` where the demo has `normal` — every card 2px
  taller, accumulating down the page. Restoring `normal` on `.demo-root` fixed the rhythm; applying
  it to `.demo-root *` instead re-declared it on the children of anything that *does* set a
  line-height and silently discarded it, which cost Ask 30px of thread height (`.bubble` is 1.55).
- The old design system's `letter-spacing: -0.02em` on h1/h2/h3 — a 3–14px width error per heading.
- Invented breakpoints (900/1100) against the demo's actual 1000/760.
- `1fr` is `minmax(auto,1fr)`: the main column grew to min-content and overflowed at 1024, moving
  every top-right control 18px. `min-width: 0` on `.product-view`.
- `.client-logo` has no `flex: none` in the original, so at 1024 it *shrinks* from 48px to 25px and
  the whole policy strip shifts 23px. Adding `flex: none` was an improvement, and improvements are
  differences.
- Chromium's UA padding on controls the demo leaves as `<button>`/`<textarea>` (`1px 6px`, `2px`),
  which Tailwind's preflight zeroes.
- Keeping the newest turn in view with `scrollIntoView` on a trailing sentinel scrolls every
  scrollable ancestor; the demo sets the thread's own `scrollTop`. The sentinel left the thread
  scrolled at viewports where the conversation fits.
- Chromium gives form controls `letter-spacing: normal` and does not inherit it; Tailwind's
  preflight makes them inherit. The demo's presenter bar sets 0.02em on the bar, so every control
  in it was 8px out of place.
- A link is inline: its box is the glyphs. The button it replaces is inline-block: its box is the
  line box. Six pixels, and the Ask thread then overflowed and scrolled when the demo's did not.
- `Active <b>8</b>` — the space is the label's only break opportunity. Without it the tab cannot
  wrap, so it never shrinks, so the row is 14px shorter and every tile below it sits too high.
- The harness itself had a defect: switching the demo's views with its own nav sets `display: none`
  on the outgoing one, which resets the scroll position inside it. The Ask thread was therefore
  captured at the top, in a state the demo never shows on its own. It now reloads per screen.
