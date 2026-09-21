# Prototype parity: the measured contract

Every value here was read out of `ASAP.dc.html` — never from the integration map, never by eye.
Colours and radii come from a census of its inline styles (that is where it keeps its layout, not
in its stylesheet); geometry comes from `scripts/visual/capture.mjs` rendering it at the three
required viewports.

This file is the contract the five increments are built against, and the thing to re-measure rather
than re-imagine when the prototype is revised.

> **The prototype could not be rendered at first, and failed silently.** It loads React, ReactDOM
> and Babel from `unpkg.com` at runtime; under restricted egress those requests fail, the runtime
> never boots and every pane measures 0×0 — while the static stylesheet still applies, so the page
> looks plausibly styled and is empty. `scripts/visual/vendor-prototype.mjs` fixes that. Any parity
> check run before it would have passed against nothing.

## Shell geometry, measured

| Viewport | `.asap-side` | `.asap-pane` | `.asap-ask` | `.asap-tabs` | mobile nav | overflow |
|---|---|---|---|---|---|---|
| 1360×900 | 228×900 @(0,0) | 732×839 @(228,61) | 400×839 @(960,61) | 260×60 @(242,0) | — | none |
| 1440×900 | 228×900 @(0,0) | **812**×839 @(228,61) | **400**×839 @(1040,61) | 260×60 @(242,0) | — | none |
| 390×844 | absent | 390×560 @(0,61) | 390×520 @(0,**621**) | 60×60 @(14,0) | 390×59 @(0,785) | none |

**The Ask panel is a fixed 400px.** From 1360 to 1440 the pane absorbs all eighty extra pixels and
Ask does not move. Expressing it as a fraction looks correct at the first viewport and wrong at the
second — which is why `--spacing-ask` is a px token and a test asserts it stays one.

**The workspace header spans the full width above both pane and Ask**, not inside the pane. Its
`min-height` is 56px; it measures 60–61px because the tab row carries `padding: 8px 0`.

Breakpoints, from the prototype's own two media queries:

- **980px** — `.asap-body` collapses to one column, Ask loses its left border, gains a top border
  and a `min-height: 520px`; the pane takes `min-height: 560px`.
- **720px** — `.asap-shell` collapses to one column, `.asap-side` is `display:none`,
  `.asap-mobilenav` becomes `display:flex`, sheets go `width:100%`, tabs cap at `max-width:52vw`.

## Sidebar

`background #f1f4f0` · `border-right 1px solid #e0e5e0` · `padding 22px 14px 16px` · flex column.

| Element | Spec |
|---|---|
| Logo row | gap 8px, Manrope 800 22px, `padding 0 4px 22px` |
| Logo mark | 30×30, radius 10px, bg `#18231c`, white, 16.5px |
| Collapse control | 26×26, radius 8px, border 1px `#e0e5e0`, bg `#fff`, colour `#6e776f`, 13.5px; hover border `#c4cfc6` |
| Nav list | flex column, gap 3px |
| Nav item | height **42px**, radius **13px**, `padding 0 11px`, gap 12px, weight 600, **15.5px**; hover `filter: brightness(.97)` |
| Nav icon | width 20px, centred, **18.7px** |
| Nav count | bg `#e4e9e4`, radius 99px, `padding 1px 7px`, 12.5px |
| Bottom group | `margin-top:auto`, gap 3px |
| New | colour `#1f6c49`, weight **700**, 15.5px, height 42, radius 13; hover bg `#e7ebe7` |
| Search | colour `#566058`, weight 600; `⌘ K` right-aligned, colour `#8b938d`, 13px |
| Profile | border 1px `#e0e5e0`, bg `#fff`, radius **14px**, padding 9px, gap 10px, `margin-top 8px` |
| Profile avatar | 30×30, radius 50%, bg `#18231c`, white, 12.5px, weight 700 |
| Profile text | name 13.5px `<strong>`, role 11.5px `#6e776f` |

Order is Today · Work · Automations, then New · Search, then Profile. Counts come from data. When
collapsed, every `.asap-navlabel` is hidden and the items centre (`navJustify`).

## Workspace header

`min-height 56px` · `border-bottom 1px solid #e5e9e5` · `padding 0 14px` · `background #fff` ·
space-between, gap 10px.

**Tab row** — gap 6px, `overflow-x:auto`, `padding 8px 0`, capped at `52vw` under 720px.

| Element | Spec |
|---|---|
| Tab | border 1px, radius **11px**, `padding 6px 8px 6px 10px`, `max-width 260px` |
| Tab kind | 10.5px, tracking `.09em`, weight 700, `opacity .65` |
| Tab title | 13.5px, weight 600, ellipsis, `max-width 180px` |
| Pin | `✚`, 12.5px, colour varies with pinned state |
| More | `•••`, 12.5px, `#8b938d` |
| Close | `×`, 14.5px, `#8b938d` |

**Right cluster** — gap 7px; all three share: border 1px `#e5e9e5`, bg `#fff`, radius **10px**,
`padding 7px 10px`, 13px, weight 600, colour `#4c564e`, hover border `#c4cfc6`.

- **Recent**
- **Activity** — plus a 6px round dot, bg `#1f6c49`, gap 6px; its own background reflects state
- **Ask toggle** — label from state (collapse/open)

## The Space frame

Pane: `padding 20px 22px 40px` · `background #fbfcfa` · `overflow-y:auto`.

| Element | Spec |
|---|---|
| Space kind eyebrow | 10.5px, tracking `.12em`, weight 700, `#1f6c49` |
| Space title | Manrope 700 **24.2px**, `margin 6px 0 0`, line-height 1.25 |
| Status pill | radius 99px, `padding 6px 11px`, 12px, weight 700 |
| Filter chip | radius 99px, `padding 6px 12px`, 13px, weight 600, bordered |
| Block stack | flex column, gap 18px, `margin-top 18px`, **`max-width 900px`** |
| Block label | 10.5px, tracking `.12em`, weight 700, `#6e776f`, `margin-bottom 9px` |
| Facts grid | `repeat(auto-fit, minmax(180px, 1fr))`, `gap 1px` over a `#e5e9e5` background inside a 1px border with radius 13px and `overflow:hidden` — the hairline-table pattern, not real borders per cell |

## Tokens

Counted, not chosen. Radii: **13px** card (20 uses, the most common), 12, 11 control, 10 compact,
9 chip, 99px pill, 50% avatar. Type: 22 / 18.7 / 17.6 / 16.5 / 15.5 / 14.5 / 14 / **13.5** / 13 /
**12.5** / 12 / 11.5 / 11 / 10.5. Weights 700 (36 uses), 600, 800.

The half-pixel sizes are deliberate: 13.5px and 12.5px are the two most common after 12px, and
rounding them to 14 and 13 changes the density of every row and card.

Four ink tones, kept separate because the middle two carry thirty uses each and reading them as one
grey is the fastest way to lose the hierarchy: `#18231c` · `#4c564e` · `#6e776f` · `#8b938d`.

Only two things float: a modal (`0 16px 50px rgba(24,35,28,.2)`) and a sheet
(`-20px 0 60px rgba(12,22,15,.16)`). **A card at rest has a hairline border and a 13px radius and
no shadow at all.**

## Approved production differences

Approved before implementation, each forced by production truth rather than preference:

1. **All business content comes from the API and Supabase.** The prototype's records live in
   `asap-store.js`; that store may be *read* to understand expected behaviour and must never become
   production persistence. Dynamic text and counts will therefore differ — position, typography,
   spacing, colour, size and behaviour may not.
2. **The profile shows the signed-in user**, not the prototype's fixed person.
3. **Ask opens at exactly 400px**, may be resized, and the width may persist as a harmless
   `localStorage` preference. Reset returns it to 400px.

## The measured comparison, Increment 2

Measured with `scripts/visual/capture.mjs`, which records geometry beside the pixels because a
pixel diff tells you *that* something moved and a measurement tells you *what to change*. Twelve
regions, compared role by role rather than by class name — the prototype's layout lives in inline
styles and its own `asap-*` hooks, the application's in `prototype-shell.css`.

The application side is measured through `apps/web/parity/shell-harness/`, a development-only page
that mounts the **shipping** `Shell` and the **shipping** stylesheets over a stubbed `/me` and
empty boards. It exists because the authenticated application cannot be reached by a measuring
script without a real session. It proves geometry, typography, colour and responsive behaviour; it
proves nothing about authentication, RLS, permissions or any business value, and it is not in the
production bundle — `index.html` is the only Rollup input.

**Result: all 12 regions identical at all three viewports — 36 of 36.** No console errors, no
horizontal overflow at any width.

| Region | 1360×900 | 1440×900 | 390×844 |
|---|---|---|---|
| shell | 1360×900 | 1440×900 | 390×844 |
| sidebar | 228×900 | 228×900 | hidden |
| workspace header | 1132×61 | 1212×61 | 390×61 |
| tab strip | 260×60 | 260×60 | 60.1×60 |
| body | 1132×839 | 1212×839 | 390×724 |
| pane | 732×839 | 812×839 | 390×560 |
| Ask | 400×839 | 400×839 | 390×520 |
| nav item | 199×42 | 199×42 | — |
| brand mark | 30×30 | 30×30 | 30×30 |
| collapse toggle | 26×26 | 26×26 | 26×26 |
| tab | 260×44 | 260×44 | 260×44 |
| bottom bar | hidden | hidden | 390×59 |

Going from 1360 to 1440 the pane grows 732→812 and Ask does not move: the sidebar and Ask are
fixed tracks and the pane is the only thing that absorbs width.

### What measurement caught, and code review had not

Five defects that built cleanly, passed the whole suite, and were wrong on screen. Each now has a
test in `src/styles/tokens.test.ts`.

1. **`ps-` is a Tailwind utility.** Tailwind v4 reads `ps-*` as `padding-inline-start` and `ask` as
   a spacing token, so `.ps-ask` was silently given `padding-inline-start: 400px` and
   `.ps-mobilenav` 59px. The prefix is now `shell-`, and a test rejects any shell class beginning
   with a reserved spacing prefix.
2. **The Ask width was on the wrong element.** `--shell-ask-width` was set on the panel, which is
   the grid *item*; the track is sized by the grid *container*. A custom property does not cascade
   upwards, so the grip moved a number nothing read. It is declared on `.shell-body` now.
3. **The fallback font is load-bearing.** `document.fonts.size` is 0 in this sandbox — DM Sans is
   blocked — so both pages rendered their fallback, and `system-ui` and a bare `sans-serif` do not
   share metrics: a 1px taller line at 13.5px moved the tab row by 3px. The token is the
   prototype's stack exactly, and the shell no longer keeps a second copy of it.
4. **A legacy reset outranked the shell.** `shell.css` carries `.demo-root button { font: inherit }`
   at specificity (0,1,1), which beats a single class: the collapse toggle rendered at 22px instead
   of 13.5px, and two more controls at 16px. The shell's own controls are scoped to `.shell-root`
   until the last legacy screen goes.
5. **The bottom bar was outside the shell.** It took its 59px off the shell's height rather than out
   of the workspace column, leaving the shell 785px tall at 390×844 instead of 844.

Two differences were investigated and are **content, not geometry**: the tab strip's width (the
prototype boots with a workspace open) and the strip at 390px (the actions beside it are as wide as
their labels). The capture seeds one open tab — the same `localStorage` key the shell writes, with
an obvious placeholder title — so the strip is measured with something in it.

A whole-page pixel diff is deliberately not the instrument: the prototype's screens are full of
fabricated clients, policies and claims, and the application's are empty until Increment 3 wires
the boards. Screenshots for both are in `.local-visual/shots/`, uncommitted.

## Increment status

| # | Increment | State |
|---|---|---|
| 1 | Tokens and shared primitives | **done** — `ef9c633` |
| 2 | Complete shell | **done** — geometry identical, 36/36 |
| 3 | Today and Work | not started |
| 4 | Every remaining authenticated route | not started |
| 5 | Full visual and interaction testing | harness landed (`3aef109`); shell comparison run, per-screen comparison pending |

### Legacy components still in the tree

Not rendered by the shell, and named here so they are not forgotten:

- `shell/ShellNav.tsx` and `shell/ActivityChip.tsx` — the previous shell's parts. Nothing mounts
  them; only their own tests still reference them. They go with Increment 4.
- `shell/Page.tsx` and `shell/ScreenTitle.tsx` — the older page header, still used *inside* the
  pane by the authenticated screens. Those screens are Increments 3 and 4; a new shell around an
  old page design is not parity, and this is where that debt is recorded.
