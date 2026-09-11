import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv.js";
import { interpretRow, suggestColumns, toDate, toRate } from "./rows.js";
import { IMPORT_ROW_LIMIT, type ImportColumn } from "../api/imports.js";

/**
 * The one place a brokerage's whole book passes through.
 *
 * The failure this file exists to prevent is not an exception — it is a value read wrongly and
 * recorded confidently. A quoted comma treated as a column break moves every figure on the line
 * one place left; a slash date read the other way round expires a policy in the wrong month.
 */

describe("reading the file", () => {
  it("keeps a comma that is inside quotes", () => {
    const { rows } = parseCsv('Client,Address\n"Acme Ltd","Nairobi, Kenya"\n', IMPORT_ROW_LIMIT);
    expect(rows[0]!.cells["Address"]).toBe("Nairobi, Kenya");
    expect(rows[0]!.cells["Client"]).toBe("Acme Ltd");
  });

  it("reads a doubled quote as one quote", () => {
    const { rows } = parseCsv('Client\n"The ""Old"" Mill Ltd"\n', IMPORT_ROW_LIMIT);
    expect(rows[0]!.cells["Client"]).toBe('The "Old" Mill Ltd');
  });

  it("keeps a newline that is inside a quoted field, and still counts lines from the file", () => {
    const { rows } = parseCsv('Client,Notes\n"Acme","line one\nline two"\nBeta,ok\n', IMPORT_ROW_LIMIT);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.cells["Notes"]).toBe("line one\nline two");
    // Beta begins on the file's fourth physical line, which is what a person would look for.
    expect(rows[1]!.lineNumber).toBe(4);
  });

  it("reads a file written on Windows the same way", () => {
    const { rows, headers } = parseCsv("Client,Premium\r\nAcme,100\r\n", IMPORT_ROW_LIMIT);
    expect(headers).toEqual(["Client", "Premium"]);
    expect(rows[0]!.cells["Premium"]).toBe("100");
  });

  it("strips a byte-order mark rather than making it part of the first header", () => {
    const { headers } = parseCsv("﻿Client,Premium\nAcme,100\n", IMPORT_ROW_LIMIT);
    expect(headers[0]).toBe("Client");
  });

  it("skips blank lines between sections without counting them as rows", () => {
    const { rows } = parseCsv("Client\nAcme\n\n\nBeta\n", IMPORT_ROW_LIMIT);
    expect(rows.map((r) => r.cells["Client"])).toEqual(["Acme", "Beta"]);
  });

  it("refuses a line with more values than columns instead of reading it shifted", () => {
    // The classic export defect: an unquoted comma in a company name.
    const { rows, problems } = parseCsv("Client,Premium\nAcme, Ltd,100\n", IMPORT_ROW_LIMIT);
    expect(rows).toHaveLength(0);
    expect(problems[0]!.problem).toMatch(/unquoted comma/);
    expect(problems[0]!.lineNumber).toBe(2);
  });

  it("fills short rows rather than rejecting them: a trailing empty column is normal", () => {
    const { rows } = parseCsv("Client,Premium,Notes\nAcme,100\n", IMPORT_ROW_LIMIT);
    expect(rows[0]!.cells["Notes"]).toBe("");
  });

  it("stops at the row limit and says where it stopped", () => {
    const body = Array.from({ length: 5 }, (_, i) => `Client ${i}`).join("\n");
    const { rows, problems } = parseCsv(`Client\n${body}\n`, 3);
    expect(rows).toHaveLength(3);
    expect(problems[0]!.problem).toMatch(/more than 3 rows/);
  });
});

describe("guessing what the columns mean", () => {
  it("recognises the spellings a real export uses", () => {
    const columns = suggestColumns(["Insured Name", "Policy No", "Underwriter", "Expiry Date"]);
    expect(columns["Insured Name"]).toBe("client_name");
    expect(columns["Policy No"]).toBe("policy_number");
    expect(columns["Underwriter"]).toBe("insurer_name");
    expect(columns["Expiry Date"]).toBe("period_end");
  });

  it("leaves a column it does not understand unmapped rather than attaching it to something", () => {
    const columns = suggestColumns(["Client", "Branch Code"]);
    expect(columns["Branch Code"]).toBeNull();
  });

  it("never maps two columns onto the same meaning", () => {
    const columns = suggestColumns(["Premium", "Gross Premium"]);
    const meanings = Object.values(columns).filter((m) => m === "premium_amount");
    expect(meanings).toHaveLength(1);
  });
});

describe("dates, where guessing would be worst", () => {
  it("reads ISO", () => {
    expect(toDate("2026-04-01").value).toBe("2026-04-01");
  });

  it("reads an unambiguous day-first date", () => {
    expect(toDate("25/12/2026").value).toBe("2026-12-25");
  });

  it("reads an unambiguous month-first date", () => {
    expect(toDate("12/25/2026").value).toBe("2026-12-25");
  });

  it("refuses an ambiguous one rather than picking a hemisphere", () => {
    // 03/04/2026 is April in Nairobi and March elsewhere. A policy that expires on the wrong one
    // of those is a repudiated claim, so this asks rather than resolves.
    const d = toDate("03/04/2026");
    expect(d.value).toBeNull();
    expect(d.problem).toMatch(/two different dates/);
  });

  it("says so when a cell is not a date at all", () => {
    expect(toDate("on renewal").problem).toMatch(/not recognised as a date/);
  });

  it("treats an empty cell as absent, not as a problem", () => {
    expect(toDate("")).toEqual({ value: null, problem: null });
  });
});

describe("commission, which must never be read as the wrong magnitude", () => {
  it("reads a percentage", () => {
    expect(toRate("12.5%")).toBe("0.1250");
  });

  it("reads a bare fraction", () => {
    expect(toRate("0.125")).toBe("0.1250");
  });

  it("reads a bare number over one as a percentage, which is what a broker means by 15", () => {
    expect(toRate("15")).toBe("0.1500");
  });

  it("refuses an amount that landed in the rate column", () => {
    expect(toRate("150,000")).toBeNull();
  });
});

const COLS: Record<string, ImportColumn | null> = {
  Client: "client_name",
  Contact: "contact_name",
  Email: "contact_email",
  Policy: "policy_number",
  Insurer: "insurer_name",
  Class: "class_of_business",
  Start: "period_start",
  Expiry: "period_end",
  Premium: "premium_amount",
  Commission: "commission_rate",
};

function row(cells: Record<string, string>, line = 2) {
  return { lineNumber: line, cells };
}

describe("what one line means", () => {
  it("reads a complete line", () => {
    const r = interpretRow(
      row({
        Client: "Tamarind Exporters Ltd",
        Contact: "Grace Otieno",
        Email: "grace@tamarind.example",
        Policy: "MAR-4471",
        Insurer: "Jubilee Allianz",
        Class: "Marine cargo",
        Start: "2026-01-01",
        Expiry: "2026-12-31",
        Premium: "KES 1,250,000.00",
        Commission: "12.5%",
      }),
      COLS,
      "gross",
    );
    expect(r.problem).toBeNull();
    expect(r.clientName).toBe("Tamarind Exporters Ltd");
    expect(r.clientKind).toBe("corporate");
    expect(r.premiumAmount).toBe("1250000.00");
    expect(r.commissionRate).toBe("0.1250");
    expect(r.periodEnd).toBe("2026-12-31");
  });

  it("has nothing to file a row under without a client name", () => {
    const r = interpretRow(row({ Client: "", Policy: "X" }), COLS, "gross");
    expect(r.problem).toMatch(/no client name/);
  });

  it("insists a file with premiums says what those premiums are", () => {
    const r = interpretRow(row({ Client: "Acme Ltd", Premium: "100000" }), COLS, null);
    expect(r.problem).toMatch(/gross or the total payable/);
  });

  it("refuses cover that ends before it starts", () => {
    const r = interpretRow(
      row({ Client: "Acme Ltd", Start: "2026-12-31", Expiry: "2026-01-01" }),
      COLS,
      "gross",
    );
    expect(r.problem).toMatch(/ends before it starts/);
  });

  it("refuses a policy with no usable period rather than recording half a record", () => {
    const r = interpretRow(row({ Client: "Acme Ltd", Policy: "POL-1" }), COLS, "gross");
    expect(r.problem).toMatch(/no usable cover period/);
  });

  it("keeps a valid address even when the rest of the line has a problem", () => {
    const r = interpretRow(
      row({ Client: "Acme Ltd", Email: "ops@acme.example", Start: "not a date" }),
      COLS,
      "gross",
    );
    expect(r.problem).toMatch(/not recognised as a date/);
    expect(r.contactEmail).toBe("ops@acme.example");
  });

  it("says nobody is reachable at something that is not an address", () => {
    const r = interpretRow(row({ Client: "Acme Ltd", Email: "n/a" }), COLS, "gross");
    expect(r.problem).toMatch(/not an email address/);
    expect(r.contactEmail).toBeNull();
  });

  it("takes a person for a person and a company for a company", () => {
    expect(interpretRow(row({ Client: "Jane Wanjiru" }), COLS, null).clientKind).toBe("individual");
    expect(interpretRow(row({ Client: "Mara Foods Limited" }), COLS, null).clientKind).toBe(
      "corporate",
    );
  });

  it("leaves a commission the file did not give as missing, never as computed", () => {
    const r = interpretRow(row({ Client: "Acme Ltd", Premium: "1000000" }), COLS, "gross");
    expect(r.commissionRate).toBeNull();
    expect(r.commissionAmount).toBeNull();
  });

  it("refuses an accounting negative rather than reading it as positive", () => {
    const r = interpretRow(row({ Client: "Acme Ltd", Premium: "(1,234.00)" }), COLS, "gross");
    expect(r.premiumAmount).toBeNull();
    expect(r.problem).toMatch(/not recognised as an amount/);
  });
});

describe("a commission column whose heading is not to be trusted", () => {
  /*
   * Found by running a real book through: a column called "Commission" maps to an amount, but
   * real exports put "12.5%" under that heading — and reading it as an amount records a rate of
   * twelve and a half shillings, silently.
   */
  const AMOUNT_COLS: Record<string, ImportColumn | null> = {
    Client: "client_name",
    Commission: "commission_amount",
  };

  it("reads a percentage under an amount heading as the rate it is", () => {
    const r = interpretRow(row({ Client: "Acme Ltd", Commission: "12.5%" }), AMOUNT_COLS, null);
    expect(r.commissionRate).toBe("0.1250");
    expect(r.commissionAmount).toBeNull();
  });

  it("still reads a real amount under that heading as an amount", () => {
    const r = interpretRow(row({ Client: "Acme Ltd", Commission: "150,000" }), AMOUNT_COLS, null);
    expect(r.commissionAmount).toBe("150000");
    expect(r.commissionRate).toBeNull();
  });
});
