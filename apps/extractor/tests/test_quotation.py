"""Reading a quotation.

A quotation is not a schedule. It states several excesses, several exclusions and a condition
that wraps over two lines, and the one dropped in flattening is the one that mattered. These
tests build real PDFs — by hand, sharing no code with the reader — in the layouts brokers
actually receive, and hold the reader to four things:

* every term the document states comes back, separately, with the page and rectangle it was read
  from, and that rectangle covers the words it claims to;
* a figure that cannot be compared is marked unclear rather than proposed as a value;
* the two defects a real run demonstrated stay fixed: a generic "limit" is not the sum insured,
  and "Policyholders compensation fund" is not the insured's name;
* and a document with no readable text says so, rather than reading as a document with nothing
  in it.
"""

from __future__ import annotations

from asap_extractor.extract import read_document
from test_extract import _pdf


def _terms(lines: list[str]):
    return read_document(_pdf(lines), "quotation.pdf", "application/pdf").terms


def _fields(lines: list[str]) -> dict[str, list]:
    out: dict[str, list] = {}
    for f in read_document(_pdf(lines), "quotation.pdf", "application/pdf").fields:
        out.setdefault(f.field_key, []).append(f)
    return out


def _of_type(terms, term_type: str):
    return [t for t in terms if t.term_type == term_type]


TWO_COLUMN = [
    "JUBILEE INSURANCE                      QUOTATION",
    "Insured:          Acme Logistics Ltd",
    "Insurer:          Jubilee Allianz",
    "Class of business: Commercial Motor",
    "Period from: 01/01/2027   Period to: 31/12/2027",
    "Currency:         KES",
    "Premium basis:    Rate of 4.5% on declared value",
    "Sum insured:      KES 42,000,000",
    "Premium:          KES 5,310,000.50",
    "Training levy:    KES 10,620",
    "Policyholders compensation fund: KES 13,275",
    "Own damage excess: 5% of claim, minimum KES 30,000",
    "Theft excess:     10% of claim",
    "Windscreen excess: KES 5,000",
    "Third party property damage limit: KES 20,000,000",
    "Passenger liability limit: KES 3,000,000 per person",
    "Exclusion: political violence and terrorism unless",
    "separately arranged with the underwriter",
    "Exclusion: wear and tear",
    "Condition: all vehicles to carry a tracking device",
    "within thirty days of inception",
    "Optional benefit: excess protector at KES 45,000",
    "Quotation valid until: 28/02/2027",
]

# The same quotation as a table: no colons, columns separated by space.
TABLE = [
    "MOTOR QUOTATION",
    "Own damage excess          5% of claim minimum KES 30,000",
    "Theft excess               10% of claim",
    "Third party liability limit  KES 20,000,000",
    "Training levy              KES 10,620",
]


def test_every_excess_is_its_own_term() -> None:
    excesses = _of_type(_terms(TWO_COLUMN), "excess")
    assert [e.label for e in excesses] == [
        "Own damage excess",
        "Theft excess",
        "Windscreen excess",
    ]


def test_every_exclusion_is_its_own_term() -> None:
    exclusions = _of_type(_terms(TWO_COLUMN), "exclusion")
    assert len(exclusions) == 2
    assert "wear and tear" in (exclusions[1].value or "")


def test_a_wrapped_condition_is_read_whole() -> None:
    (condition,) = _of_type(_terms(TWO_COLUMN), "condition")
    assert condition.value == "all vehicles to carry a tracking device within thirty days of inception"


def test_limits_are_limits_and_not_the_sum_insured() -> None:
    """The first demonstrated defect. A limit of liability is a term of cover; the sum insured is
    the value of the thing insured, and reading one as the other overstates the cover."""
    limits = _of_type(_terms(TWO_COLUMN), "limit")
    assert [limit.label for limit in limits] == [
        "Third party property damage limit",
        "Passenger liability limit",
    ]
    (sum_insured,) = _fields(TWO_COLUMN)["sum_insured"]
    assert sum_insured.value == "KES 42,000,000"


def test_a_statutory_charge_is_not_the_insured() -> None:
    """The second demonstrated defect. "Policyholders compensation fund" begins with the label
    "policyholder"; it is a charge, and it names nobody."""
    (insured,) = _fields(TWO_COLUMN)["insured_name"]
    assert insured.value == "Acme Logistics Ltd"
    assert insured.condition == "known"


def test_the_charges_come_back_as_levies() -> None:
    levies = _of_type(_terms(TWO_COLUMN), "levy")
    assert {levy.label for levy in levies} == {"Training levy", "Policyholders compensation fund"}
    assert {levy.amount for levy in levies} == {"10620", "13275"}


def test_a_premium_with_commas_and_decimals_is_read_whole() -> None:
    (premium,) = _fields(TWO_COLUMN)["premium"]
    assert premium.value == "KES 5,310,000.50"


def test_the_charges_do_not_become_the_premium() -> None:
    assert len(_fields(TWO_COLUMN)["premium"]) == 1


def test_currency_and_premium_basis_are_read() -> None:
    assert _fields(TWO_COLUMN)["currency"][0].value == "KES"
    assert _fields(TWO_COLUMN)["premium_basis"][0].value == "Rate of 4.5% on declared value"


def test_validity_written_as_a_date_is_read() -> None:
    assert _fields(TWO_COLUMN)["quote_valid_until"][0].value == "28/02/2027"


def test_both_dates_on_one_line_are_read_separately() -> None:
    fields = _fields(TWO_COLUMN)
    assert fields["period_start"][0].value == "01/01/2027"
    assert fields["period_end"][0].value == "31/12/2027"


def test_an_optional_benefit_is_a_benefit() -> None:
    (benefit,) = _of_type(_terms(TWO_COLUMN), "benefit")
    assert benefit.label == "Optional benefit"


def test_a_table_without_colons_is_read_by_its_columns() -> None:
    terms = _terms(TABLE)
    assert [(t.term_type, t.label) for t in terms] == [
        ("excess", "Own damage excess"),
        ("excess", "Theft excess"),
        ("limit", "Third party liability limit"),
        ("levy", "Training levy"),
    ]


def test_a_value_that_cannot_be_compared_says_so() -> None:
    (term,) = _terms(["Theft excess: as per policy wording"])
    assert term.condition == "unclear"
    assert term.amount is None


def test_an_amount_without_a_currency_is_not_an_amount() -> None:
    """A bare figure cannot be compared against another insurer's, and a percentage is not an
    amount at all. Both come back as words, which is what they are."""
    (percentage,) = _terms(["Own damage excess: 5% of claim"])
    assert percentage.amount is None
    (bare,) = _terms(["Own damage excess: 30,000"])
    assert bare.amount is None


def test_every_term_points_at_the_words_it_was_read_from() -> None:
    """A citation you cannot open at the right rectangle is not a citation. The rectangle must
    cover the value, not the label — a highlight over the label points at the question."""
    result = read_document(_pdf(TWO_COLUMN), "quotation.pdf", "application/pdf")
    page = result.pages[0]
    for term in result.terms:
        assert term.page == 1
        assert term.region is not None
        assert 0 <= term.region["x"] < page.width
        assert 0 <= term.region["y"] < page.height
        assert term.region["x"] + term.region["width"] <= page.width + 1
        assert term.region["width"] > 0 and term.region["height"] > 0

    # And the rectangle is to the right of the label it belongs to.
    (own_damage,) = [t for t in result.terms if t.label == "Own damage excess"]
    (levy,) = [t for t in result.terms if t.label == "Training levy"]
    assert own_damage.region["x"] > 50.0
    assert levy.region["x"] > 50.0


def test_ordinals_are_stable_and_distinct() -> None:
    terms = _terms(TWO_COLUMN)
    assert [t.ordinal for t in terms] == list(range(len(terms)))
    again = _terms(TWO_COLUMN)
    assert [(t.ordinal, t.label) for t in again] == [(t.ordinal, t.label) for t in terms]


def test_a_value_the_document_never_gave_is_missing_not_invented() -> None:
    fields = _fields(["Premium: KES 100,000.00"])
    assert fields["policy_number"][0].condition == "missing"
    assert fields["policy_number"][0].value is None


def test_a_document_with_no_readable_text_says_so() -> None:
    """There is no OCR in this deployment. An image-only quotation must be said to need a person,
    not read as a quotation that states nothing."""
    result = read_document(_pdf([]), "scan.pdf", "application/pdf")
    assert result.terms == []
    assert result.needs_manual_review is not None
    assert "scan" in result.needs_manual_review


def test_prose_is_not_mistaken_for_a_term() -> None:
    """The guard against replacing one false positive with another: ordinary sentences that
    happen to contain a label word state nothing."""
    terms = _terms([
        "We are pleased to offer the following terms for your consideration.",
        "Please confirm acceptance from the date of issue.",
    ])
    assert terms == []
