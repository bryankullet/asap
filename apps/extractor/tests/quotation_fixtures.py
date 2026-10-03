"""The three fictional UX TEST quotations from the hosted acceptance test (D-136), rebuilt from the
text ASAP stored for them, in three layouts:

- ``table``: the hosted layout — a two-column "Field | Test value" table, labels bold, values
  wrapping inside their cell;
- ``stacked``: each label on its own line, its value on the next;
- ``block``: several labelled terms run together in one paragraph ("Excess: … Geographical limit:
  … Key exclusions: …").

Every page carries the fixture's own warning: simulated, no real insurance or financial effect.
"""
from __future__ import annotations

import pymupdf

QUOTES = {
    "APA": {
        "insurer": "APA Insurance (simulated)", "ref": "APA-Q-UXTEST-261001", "premium": "KES 5,180,000",
        "excess": "5% of loss, minimum KES 50,000 per vehicle",
        "territory": "Geographical limit: Kenya and Uganda; other territories by written agreement.",
        "exclusions": "Wear and tear; mechanical or electrical breakdown; use outside declared commercial carriage; driver without valid licence.",
    },
    "CIC": {
        "insurer": "CIC Insurance (simulated)", "ref": "CIC-Q-UXTEST-261002", "premium": "KES 4,850,000",
        "excess": "2.5% of loss, minimum KES 35,000 per vehicle",
        "territory": "Geographical limit: Kenya; Uganda by prior written agreement.",
        "exclusions": "Goods carried for reward outside declared business; loss of use; consequential loss; unauthorized driver.",
    },
    "Jubilee": {
        "insurer": "Jubilee Insurance (simulated)", "ref": "JUB-Q-UXTEST-261003", "premium": "KES 5,420,000",
        "excess": "2% of loss, minimum KES 25,000 per vehicle",
        "territory": "Geographical limit: Kenya, Uganda and Tanzania subject to trip declaration.",
        "exclusions": "Wear and tear; mechanical breakdown; hire or reward unless specifically endorsed; unauthorized driver.",
    },
}
OUTSTANDING = "Requires final vehicle values, current claims declaration, and confirmation of named drivers."
STATUS = "Indicative terms only - not accepted, bound, or issued. No cover is in force."
VALIDITY = "30 days from simulated issue date"
RESTRICTION = ("Use restriction: This fictional fixture is for isolated software testing only. It does not evidence a real policy, "
               "insurer offer, client instruction, claim, invoice, payment, receipt, or cover. Do not send it to any insurer, client, bank, or public authority.")


def rows(q: dict[str, str]) -> list[tuple[str, str]]:
    return [
        ("Client", "UX TEST Karibu Logistics Ltd"),
        ("Insurer", q["insurer"]),
        ("Quote reference", q["ref"]),
        ("Cover", "Commercial motor - comprehensive, five vehicles"),
        ("Proposed period", "1 December 2026 to 30 November 2027"),
        ("Total sum insured", "KES 39,200,000"),
        ("Annual total premium", q["premium"]),
        ("Quote validity", VALIDITY),
        ("Excess", q["excess"]),
        ("Geographical scope", q["territory"]),
        ("Key exclusions", q["exclusions"]),
        ("Outstanding information", OUTSTANDING),
        ("Status", STATUS),
    ]


def _header(page: pymupdf.Page, name: str, insurer: str) -> float:
    y = 50.0
    for text, size in [
        ("ASAP lifecycle QA | Fictional data | No real insurance or financial effect", 8),
        ("SIMULATED TEST FIXTURE - NOT ISSUED BY ANY INSURER OR AUTHORITY", 9),
        (f"UX TEST - {insurer.split(' (')[0]} commercial motor quotation", 13),
        ("Simulated quotation for comparison only; prepared 1 October 2026.", 9),
    ]:
        page.insert_text((50, y), text, fontsize=size, fontname="helv")
        y += size + 9
    return y + 6


def build(name: str, layout: str) -> bytes:
    q = QUOTES[name]
    doc = pymupdf.open()
    page = doc.new_page(width=595.28, height=841.89)
    y = _header(page, name, q["insurer"])
    if layout == "table":
        # The hosted layout: an HTML-style table, bold labels, values wrapping in their own cell.
        html = "<table style='border-collapse:collapse;font-family:sans-serif;font-size:9px'>"
        html += "<tr><th style='text-align:left;width:150px;padding:3px'>Field</th><th style='text-align:left;padding:3px'>Test value</th></tr>"
        for label, value in rows(q):
            html += f"<tr><td style='vertical-align:top;padding:3px'><b>{label}</b></td><td style='vertical-align:top;padding:3px'>{value}</td></tr>"
        html += "</table>"
        page.insert_htmlbox(pymupdf.Rect(50, y, 545, y + 520), html)
        y += 530
    elif layout == "stacked":
        for label, value in rows(q):
            page.insert_text((50, y), label, fontsize=9, fontname="hebo")
            y += 12
            for chunk in _wrap(value, 95):
                page.insert_text((50, y), chunk, fontsize=9, fontname="helv")
                y += 12
            y += 4
    elif layout == "block":
        for label, value in rows(q)[:7]:
            page.insert_text((50, y), f"{label}: {value}", fontsize=9, fontname="helv")
            y += 13
        para = (f"Quote validity: {VALIDITY}. Excess: {q['excess']} {q['territory']} Key exclusions: {q['exclusions']} "
                f"Outstanding information: {OUTSTANDING} Status: {STATUS}")
        for chunk in _wrap(para, 100):
            page.insert_text((50, y), chunk, fontsize=9, fontname="helv")
            y += 12
    else:
        raise ValueError(layout)
    y = max(y + 20, 780)
    for chunk in _wrap(RESTRICTION, 110):
        page.insert_text((50, y), chunk, fontsize=7, fontname="helv")
        y += 9
    return doc.tobytes()


def _wrap(text: str, width: int) -> list[str]:
    out, line = [], ""
    for word in text.split():
        if len(line) + len(word) + 1 > width and line:
            out.append(line)
            line = word
        else:
            line = f"{line} {word}".strip()
    if line:
        out.append(line)
    return out
