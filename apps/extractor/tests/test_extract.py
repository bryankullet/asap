"""Reading a document.

What these hold is the boundary the whole extraction path rests on: **a reading is proposed, never
known.** A value the document labelled is `known`; one the document gives twice and differently is
`conflicting` and both readings survive; one it never gives at all is `missing` and says so. A
pipeline that quietly picked a winner would hide the exact thing a person needs to see.
"""

from __future__ import annotations

from asap_extractor.extract import read_document


def _pdf(lines: list[str]) -> bytes:
    """A real PDF with those lines on one page. Built by hand so the test shares no code with the
    reader it is testing."""
    content = "BT /F1 11 Tf 50 740 Td 16 TL\n" + "".join(f"({l}) Tj T*\n" for l in lines) + "ET"
    objs = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        "/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
        f"<< /Length {len(content)} >>\nstream\n{content}\nendstream",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>",
    ]
    out = "%PDF-1.4\n"
    offsets = []
    for i, o in enumerate(objs, start=1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n{o}\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n" + "".join(
        f"{o:010d} 00000 n \n" for o in offsets
    )
    out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n"
    return out.encode("latin-1")


SCHEDULE = [
    "POLICY SCHEDULE",
    "Policy No:        MAR-4471-2026",
    "Insured:          Tamarind Exporters Ltd",
    "Insurer:          Jubilee Allianz",
    "Class:            Marine Cargo",
    "From:             2026-01-01",
    "To:               2026-12-31",
    "Sum Insured:      45,000,000.00",
    "Premium:          1,250,000.00",
]


def _by_key(result) -> dict[str, list]:
    out: dict[str, list] = {}
    for f in result.fields:
        out.setdefault(f.field_key, []).append(f)
    return out


def test_reads_the_pages_of_a_document() -> None:
    result = read_document(_pdf(SCHEDULE), "schedule.pdf", "application/pdf")
    assert len(result.pages) == 1
    assert result.pages[0].page_number == 1
    assert "MAR-4471-2026" in result.pages[0].text
    # The page's own dimensions, so a region can be placed on any rendering of it.
    assert result.pages[0].width > 0 and result.pages[0].height > 0


def test_proposes_the_values_a_schedule_labels() -> None:
    fields = _by_key(read_document(_pdf(SCHEDULE), "schedule.pdf", "application/pdf"))
    assert fields["policy_number"][0].value == "MAR-4471-2026"
    assert fields["insured_name"][0].value == "Tamarind Exporters Ltd"
    assert fields["period_start"][0].value == "2026-01-01"
    assert fields["premium"][0].value == "1,250,000.00"


def test_every_proposal_says_where_it_was_read_from() -> None:
    # A figure a person cannot find on the page is a figure they cannot check.
    fields = _by_key(read_document(_pdf(SCHEDULE), "schedule.pdf", "application/pdf"))
    region = fields["premium"][0].region
    assert region is not None
    assert fields["premium"][0].page == 1
    assert region["width"] > 0 and region["height"] > 0


def test_a_labelled_value_is_known() -> None:
    fields = _by_key(read_document(_pdf(SCHEDULE), "schedule.pdf", "application/pdf"))
    assert fields["policy_number"][0].condition == "known"


def test_what_the_document_never_said_is_missing_not_absent() -> None:
    # A field nobody proposed is still worth proposing: the review screen shows it as missing
    # rather than leaving a person to notice an absence.
    fields = _by_key(read_document(_pdf(["Policy No: X-1"]), "thin.pdf", "application/pdf"))
    assert fields["premium"][0].value is None
    assert fields["premium"][0].condition == "missing"


def test_two_different_answers_are_conflicting_and_both_survive() -> None:
    # A schedule carrying two policy numbers is not a document with one answer and a mistake in it.
    # Picking one would hide the thing a person most needs to see.
    doubled = ["Policy No:  MAR-4471", "Policy No:  MAR-9999"]
    fields = _by_key(read_document(_pdf(doubled), "doubled.pdf", "application/pdf"))
    assert len(fields["policy_number"]) == 2
    assert {f.condition for f in fields["policy_number"]} == {"conflicting"}
    assert {f.value for f in fields["policy_number"]} == {"MAR-4471", "MAR-9999"}


def test_the_same_answer_twice_is_not_a_conflict() -> None:
    repeated = ["Policy No:  MAR-4471", "Policy No:  MAR-4471"]
    fields = _by_key(read_document(_pdf(repeated), "repeated.pdf", "application/pdf"))
    assert {f.condition for f in fields["policy_number"]} == {"known"}


def test_an_unreadable_file_returns_no_pages_rather_than_raising() -> None:
    # The caller decides what to say about it. A stack trace is not an answer a person can act on.
    result = read_document(b"this is not a document", "broken.pdf", "application/pdf")
    assert result.pages == []


def test_a_label_with_no_value_proposes_nothing() -> None:
    fields = _by_key(read_document(_pdf(["Premium:", "Policy No: X-1"]), "a.pdf", "application/pdf"))
    assert fields["premium"][0].value is None
    assert fields["premium"][0].condition == "missing"
