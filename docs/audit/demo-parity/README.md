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
```

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

Sizes: `1440x900`, `1360x900`, `1024x768`, `390x844`.

## Measured difference

| Screen | 1440×900 | 1360×900 | 1024×768 | 390×844 |
|---|---|---|---|---|
| Discover | 0.17% | 0.19% | 0.29% | 0.47% |
| Ask ASAP | 0.12% | 0.14% | 0.20% | 0.62% |

### What the residual is

`regions.mjs` on `diff/Ask-1440x900.png` (1561 px of 1.30M):

```
  presenter bar / content:  629 px
  topbar / content:          97 px
  page body / sidebar:      840 px
  page body / content:       ~0 px
```

So the product's own content area is clean, and the residual is symbol-glyph rendering — the
presenter bar's arrows and check marks, the sidebar's `✦ ⌁ ▱ ◴ ⌘` icons, `⌕`, `＋` — plus the two
nav counts, which read from the port's fixtures rather than the demo's static markup and will match
once the Work fixtures carry the demo's full Active/Waiting/For-review sets.

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
