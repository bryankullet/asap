"""FastAPI application: health, and reading a document.

`POST /extract` takes the bytes and returns the pages and the values a person might accept from
them, each with where it sits on the page. **Documents never leave our own infrastructure**
(§45 rule 2): PyMuPDF reads them in this process and nothing here calls out.

What comes back is proposed, never known. A person accepts or corrects every field before anything
treats it as true, which is what the extraction review screen is for.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, Header, HTTPException, UploadFile

from . import __version__
from .config import Settings
from .extract import read_document

logger = logging.getLogger("asap.extractor")


# The largest document read in one request. A brokerage's schedule is a few hundred kilobytes; a
# scanned policy wording can be tens of megabytes. Beyond this the answer is "split it" rather than
# an extractor that stops responding while it reads.
MAX_BYTES = 40 * 1024 * 1024


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    logging.basicConfig(level=settings.log_level.upper())

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        yield

    app = FastAPI(title="ASAP extractor", version=__version__, lifespan=lifespan)

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok", "version": __version__, "service": "extractor"}

    @app.post("/extract")
    async def extract(
        file: UploadFile = File(...),
        x_asap_extractor_secret: str | None = Header(default=None),
    ) -> dict[str, object]:
        """Read one document.

        The secret is the platform's, not a person's: this service serves the API, never a browser
        and never a session. A deployment that configured one and did not receive it refuses —
        quietly, without saying which part was wrong.
        """
        if settings.shared_secret is not None:
            if x_asap_extractor_secret is None or not _secrets_match(
                x_asap_extractor_secret, settings.shared_secret
            ):
                raise HTTPException(status_code=401, detail="not authorised")

        data = await file.read()
        if len(data) > MAX_BYTES:
            raise HTTPException(status_code=413, detail="that document is too large to read")
        if not data:
            raise HTTPException(status_code=400, detail="that request carried no document")

        result = read_document(data, file.filename or "document", file.content_type or "")
        # The filename and the page count, never a word of the contents: a document's text does not
        # belong in ordinary logs.
        logger.info(
            "read a document",
            extra={"pages": len(result.pages), "fields": len(result.fields)},
        )
        return result.to_json()

    return app


def _secrets_match(offered: str, expected: str) -> bool:
    """Comparison whose timing does not say how much of the secret was right."""
    if len(offered) != len(expected):
        return False
    difference = 0
    for a, b in zip(offered, expected):
        difference |= ord(a) ^ ord(b)
    return difference == 0


def run() -> None:
    import uvicorn

    settings = Settings.from_env()
    uvicorn.run(
        create_app(settings), host="0.0.0.0", port=settings.port, log_level=settings.log_level
    )


if __name__ == "__main__":
    run()
