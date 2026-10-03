"""Document kinds from each fictional lifecycle file's own heading (D-138)."""

import pytest

from asap_extractor.extract import suggest_kind

BANNER = "ASAP lifecycle QA | Fictional data | No real insurance or financial effect\nPage 1\nSIMULATED TEST FIXTURE - NOT ISSUED BY ANY INSURER OR AUTHORITY\n"


@pytest.mark.parametrize(
    ("heading", "kind"),
    [
        ("UX TEST - APA existing motor policy schedule\nRenewal context for the fictional five-vehicle fleet; policy expires 30 November 2026.", "policy_schedule"),
        ("UX TEST - APA Insurance commercial motor quotation\nSimulated quotation for comparison only; prepared 1 October 2026.", "quote_slip"),
        ("UX TEST - client quotation choice record\nA fictional decision-evidence fixture for testing placement preparation.", "correspondence"),
        ("UX TEST - CIC placement confirmation\nFictional insurer confirmation fixture, simulated issue date 1 December 2026.", "certificate"),
        ("UX TEST - CIC motor policy schedule version 1\nFictional policy schedule for lifecycle and field extraction testing.", "policy_schedule"),
        ("UX TEST - vehicle registration record (logbook fixture)\nFictional registration evidence supplied for a test-only TOR request.", None),
        ("UX TEST - CIC TOR endorsement and schedule version 2\nFictional confirmation fixture for adding KDN 482Q to the policy.", "endorsement"),
        ("UX TEST - police abstract / claim incident record\nFictional claim evidence fixture; not a police-issued document.", "claim_form"),
        ("UX TEST - CIC premium invoice\nFictional invoice for testing financial record handling; no payment is requested.", "invoice"),
        ("UX TEST - premium receipt evidence\nFictional partial receipt for reconciliation testing; no funds moved.", "receipt"),
        ("UX TEST - CIC renewal terms 2027-2028\nFictional renewal terms for the next policy-year workflow.", "quote_slip"),
    ],
)
def test_each_lifecycle_file_is_suggested_its_own_kind(heading: str, kind: str | None) -> None:
    assert suggest_kind(BANNER + heading + "\nField\nTest value") == kind
