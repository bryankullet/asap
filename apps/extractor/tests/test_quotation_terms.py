"""Regressions for term splitting (D-136), built on the layout of the three fictional quotations.

Each quotation is drawn three ways — the real two-column table, label-above-value, and a combined
paragraph — and every term must come back on its own, holding exactly its own words.
"""

import pymupdf
import pytest

from asap_extractor.extract import read_document
from quotation_fixtures import OUTSTANDING, QUOTES, build


def _terms(pdf: bytes) -> dict[str, str]:
    result = read_document(pdf, "quotation.pdf", "application/pdf")
    by_label: dict[str, str] = {}
    for t in result.terms:
        assert t.label not in by_label, f"{t.label} read twice"
        by_label[t.label] = t.value.replace("ﬁ", "fi")
    return by_label


def _flat(text: str) -> str:
    return " ".join(text.split())


@pytest.mark.parametrize("layout", ["table", "stacked", "block"])
@pytest.mark.parametrize("name", sorted(QUOTES))
def test_each_term_is_read_on_its_own(name: str, layout: str) -> None:
    q = QUOTES[name]
    terms = _terms(build(name, layout))
    assert _flat(terms["Excess"]) == _flat(q["excess"])
    assert _flat(terms["Geographic scope"]) == _flat(q["territory"].split(":", 1)[-1])
    assert _flat(terms["Key exclusions"]) == _flat(q["exclusions"])
    assert _flat(terms["Outstanding information"]) == _flat(OUTSTANDING)
    assert terms["Quote validity"].rstrip(".") == "30 days from simulated issue date"
    status = terms["Status"]
    assert "Indicative terms only" in status and "No cover is in force" in status
    # Nothing bleeds: no term carries another row's words.
    assert "Use restriction" not in status
    for label, value in terms.items():
        for other in ("Key exclusions", "Outstanding information", "Status", "Excess", "Geographical limit"):
            if other.lower() not in label.lower():
                assert other not in value, f"{label} carries {other}: {value}"


@pytest.mark.parametrize("layout", ["table", "stacked", "block"])
def test_the_fields_beside_the_terms_are_still_read(layout: str) -> None:
    result = read_document(build("CIC", layout), "quotation.pdf", "application/pdf")
    fields = {f.field_key: f.value for f in result.fields}
    assert fields["premium"] == "KES 4,850,000"
    assert fields["insurer_name"] == "CIC Insurance (simulated)"


def test_a_limit_is_kept_apart_from_a_geographical_limit() -> None:
    doc = pymupdf.open()
    page = doc.new_page()
    for i, line in enumerate([
        "Limit of indemnity: KES 10,000,000 any one occurrence",
        "Geographical limit: Kenya only",
        "Excess: KES 25,000 each claim",
    ]):
        page.insert_text((50, 80 + 30 * i), line, fontsize=10)
    terms = {t.label: (t.term_type, t.value) for t in read_document(doc.tobytes(), "q.pdf", "application/pdf").terms}
    assert terms["Limit of indemnity"] == ("limit", "KES 10,000,000 any one occurrence")
    assert terms["Geographic scope"] == ("other", "Kenya only")
    assert terms["Excess"] == ("excess", "KES 25,000 each claim")
