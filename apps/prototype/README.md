# ASAP prototype (static)

The "hire an assistant" prototype: landing page, hiring and naming an assistant, a guided first visit, and the workspace (Today / Everything), with file import (Excel, CSV, PDF), real sending through WhatsApp or email links, and work saved in the browser.

It is a single built page (`index.html`) plus `audio/` (pre-recorded voice lines), `img/` (portraits) and `samples/` (test files for the importer). It talks to no ASAP backend.

Publish it on Render's `asap-web` service by setting `ASAP_FRONTEND=prototype` (see `apps/web/scripts/build-for-render.mjs`). Roll back with `ASAP_FRONTEND=next` or `legacy`.

Off claude.ai, features that need Claude inside the page (AI-written edits, reading scanned PDFs and photos) fall back: edits use the built-in rules, and scans show a "can't read scans here" message.
