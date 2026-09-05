# apps/extractor

Python document-extraction service. Phase 1 ships a stub: `GET /health` and a queue consumer that does nothing.

```bash
cd apps/extractor
python -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]"
python -m asap_extractor.main      # http://localhost:8000/health
pytest
```

Not a pnpm workspace package; it is excluded from `pnpm build`. Phase 3 adds PyMuPDF / pdfplumber extraction with page numbers and bounding boxes. Documents never leave this service for a hosted extraction API (§45).
