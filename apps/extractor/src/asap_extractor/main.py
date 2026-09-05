"""FastAPI application: a health endpoint and a queue consumer that does nothing yet.

Phase 3 replaces the consumer with the real pipeline: PyMuPDF/pdfplumber extraction of text,
tables, page numbers and bounding boxes, returned as structured JSON to the TypeScript workers.
Documents are never sent to a hosted extraction API (§45).
"""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from . import __version__
from .config import Settings

logger = logging.getLogger("asap.extractor")


async def consume_queue(stop: asyncio.Event, poll_seconds: float = 5.0) -> None:
    """Placeholder consumer. Wakes on an interval and does nothing until Phase 3 wires the
    ingestion queue. Kept as a real task so the service shape does not change later."""
    while not stop.is_set():
        try:
            await asyncio.wait_for(stop.wait(), timeout=poll_seconds)
        except TimeoutError:
            logger.debug("queue poll: no consumer registered yet")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    logging.basicConfig(level=settings.log_level.upper())

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        stop = asyncio.Event()
        task = asyncio.create_task(consume_queue(stop))
        try:
            yield
        finally:
            stop.set()
            await task

    app = FastAPI(title="ASAP extractor", version=__version__, lifespan=lifespan)

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok", "version": __version__, "service": "extractor"}

    return app


def run() -> None:
    import uvicorn

    settings = Settings.from_env()
    uvicorn.run(
        create_app(settings), host="0.0.0.0", port=settings.port, log_level=settings.log_level
    )


if __name__ == "__main__":
    run()
