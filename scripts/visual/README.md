# Visual parity harness

Measures the production React application against the `ASAP.dc.html` prototype, at the prototype's
own breakpoints, so a parity claim is a measurement rather than an opinion.

## Why this exists at all

The prototype could not be rendered in a sandbox when this was written, and a parity task whose
reference cannot be displayed is a parity task nobody can check. Two things were in the way:

1. **It loads React, ReactDOM and Babel from `unpkg.com` at runtime.** Where egress is restricted
   the loader fails, the runtime never boots, and every pane measures 0×0 — while the static
   stylesheet still applies, so the page *looks* plausibly styled and is in fact empty. That is the
   worst kind of failure: it does not announce itself.
2. **It loads its store and intent modules through dynamic `import()`**, which a `file://` origin
   refuses. Served over HTTP the same file boots.

`vendor-prototype.mjs` fixes both without touching a line of the prototype's own UI: it fetches the
three libraries from the npm registry, writes a copy of the prototype next to them, and repoints
the three CDN constants at the local copies. Subresource integrity is cleared on those three
because an SRI hash pins the CDN's bytes and a local file cannot satisfy it — the bytes are instead
pinned by the exact versions in `LIBS`.

**The prototype is never committed to this repository** and never imported by the application. It is
a design reference (CLAUDE.md, "Sources of truth"); shipping it would be an unauthenticated HTML
application. Pass its path in.

## Use

```bash
node scripts/visual/vendor-prototype.mjs "/path/to/ASAP.dc.html"   # once per prototype revision
node scripts/visual/capture.mjs prototype                          # reference screenshots + geometry
node scripts/visual/capture.mjs app http://127.0.0.1:5173          # the same, against the app
node scripts/visual/compare.mjs                                    # geometry diff + pixel diff
```

Output lands in `.local-visual/`, which is gitignored: screenshots are large, regenerable, and a
capture of the application signed in against real data would put a brokerage's records in the
repository.

## What is compared, and what is not

Dynamic text differs by design — the prototype carries seeded records and production reads the
brokerage's own rows, so a client name or a count will not match and must not be asserted. What is
asserted is everything structural: shell geometry, component placement, widths and heights,
spacing, typography, colour, borders, radii, panel behaviour, responsive layout.
