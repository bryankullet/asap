"""Reading a document: its pages, and the values a person might accept from it.

Two rules shape every line of this file.

**Documents never leave our own infrastructure** (§45 rule 2). Nothing here calls out; PyMuPDF
reads the bytes in this process and they are discarded when the request ends. There is deliberately
no code path that could send a page anywhere.

**What comes back is proposed, never known** (§45 rule 8). Pages and their text are facts about the
file. A field is a *reading* of it, and it arrives with an evidence condition saying how it was
arrived at — `known` when the document labelled it, `inferred` when it was worked out from shape
alone, `conflicting` when the document says it twice and differently. A person accepts or corrects
each one before anything treats it as true. Nothing here decides; it proposes.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

import pymupdf


@dataclass(frozen=True)
class Page:
    page_number: int
    text: str
    width: float
    height: float


@dataclass(frozen=True)
class Field:
    field_key: str
    value: str | None
    page: int | None
    region: dict[str, float] | None
    condition: str


@dataclass
class Extraction:
    pages: list[Page] = field(default_factory=list)
    fields: list[Field] = field(default_factory=list)

    def to_json(self) -> dict[str, Any]:
        return {
            "pages": [
                {
                    "pageNumber": p.page_number,
                    "text": p.text,
                    "width": p.width,
                    "height": p.height,
                }
                for p in self.pages
            ],
            "fields": [
                {
                    "fieldKey": f.field_key,
                    "value": f.value,
                    "page": f.page,
                    "region": f.region,
                    "condition": f.condition,
                }
                for f in self.fields
            ],
        }


# What a schedule, a debit note or a cover note calls each thing.
#
# Deliberately a table rather than a model. A brokerage must be able to read why a value was
# proposed, and "the document says 'Policy No' on page 1 at this position" is a reason a person can
# check in seconds. It is also why a wrong reading is cheap: the label is visible, so the mistake is
# visible.
LABELS: dict[str, tuple[str, ...]] = {
    "policy_number": ("policy no", "policy number", "policy ref", "certificate no", "certificate number"),
    "insured_name": ("insured", "insured name", "name of insured", "policyholder", "assured"),
    "insurer_name": ("insurer", "underwriter", "insurance company", "company"),
    "class_of_business": ("class", "class of business", "section", "cover", "product"),
    "period_start": ("from", "inception", "inception date", "period from", "effective date"),
    "period_end": ("to", "expiry", "expiry date", "period to", "renewal date"),
    "sum_insured": ("sum insured", "total sum insured", "limit", "limit of liability"),
    "premium": ("premium", "gross premium", "total premium", "annual premium"),
}

# A value that follows its label on the same line, after a colon or run of spaces.
_VALUE_AFTER_LABEL = re.compile(r"^[\s:.\-–]*(.+)$")

# A value has to say something. "Premium:" with nothing after it is a label whose value is missing,
# and proposing ":" would put a colon in front of a person as though it were a figure.
_HAS_SUBSTANCE = re.compile(r"[A-Za-z0-9]")

_DATE = re.compile(r"\b(\d{4}-\d{2}-\d{2}|\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4})\b")
_MONEY = re.compile(r"\b\d{1,3}(?:,\d{3})+(?:\.\d{2})?\b|\b\d+\.\d{2}\b")


def _normalise(text: str) -> str:
    return re.sub(r"[^a-z0-9 ]", " ", text.lower()).strip()


def read_document(data: bytes, filename: str, mime_type: str) -> Extraction:
    """Read one document. Raises nothing for an unreadable file: it returns no pages, and the
    caller decides what to say about that — which is better than a stack trace standing in for an
    answer a person has to act on."""
    out = Extraction()
    try:
        doc = pymupdf.open(stream=data, filetype=_filetype(filename, mime_type))
    except Exception:
        return out

    with doc:
        for index, page in enumerate(doc, start=1):
            out.pages.append(
                Page(
                    page_number=index,
                    text=page.get_text("text"),
                    width=float(page.rect.width),
                    height=float(page.rect.height),
                )
            )
            _read_fields(page, index, out)

    _settle(out)
    return out


def _filetype(filename: str, mime_type: str) -> str:
    lowered = filename.lower()
    for ext in ("pdf", "png", "jpg", "jpeg", "tiff", "bmp", "xps", "epub"):
        if lowered.endswith(f".{ext}"):
            return "pdf" if ext == "pdf" else ext
    if "pdf" in mime_type:
        return "pdf"
    return "pdf"


def _read_fields(page: Any, page_number: int, out: Extraction) -> None:
    """Find labelled values on one page, with where each one sits.

    Position is the point. A figure a person cannot find on the page is a figure they cannot check,
    so every proposal carries the rectangle it was read from and the viewer can highlight it.
    """
    words = page.get_text("words")  # (x0, y0, x1, y1, word, block, line, word_no)
    if not words:
        return

    lines: dict[tuple[int, int], list[tuple[float, float, float, float, str]]] = {}
    for x0, y0, x1, y1, word, block, line, _ in words:
        lines.setdefault((block, line), []).append((x0, y0, x1, y1, word))

    for parts in lines.values():
        parts.sort(key=lambda w: w[0])
        text = " ".join(p[4] for p in parts)
        flat = _normalise(text)

        for key, labels in LABELS.items():
            for label in labels:
                if not flat.startswith(label):
                    continue
                remainder = text[len(label):] if len(text) > len(label) else ""
                match = _VALUE_AFTER_LABEL.match(remainder)
                value = match.group(1).strip(" \t:.-–") if match else ""
                if not value or not _HAS_SUBSTANCE.search(value):
                    continue

                # The rectangle covering the value's own words, not the label's: a highlight over
                # the label would point at the question rather than the answer.
                value_parts = [p for p in parts if p[0] >= parts[0][0] + _label_width(parts, label)]
                region = _bounds(value_parts or parts)
                out.fields.append(
                    Field(
                        field_key=key,
                        value=value,
                        page=page_number,
                        region=region,
                        condition="known",
                    )
                )
                break


def _label_width(parts: list[tuple[float, float, float, float, str]], label: str) -> float:
    """How far along the line the label runs, so the value's own words can be isolated."""
    spent = 0
    for x0, _, x1, _, word in parts:
        spent += len(word) + 1
        if spent >= len(label):
            return x1 - parts[0][0]
    return 0.0


def _bounds(parts: list[tuple[float, float, float, float, str]]) -> dict[str, float]:
    x0 = min(p[0] for p in parts)
    y0 = min(p[1] for p in parts)
    x1 = max(p[2] for p in parts)
    y1 = max(p[3] for p in parts)
    return {"x": x0, "y": y0, "width": max(x1 - x0, 1.0), "height": max(y1 - y0, 1.0)}


def _settle(out: Extraction) -> None:
    """Decide what to do when a document says the same thing more than once, and note what it never
    said at all.

    A schedule that carries two different policy numbers is not a document with one answer and a
    mistake in it — it is a document whose reading is *conflicting*, and saying so is the whole
    point of having conditions. Picking the first, or the one that looks better, would hide exactly
    the thing a person needs to see.
    """
    by_key: dict[str, list[Field]] = {}
    for f in out.fields:
        by_key.setdefault(f.field_key, []).append(f)

    settled: list[Field] = []
    for key, found in by_key.items():
        values = {f.value for f in found if f.value}
        if len(values) > 1:
            # Every reading is kept, each marked conflicting: a person resolves it by looking.
            settled.extend(
                Field(f.field_key, f.value, f.page, f.region, "conflicting") for f in found
            )
        else:
            settled.append(found[0])

    # What the document never said. A missing field is a fact worth proposing: the review screen
    # shows it as missing rather than leaving a person to notice an absence.
    for key in LABELS:
        if key not in by_key:
            settled.append(Field(key, None, None, None, "missing"))

    settled.sort(key=lambda f: (f.page or 999, f.field_key))
    out.fields = settled
