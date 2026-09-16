# apps/extractor

Python document-extraction service. Phase 1 ships a stub: `GET /health` and a queue consumer that does nothing.

```bash
cd apps/extractor
python3 -m venv .venv && . .venv/bin/activate

# The exact closure, transitive packages pinned too. Use this in CI and when reproducing a
# deployment.
pip install -r requirements.lock.txt -e .

# Or resolve pyproject's pinned direct dependencies yourself, which is what Render's build does:
#   pip install -e ".[dev]"

APP_ENV=local python -m asap_extractor.main   # http://localhost:8000/health
python -m pytest tests -q
```

**Nothing is installed by hand.** `pyproject.toml` pins every direct dependency with `==` and
`requirements.lock.txt` pins what they pull in (D-077). A clean virtualenv installs from the lock
file and runs the whole suite with no other step — which is the only way "the tests pass" says
anything about whether the deployed service can start.

Regenerate the lock after changing a dependency:

```bash
python3 -m venv /tmp/lock && /tmp/lock/bin/pip install -e ".[dev]"
/tmp/lock/bin/pip freeze --exclude-editable >> requirements.lock.txt   # keep the header
```

Not a pnpm workspace package; it is excluded from `pnpm build`. Phase 3 adds PyMuPDF / pdfplumber extraction with page numbers and bounding boxes. Documents never leave this service for a hosted extraction API (§45).
