"""The fictional existing policy schedule, read field by field (D-138).

"Insured vehicles" is a row about the vehicles, never the insured; the client, class, period and
currency the schedule states are read; a period written as one range gives both ends.
"""

import pytest

from asap_extractor.extract import read_document
from quotation_fixtures import build_schedule


@pytest.mark.parametrize("layout", ["table", "stacked"])
def test_the_schedule_reads_what_it_states(layout: str) -> None:
    result = read_document(build_schedule(layout), "01_UX_TEST_APA_Existing_Policy_Schedule.pdf", "application/pdf")
    fields = {f.field_key: f.value for f in result.fields if f.value}
    conflicting = {f.field_key for f in result.fields if f.condition == "conflicting"}
    assert fields["insured_name"] == "UX TEST Karibu Logistics Ltd"
    assert fields["policy_number"] == "UX TEST APA-MTR-2025-00931"
    assert fields["insurer_name"] == "APA Insurance (simulated)"
    assert fields["class_of_business"] == "Commercial motor - comprehensive"
    assert fields["period_start"] == "2025-12-01"
    assert fields["period_end"] == "2026-11-30"
    assert fields["sum_insured"] == "KES 39,200,000"
    assert fields["currency"] == "KES"
    assert "insured_name" not in conflicting
    assert all(f.value != "vehicles" for f in result.fields)
