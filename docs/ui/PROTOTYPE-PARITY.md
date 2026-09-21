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

## Increment status

| # | Increment | State |
|---|---|---|
| 1 | Tokens and shared primitives | **done** — `ef9c633` |
| 2 | Complete shell | in progress |
| 3 | Today and Work | not started |
| 4 | Every remaining authenticated route | not started |
| 5 | Full visual and interaction testing | harness landed (`3aef109`); comparison not yet run |
