/**
 * Reading whatever a brokerage actually has (D-071).
 *
 * The rule under test is the same one the CSV parser was written for: **the failure here is not an
 * exception, it is a value read wrongly and recorded confidently.** A spreadsheet date read as a
 * number, a PDF line split in the wrong place, a scan imported as an empty book — each would be
 * silent, and each is refused or handled explicitly below.
 */
import { describe, expect, it } from "vitest";
import { classify, pdfItemsToRows, readImport, type PositionedText } from "../src/imports/read.js";

const b = (s: string) => Buffer.from(s, "utf8");

describe("working out what a file is", () => {
  it("trusts the extension first", () => {
    // A browser's idea of a CSV's media type varies by operating system and by whichever
    // spreadsheet program last owned the file, so the name is the better signal.
    expect(classify("book.csv", "application/vnd.ms-excel")).toBe("csv");
    expect(classify("book.xlsx", "application/octet-stream")).toBe("spreadsheet");
    expect(classify("schedule.pdf", "")).toBe("pdf");
  });

  it("falls back to the declared type when the name says nothing", () => {
    expect(classify("export", "text/csv")).toBe("csv");
    expect(classify("export", "application/pdf")).toBe("pdf");
    expect(classify("export", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toBe(
      "spreadsheet",
    );
  });

  it("knows what it does not read", () => {
    expect(classify("scan.jpg", "image/jpeg")).toBe("other");
    expect(classify("letter.docx", "application/msword")).toBe("other");
  });
});

describe("a CSV", () => {
  it("still reads as it always did", async () => {
    const out = await readImport(b("Client,Premium\nAcme Ltd,100\n"), "book.csv", "text/csv");
    expect(out.kind).toBe("rows");
    if (out.kind !== "rows") return;
    expect(out.source).toBe("csv");
    expect(out.parsed.rows[0]!.cells["Client"]).toBe("Acme Ltd");
  });
});

describe("a file ASAP does not read as a book", () => {
  it("says so, and says where it should go instead", async () => {
    const out = await readImport(b("whatever"), "photo.jpg", "image/jpeg");
    expect(out.kind).toBe("not_a_book");
    if (out.kind !== "not_a_book") return;
    expect(out.reason).toMatch(/does not read that kind of file/i);
    // Never a dead end: a schedule or a letter belongs in Documents, and the message says so.
    expect(out.suggestion).toMatch(/filed as a document/i);
  });

  it("refuses a spreadsheet it cannot open rather than importing nothing", async () => {
    const out = await readImport(b("not really a spreadsheet"), "book.xlsx", "");
    expect(out.kind).toBe("not_a_book");
    if (out.kind !== "not_a_book") return;
    expect(out.reason).toMatch(/could not be opened/i);
  });

  it("refuses a PDF it cannot read", async () => {
    const out = await readImport(b("%PDF-1.4 broken"), "book.pdf", "application/pdf");
    expect(out.kind).toBe("not_a_book");
    if (out.kind !== "not_a_book") return;
    expect(out.reason).toMatch(/could not be read|no text in it/i);
  });
});

/**
 * A printed table, as the runs actually sit on the page.
 *
 * Built from coordinates rather than text, because that is what a PDF is. A reader's text layer
 * collapses the gaps between columns to single spaces, so "Malindi Salt Ltd  MAR-5511" arrives as
 * one run of words — and splitting *that* on whitespace puts every value one column left.
 */
function printedLine(y: number, cells: [number, string][]): PositionedText[] {
  return cells.map(([x, text]) => ({ page: 1, x, y, text }));
}

const PRINTED: PositionedText[] = [
  ...printedLine(760, [[40, "Client"], [172, "Policy No"], [256, "Insurer"], [340, "Expiry"]]),
  ...printedLine(746, [
    [40, "Malindi"],
    [76, "Salt Ltd"],
    [172, "MAR-5511"],
    [256, "Britam"],
    [340, "2027-06-30"],
  ]),
  ...printedLine(732, [
    [40, "Naro Moru Farms"],
    [172, "FIR-8820"],
    [256, "APA"],
    [340, "2027-09-15"],
  ]),
  ...printedLine(60, [[40, "Page 1 of 1"]]),
];

describe("a table printed into a PDF", () => {
  it("reads the columns from where the words sit, not from the spaces between them", () => {
    const parsed = pdfItemsToRows(PRINTED);
    expect(parsed.headers).toEqual(["Client", "Policy No", "Insurer", "Expiry"]);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]!.cells["Policy No"]).toBe("MAR-5511");
    expect(parsed.rows[1]!.cells["Expiry"]).toBe("2027-09-15");
  });

  it("keeps a value the renderer split across runs in one column", () => {
    // "Malindi" and "Salt Ltd" are two runs at two x positions inside the first column.
    const parsed = pdfItemsToRows(PRINTED);
    expect(parsed.rows[0]!.cells["Client"]).toBe("Malindi Salt Ltd");
  });

  it("skips a page footer rather than reading it as a client", () => {
    const parsed = pdfItemsToRows(PRINTED);
    expect(parsed.rows.map((r) => r.cells["Client"])).not.toContain("Page 1 of 1");
  });

  it("finds no table in prose, rather than inventing one", () => {
    const letter = [
      ...printedLine(700, [[40, "Dear Grace,"]]),
      ...printedLine(672, [[40, "Thank you for your instruction. We have placed the cover."]]),
      ...printedLine(644, [[40, "Yours sincerely,"]]),
    ];
    expect(pdfItemsToRows(letter).rows).toHaveLength(0);
  });

  it("reads nothing from a page with no text at all", () => {
    expect(pdfItemsToRows([]).rows).toHaveLength(0);
  });
});
