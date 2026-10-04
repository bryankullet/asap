"""The fictional invoice and receipt read as what they are (D-138): their references, dates, amounts
and balance — not twelve policy fields."""

from asap_extractor.extract import read_document
from quotation_fixtures import build_money


def _read(kind: str):
    r = read_document(build_money(kind), kind + ".pdf", "application/pdf")
    return r, {f.field_key: f.value for f in r.fields}


def test_the_invoice() -> None:
    r, f = _read("invoice")
    assert r.suggested_kind == "invoice"
    assert f["invoice_reference"] == "CIC-INV-UXTEST-20261201"
    assert f["issue_date"] == "2026-12-01"
    assert f["due_date"] == "2026-12-15"
    assert f["premium"] == "KES 4,850,000"
    assert f["amount_received"] == "KES 0 as at invoice issue"
    assert f["balance_due"] == "KES 4,850,000"
    assert f["policy_number"] == "UX TEST CIC-MTR-2026-00318"
    assert "period_start" not in f and "quote_valid_until" not in f


def test_the_receipt() -> None:
    r, f = _read("receipt")
    assert r.suggested_kind == "receipt"
    assert f["receipt_reference"] == "UXTEST-RECEIPT-20261215-001"
    assert f["payment_date"] == "2026-12-15"
    assert f["amount_received"] == "KES 4,000,000"
    assert f["invoice_total"] == "KES 4,850,000"
    assert f["balance_due"] == "KES 850,000"
    assert f["payer"] == "UX TEST Karibu Logistics Ltd"
