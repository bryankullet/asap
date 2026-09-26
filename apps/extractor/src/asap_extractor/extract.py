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
from dataclasses import dataclass, field, replace
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


@dataclass(frozen=True)
class Term:
    """One term a quotation states. Several of these share a type: a quotation lists excesses.

    Kept apart from `Field` because the difference is the point. A field answers "what is the
    premium" and there is one answer; a term answers "what excesses apply" and flattening those
    into one value loses the ones that matter.
    """

    ordinal: int
    term_type: str
    label: str
    value: str | None
    amount: str | None
    currency: str | None
    page: int | None
    region: dict[str, float] | None
    condition: str
    method: str


@dataclass
class Extraction:
    pages: list[Page] = field(default_factory=list)
    fields: list[Field] = field(default_factory=list)
    terms: list[Term] = field(default_factory=list)
    #: Why this document cannot be read, when it cannot. An image-only PDF is the common case:
    #: there is no OCR in this deployment, so it is said plainly rather than read as empty.
    needs_manual_review: str | None = None

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
            "terms": [
                {
                    "ordinal": t.ordinal,
                    "termType": t.term_type,
                    "label": t.label,
                    "value": t.value,
                    "amount": t.amount,
                    "currency": t.currency,
                    "page": t.page,
                    "region": t.region,
                    "condition": t.condition,
                    "method": t.method,
                }
                for t in self.terms
            ],
            "needsManualReview": self.needs_manual_review,
        }


# What a schedule, a debit note or a cover note calls each thing.
#
# Deliberately a table rather than a model. A brokerage must be able to read why a value was
# proposed, and "the document says 'Policy No' on page 1 at this position" is a reason a person can
# check in seconds. It is also why a wrong reading is cheap: the label is visible, so the mistake is
# visible.
LABELS: dict[str, tuple[str, ...]] = {
    "policy_number": ("policy no", "policy number", "policy ref", "certificate no", "certificate number"),
    "quotation_reference": ("quotation no", "quotation number", "quotation ref", "quote no", "quote ref"),
    "insured_name": ("name of insured", "insured name", "the insured", "policyholder", "assured", "insured"),
    "insurer_name": ("insurance company", "underwriter", "insurer"),
    "class_of_business": ("class of business", "class", "section", "product"),
    "period_start": ("period from", "inception date", "inception", "effective date", "from"),
    "period_end": ("period to", "expiry date", "expiry", "renewal date", "to"),
    # "limit" is deliberately NOT here. A quotation's limit of liability is a term of cover, not
    # the value of the thing insured, and reading one as the other overstates what is covered.
    "sum_insured": ("total sum insured", "sum insured", "declared value", "value insured"),
    "premium": ("total premium", "gross premium", "annual premium", "premium"),
    "premium_basis": ("premium basis", "rating basis", "basis of premium", "rate"),
    "currency": ("currency",),
    "quote_valid_until": ("quotation valid until", "quote valid until", "valid until", "validity",
                          "quotation validity", "offer valid until"),
}

# Labels short and common enough to appear inside ordinary prose: "subject to anti-theft device"
# is not an expiry date, and "from the date of issue" is not an inception. These are read only
# where they begin a line, which is where a schedule actually puts them.
_ANCHORED_ONLY: frozenset[str] = frozenset(
    {"to", "from", "class", "section", "product", "rate", "insured", "validity", "expiry",
     "inception", "currency", "premium", "underwriter", "insurer", "insurance company"}
)

# Labels that name a party. A charge is not a party, however its name reads.
_PARTY_KEYS: frozenset[str] = frozenset({"insured_name", "insurer_name"})

# Words that make a line a statutory charge rather than a party, a premium or a sum insured.
#
# This is the "Policyholders compensation fund: KES 13,275" defect, fixed at the level it belongs
# to: the line names a fund a premium is charged for, and no label on it can name the insured. The
# same guard stops a training levy being read as a premium.
_CHARGE_CONTEXT = re.compile(
    r"\b(compensation fund|training levy|policyholders? fund|levy|stamp duty|"
    r"withholding tax|\bvat\b|itl\b|pcf\b)",
    re.IGNORECASE,
)

# How far apart two words' baselines may be and still be one visual line, in points.
_LINE_TOLERANCE = 3.0

# Longest label first, so "class of business" is tried before "class". Matching the shorter one
# first proposed the remainder of the heading — "of business" — as the class of business.
_LABELS_LONGEST_FIRST: tuple[tuple[str, str], ...] = tuple(
    sorted(
        ((key, label) for key, labels in LABELS.items() for label in labels),
        key=lambda pair: len(pair[1]),
        reverse=True,
    )
)

# Every label spelling, for rejecting a "value" that is really part of a heading.
_EVERY_LABEL: frozenset[str] = frozenset(label for _, label in _LABELS_LONGEST_FIRST)

# A value that follows its label on the same line, after a colon or run of spaces.
_VALUE_AFTER_LABEL = re.compile(r"^[\s:.\-–]*(.+)$")

# A value has to say something. "Premium:" with nothing after it is a label whose value is missing,
# and proposing ":" would put a colon in front of a person as though it were a figure.
_HAS_SUBSTANCE = re.compile(r"[A-Za-z0-9]")

_DATE = re.compile(r"\b(\d{4}-\d{2}-\d{2}|\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4})\b")
_MONEY = re.compile(r"\b\d{1,3}(?:,\d{3})+(?:\.\d{2})?\b|\b\d+\.\d{2}\b")

# What a value for this key has to look like. A guard against the remaining way a label can pick
# up the wrong words: matching in the right place and still reading a sentence as a date.
_VALUE_SHAPE: dict[str, Any] = {
    "period_start": _DATE,
    "period_end": _DATE,
    "quote_valid_until": _DATE,
    "premium": _MONEY,
    "sum_insured": _MONEY,
}



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
            _read_terms(page, index, out)

    _settle(out)
    # No text on any page means an image-only document. There is no OCR in this deployment, so
    # this says so rather than returning an empty reading that looks like a document with
    # nothing in it.
    if out.pages and not any(p.text.strip() for p in out.pages):
        out.needs_manual_review = (
            "This document has no readable text. It is most likely a scan, and ASAP cannot read "
            "scanned documents yet — the terms have to be entered by hand."
        )
    return out


def _filetype(filename: str, mime_type: str) -> str:
    lowered = filename.lower()
    for ext in ("pdf", "png", "jpg", "jpeg", "tiff", "bmp", "xps", "epub"):
        if lowered.endswith(f".{ext}"):
            return "pdf" if ext == "pdf" else ext
    if "pdf" in mime_type:
        return "pdf"
    return "pdf"


def _starts_with_label(flat: str, label: str) -> bool:
    """True when the line begins with this label as a whole word or phrase.

    `startswith` alone matches "policyholders compensation fund" against the label "policyholder",
    which is how a statutory charge came to be proposed as the insured's name.
    """
    if not flat.startswith(label):
        return False
    rest = flat[len(label):]
    return rest == "" or not rest[0].isalnum()


def _up_to_the_next_label(value: str) -> str:
    """Cut a value at the point another label begins on the same line.

    A two-column line read as one string carries the next column's label and value. Keeping them
    would propose "01/01/2027 Period to: 31/12/2027" as an inception date.
    """
    flat = _normalise(value)
    cut = len(value)
    for _key, label in _LABELS_LONGEST_FIRST:
        at = flat.find(label)
        # Only a label that starts a word, and not one at position 0 — that is this value's own.
        while at > 0:
            before_ok = not flat[at - 1].isalnum()
            rest = flat[at + len(label):]
            after_ok = rest == "" or not rest[0].isalnum()
            # And only a label that introduces a value of its own. "Rate of 4.5% on declared
            # value" ends with a label; cutting there would truncate the basis to "Rate of 4.5%
            # on". A label with nothing after it is part of this value's words.
            tail = value[at + len(label):]
            introduces = tail.startswith(":") or tail.startswith("  ")
            if before_ok and after_ok and introduces:
                cut = min(cut, at)
                break
            at = flat.find(label, at + 1)
    return value[:cut].strip(" \t:.-–")


def _read_fields(page: Any, page_number: int, out: Extraction) -> None:
    """Find labelled values on one page, with where each one sits.

    Position is the point. A figure a person cannot find on the page is a figure they cannot check,
    so every proposal carries the rectangle it was read from and the viewer can highlight it.

    **Lines are assembled from geometry, not from PyMuPDF's line numbers.** A real schedule puts
    the label in one column and the value in another, and those are separate text insertions: the
    PDF's own idea of a "line" splits them, so a label ended up with no value beside it and seven
    fields out of eight read as missing against an ordinary two-column schedule. Grouping words by
    their baseline is how the same problem was solved for imported tables, and it is the same
    problem.
    """
    words = page.get_text("words")  # (x0, y0, x1, y1, word, block, line, word_no)
    if not words:
        return

    # Words whose baselines agree to within a couple of points are on the same visual line. The
    # tolerance is deliberately coarse: a schedule's rows are far further apart than this.
    lines: dict[int, list[tuple[float, float, float, float, str]]] = {}
    for x0, y0, x1, y1, word, _block, _line, _ in words:
        lines.setdefault(round(y0 / _LINE_TOLERANCE), []).append((x0, y0, x1, y1, word))

    for parts in lines.values():
        parts.sort(key=lambda w: w[0])
        text = " ".join(p[4] for p in parts)
        flat = _normalise(text)

        charge = bool(_CHARGE_CONTEXT.search(text))

        # Every label on the line, not only one at the front. A quotation puts "Period from" and
        # "Period to" in two columns of one visual line, and a matcher that only looks at the
        # start reads the first and never sees the second.
        for key, label, at in _labels_on(flat):
            # A line that names a charge names no party and states no premium, whatever label
            # happens to sit on it. This is the "Policyholders compensation fund" defect.
            if charge and (key in _PARTY_KEYS or key in {"premium", "sum_insured"}):
                continue

            after = text[at + len(label):] if len(text) > at + len(label) else ""
            match = _VALUE_AFTER_LABEL.match(after)
            value = match.group(1).strip(" \t:.-–") if match else ""
            # Cut at the next label, so one column's value does not carry the next column's.
            value = _up_to_the_next_label(value)
            if not value or not _HAS_SUBSTANCE.search(value):
                continue
            # A value that is itself a label is the rest of a heading, not an answer.
            if _normalise(value) in _EVERY_LABEL:
                continue
            # And a value that cannot be what this key holds is not proposed at all. An honest
            # missing beats a date that is really the tail of a sentence.
            shape = _VALUE_SHAPE.get(key)
            if shape is not None and not shape.search(value):
                continue

            # The rectangle covering the value's own words, so a highlight points at the answer
            # rather than at the question.
            region = _bounds(_words_spanning(parts, text, at + len(label), len(value), value))
            out.fields.append(
                Field(field_key=key, value=value, page=page_number, region=region, condition="known")
            )


def _labels_on(flat: str) -> list[tuple[str, str, int]]:
    """Every label occurrence on a line, most specific first, one field key at most once.

    Character offsets into the normalised text, which `_normalise` keeps aligned with the original
    because it substitutes rather than deletes.
    """
    found: list[tuple[str, str, int]] = []
    claimed: list[tuple[int, int]] = []
    seen: set[str] = set()
    for key, label in _LABELS_LONGEST_FIRST:
        if key in seen:
            continue
        at = flat.find(label)
        while at >= 0:
            before_ok = at == 0 or not flat[at - 1].isalnum()
            rest = flat[at + len(label):]
            after_ok = rest == "" or not rest[0].isalnum()
            overlaps = any(at < e and at + len(label) > b for b, e in claimed)
            anchored_ok = at == 0 or label not in _ANCHORED_ONLY
            if before_ok and after_ok and not overlaps and anchored_ok:
                found.append((key, label, at))
                claimed.append((at, at + len(label)))
                seen.add(key)
                break
            at = flat.find(label, at + 1)
    found.sort(key=lambda f: f[2])
    return found


def _words_spanning(
    parts: list[tuple[float, float, float, float, str]], text: str, start: int, length: int, value: str
) -> list[tuple[float, float, float, float, str]]:
    """The words of `text` covering [start, start+length), so a region bounds the value alone."""
    del length
    begin = text.find(value, start) if value else start
    finish = begin + len(value)
    spanning: list[tuple[float, float, float, float, str]] = []
    at = 0
    for part in parts:
        word_start = at
        at += len(part[4]) + 1
        if word_start < finish and at > begin:
            spanning.append(part)
    return spanning or parts


# What kind of term a quotation's own label names. Ordered: the first rule that matches wins, so
# the more specific patterns come first. Deliberately a table for the same reason `LABELS` is —
# a brokerage can read why a line was classified the way it was.
_TERM_RULES: tuple[tuple[str, Any], ...] = (
    ("subjectivity", re.compile(r"\b(subjectivit(y|ies)|subject to)\b", re.IGNORECASE)),
    ("exclusion", re.compile(r"\b(exclusions?|excluded|excluding|not covered)\b", re.IGNORECASE)),
    ("condition", re.compile(r"\b(conditions?|warrant(y|ies)|clause)\b", re.IGNORECASE)),
    ("excess", re.compile(r"\b(excess(es)?|deductibles?)\b", re.IGNORECASE)),
    ("limit", re.compile(r"\b(limits?|limit of liability|liability limit)\b", re.IGNORECASE)),
    ("benefit", re.compile(r"\b(benefits?|extensions?|optional)\b", re.IGNORECASE)),
    ("levy", re.compile(r"\b(levy|levies|compensation fund|pcf|itl|stamp duty)\b", re.IGNORECASE)),
    ("tax", re.compile(r"\b(taxe?s?|vat|withholding)\b", re.IGNORECASE)),
)

# A value the insurer stated but nobody can compare. Recorded as unclear rather than as a value,
# because "as per policy wording" against a figure is not two comparable excesses.
_UNCOMPARABLE = re.compile(
    r"\b(as per (the )?(policy )?wording|per wording|to be (advised|confirmed)|tbc|tba|refer to)\b",
    re.IGNORECASE,
)

_CURRENCY = re.compile(r"\b(KES|KSH|USD|EUR|GBP|TZS|UGX)\b", re.IGNORECASE)
_CURRENCY_CANON = {"KSH": "KES"}

# What makes a gap a column break rather than a word space. Relative to the line's own spacing,
# because a 9-point table and a 14-point one both have columns; an absolute threshold reads one
# of them as a single run of prose.
_COLUMN_GAP_RATIO = 1.8
_COLUMN_GAP_MINIMUM = 9.0


def _read_terms(page: Any, page_number: int, out: Extraction) -> None:
    """Find the terms a quotation states, one row per occurrence.

    A quotation states several excesses and several exclusions. `_read_fields` answers "what is
    the premium" and holds one value per key; this answers "what excesses apply" and must not
    flatten them, because the one it dropped is the one that mattered.

    A line is split into what the document calls the term and what it says about it — at a colon
    where there is one, otherwise at a column gap wide enough not to be a word space. A line with
    neither, following a term, is that term continuing: real quotations wrap their conditions.
    """
    words = page.get_text("words")
    if not words:
        return

    lines: dict[int, list[tuple[float, float, float, float, str]]] = {}
    for x0, y0, x1, y1, word, _block, _line, _ in words:
        lines.setdefault(round(y0 / _LINE_TOLERANCE), []).append((x0, y0, x1, y1, word))

    previous: Term | None = None
    for _key in sorted(lines):
        parts = sorted(lines[_key], key=lambda w: w[0])
        text = " ".join(p[4] for p in parts).strip()
        if not text:
            continue

        split = _split_label_and_value(parts, text)
        if split is None:
            # No label on this line. If the last line was a term, this is it continuing.
            # A continuation is a line that does not *begin* a new labelled row. Testing for a
            # label anywhere would break on an exclusion that happens to mention the underwriter.
            begins_a_row = any(at == 0 for _k, _l, at in _labels_on(_normalise(text)))
            # Nor is a line naming a term of its own a continuation of the last one, whatever
            # its layout: swallowing it would hide a limit inside an excess.
            if (
                previous is not None
                and _HAS_SUBSTANCE.search(text)
                and not begins_a_row
                and _classify(text) is None
            ):
                joined = f"{previous.value or ''} {text}".strip()
                out.terms[-1] = replace(
                    previous,
                    value=joined,
                    region=_merge(previous.region, _bounds(parts)),
                )
                previous = out.terms[-1]
            continue

        label, value, value_parts = split
        term_type = _classify(label)
        if term_type is None:
            previous = None
            continue
        if not value or not _HAS_SUBSTANCE.search(value):
            previous = None
            continue

        amount, currency = _money(value)
        unclear = bool(_UNCOMPARABLE.search(value))
        term = Term(
            ordinal=len(out.terms),
            term_type=term_type,
            label=label.strip(" \t:.-–"),
            value=value,
            amount=amount,
            currency=currency,
            page=page_number,
            region=_bounds(value_parts or parts),
            condition="unclear" if unclear else "known",
            method="labelled_line",
        )
        out.terms.append(term)
        previous = term


def _split_label_and_value(
    parts: list[tuple[float, float, float, float, str]], text: str
) -> tuple[str, str, list[tuple[float, float, float, float, str]]] | None:
    """Where the document stops naming the term and starts saying what it is."""
    colon = text.find(":")
    if 0 < colon < len(text) - 1:
        label = text[:colon]
        value = text[colon + 1:].strip()
        consumed = 0
        value_parts = []
        for part in parts:
            consumed += len(part[4]) + 1
            if consumed > colon + 1:
                value_parts.append(part)
        return label, value, value_parts

    # No colon: a table row, whose columns are separated by a gap no word space would leave.
    gaps = [parts[i][0] - parts[i - 1][2] for i in range(1, len(parts))]
    if not gaps:
        return None
    ordinary = sorted(gaps)[len(gaps) // 2]
    for index, gap in enumerate(gaps, start=1):
        if gap >= _COLUMN_GAP_MINIMUM and gap >= ordinary * _COLUMN_GAP_RATIO:
            label = " ".join(p[4] for p in parts[:index])
            value = " ".join(p[4] for p in parts[index:])
            return label, value, parts[index:]
    return None


def _classify(label: str) -> str | None:
    for term_type, pattern in _TERM_RULES:
        if pattern.search(label):
            return term_type
    return None


def _money(value: str) -> tuple[str | None, str | None]:
    """The figure and its currency, when the value states one. Never guessed from a bare number:
    an amount without a currency cannot be compared against another brokerage's, and a percentage
    is not an amount at all."""
    currency = _CURRENCY.search(value)
    money = _MONEY.search(value)
    if currency is None or money is None:
        return None, None
    # "5% of claim, minimum KES 30,000" states a minimum, not a premium; the figure is still the
    # only comparable number on the line, so it is kept beside the words rather than instead.
    code = currency.group(1).upper()
    return money.group(0).replace(",", ""), _CURRENCY_CANON.get(code, code)


def _merge(a: dict[str, float] | None, b: dict[str, float]) -> dict[str, float]:
    if a is None:
        return b
    x0 = min(a["x"], b["x"])
    y0 = min(a["y"], b["y"])
    x1 = max(a["x"] + a["width"], b["x"] + b["width"])
    y1 = max(a["y"] + a["height"], b["y"] + b["height"])
    return {"x": x0, "y": y0, "width": max(x1 - x0, 1.0), "height": max(y1 - y0, 1.0)}


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
