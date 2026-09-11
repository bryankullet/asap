import readXlsxFile from "read-excel-file/node";
import { getDocumentProxy } from "unpdf";
import { IMPORT_ROW_LIMIT, parseCsv, type ParsedCsv, type RawRow } from "@asap/schema";

/**
 * Reading whatever a brokerage actually has.
 *
 * A book arrives as a spreadsheet far more often than as a CSV, and sometimes as a PDF printed out
 * of whatever system it is leaving. This turns each of those into the same `RawRow[]` the importer
 * already understands, so the preview, the duplicate check and the commit are one path however the
 * file arrived.
 *
 * Where it refuses, it refuses in words and says what to do instead. A scan with no text layer is
 * not a book ASAP can read, and pretending otherwise would produce a confident empty import.
 */

/** What a file turned out to be, and what became of it. */
export type ReadOutcome =
  | { kind: "rows"; parsed: ParsedCsv; source: SourceKind; sheetName?: string }
  | { kind: "not_a_book"; reason: string; suggestion: string };

export type SourceKind = "csv" | "spreadsheet" | "pdf";

/**
 * Which reader a file needs.
 *
 * The extension decides, with the declared type as a fallback: a browser's idea of a CSV's media
 * type varies by operating system and by which spreadsheet program last owned the file, so the
 * name it was saved under is the more reliable signal of the two.
 */
export function classify(filename: string, mimeType: string): SourceKind | "other" {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (ext === "csv" || ext === "tsv" || ext === "txt") return "csv";
  if (ext === "xlsx" || ext === "xlsm" || ext === "xls") return "spreadsheet";
  if (ext === "pdf") return "pdf";
  if (mimeType.includes("csv") || mimeType.startsWith("text/")) return "csv";
  if (mimeType.includes("spreadsheet") || mimeType.includes("excel")) return "spreadsheet";
  if (mimeType === "application/pdf") return "pdf";
  return "other";
}

/** A cell as a spreadsheet stores it, in the text the rest of the importer reads. */
function cellToText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    // A spreadsheet date is a number until something decides what it means. ISO is the one
    // spelling `toDate` never has to guess at.
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return String(value).trim();
}

export async function readImport(
  bytes: Buffer,
  filename: string,
  mimeType: string,
): Promise<ReadOutcome> {
  const kind = classify(filename, mimeType);

  if (kind === "csv") {
    return {
      kind: "rows",
      parsed: parseCsv(bytes.toString("utf8"), IMPORT_ROW_LIMIT),
      source: "csv",
    };
  }

  if (kind === "spreadsheet") {
    let sheets: { sheet: string; data: unknown[][] }[];
    try {
      // Every sheet, so the one that was read can be named rather than assumed.
      sheets = (await readXlsxFile(bytes)) as unknown as { sheet: string; data: unknown[][] }[];
    } catch {
      return {
        kind: "not_a_book",
        reason: "That spreadsheet could not be opened.",
        suggestion: "Save it again as .xlsx, or export it as CSV, and try once more.",
      };
    }

    /*
     * The first sheet that has a table on it.
     *
     * A workbook routinely opens on a cover sheet, a summary or an empty tab, and reading that and
     * reporting "no columns" would be true of the sheet and false of the workbook. Guessing which
     * *of several* tables is the book would be the silent wrongness this file exists to avoid — so
     * it takes the first with a header and says which one that was.
     */
    const chosen = sheets.find((s) => sheetToRows(s.data).headers.length > 1) ?? sheets[0];
    if (!chosen) {
      return {
        kind: "not_a_book",
        reason: "That spreadsheet has no sheets in it.",
        suggestion: "Check the file opens in your spreadsheet program, then try again.",
      };
    }
    return { kind: "rows", parsed: sheetToRows(chosen.data), source: "spreadsheet", sheetName: chosen.sheet };
  }

  if (kind === "pdf") {
    let items: PositionedText[];
    let pages: number;
    try {
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      pages = pdf.numPages;
      items = await positionedText(pdf);
    } catch {
      return {
        kind: "not_a_book",
        reason: "That PDF could not be read.",
        suggestion: "File it as a document instead, and ASAP will read it there.",
      };
    }

    if (items.length === 0) {
      /*
       * A scan. There is no text layer to read, and lifting one off the page needs the extraction
       * service. Saying so beats importing nothing and calling it success.
       */
      return {
        kind: "not_a_book",
        reason: `That PDF has no text in it — ${pages === 1 ? "the page is" : "its pages are"} a scan or an image.`,
        suggestion:
          "File it as a document. Reading a scan and proposing its values for review is a different job from importing a book.",
      };
    }

    const parsed = pdfItemsToRows(items);
    if (parsed.rows.length === 0) {
      return {
        kind: "not_a_book",
        reason:
          "That PDF has text in it, but nothing that reads as a table of clients or policies.",
        suggestion:
          "If it is a schedule, a debit note or a letter rather than a book, file it as a document — ASAP reads those and proposes their values for a person to accept.",
      };
    }
    return { kind: "rows", parsed, source: "pdf" };
  }

  return {
    kind: "not_a_book",
    reason: "ASAP does not read that kind of file as a book.",
    suggestion:
      "A book comes in as a spreadsheet or a CSV. Anything else — a schedule, a debit note, a letter — is filed as a document instead.",
  };
}

/** A sheet's rows, as the CSV reader would have produced them. */
function sheetToRows(sheet: unknown[][]): ParsedCsv {
  const problems: { lineNumber: number; problem: string }[] = [];
  // The first row with more than one non-empty cell is the header: exports routinely carry a
  // title line or a blank line above it, and treating those as the header maps nothing.
  const headerIndex = sheet.findIndex((r) => r.filter((c) => cellToText(c) !== "").length > 1);
  if (headerIndex === -1) return { headers: [], rows: [], problems };

  const headers = (sheet[headerIndex] ?? []).map((c) => cellToText(c));
  const rows: RawRow[] = [];

  for (let i = headerIndex + 1; i < sheet.length; i++) {
    const line = sheet[i] ?? [];
    if (line.every((c) => cellToText(c) === "")) continue;
    if (rows.length >= IMPORT_ROW_LIMIT) {
      problems.push({
        lineNumber: i + 1,
        problem: `This file has more than ${IMPORT_ROW_LIMIT} rows. Nothing from this row on was read.`,
      });
      break;
    }
    const cells: Record<string, string> = {};
    headers.forEach((h, col) => {
      cells[h] = cellToText(line[col]);
    });
    // The spreadsheet's own row number, so a problem is found where the person is looking.
    rows.push({ lineNumber: i + 1, cells });
  }
  return { headers, rows, problems };
}

/** One run of text on a page, with where it sits. */
export type PositionedText = { page: number; x: number; y: number; text: string };

/** Every text run in the document, with its position. */
async function positionedText(pdf: {
  numPages: number;
  getPage: (n: number) => Promise<{
    getTextContent: () => Promise<{ items: unknown[] }>;
  }>;
}): Promise<PositionedText[]> {
  const out: PositionedText[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const content = await (await pdf.getPage(p)).getTextContent();
    for (const raw of content.items) {
      const item = raw as { str?: string; transform?: number[] };
      const text = (item.str ?? "").trim();
      if (text === "" || !item.transform) continue;
      out.push({ page: p, x: item.transform[4] ?? 0, y: item.transform[5] ?? 0, text });
    }
  }
  return out;
}

/**
 * A table printed into a PDF, back into rows — by where the words sit, not by the spaces between
 * them.
 *
 * This is the part that has to be done from geometry. A PDF has no columns: it has glyphs at
 * coordinates, and the text layer a reader produces collapses the gaps between them to single
 * spaces. Splitting that text on whitespace turns "Malindi Salt Ltd" into three columns and puts
 * every later value in the wrong field — silently, which is the failure mode this whole importer
 * is built to refuse.
 *
 * So: group the runs into lines by their y, take the first line with three or more runs as the
 * header, and let the header's x positions define the columns. Every later run joins the column
 * whose heading starts nearest to its left of it. A line that lands in fewer than half the columns
 * is a page footer or a running total, and is skipped — it was never a row.
 */
export function pdfItemsToRows(items: PositionedText[]): ParsedCsv {
  // Lines: same page, same y within a couple of points — printed rows are never exactly level.
  const lines = new Map<string, PositionedText[]>();
  for (const item of items) {
    const key = `${item.page}:${Math.round(item.y / 3)}`;
    const line = lines.get(key);
    if (line) line.push(item);
    else lines.set(key, [item]);
  }
  const ordered = [...lines.values()]
    .map((l) => l.sort((a, b) => a.x - b.x))
    .sort((a, b) => a[0]!.page - b[0]!.page || b[0]!.y - a[0]!.y);

  const headerIndex = ordered.findIndex((l) => l.length >= 3);
  if (headerIndex === -1) return { headers: [], rows: [], problems: [] };

  const headerLine = ordered[headerIndex]!;
  const headers = headerLine.map((h) => h.text);
  const columnX = headerLine.map((h) => h.x);

  /** Which column a run belongs to: the last heading that starts at or before it. */
  const columnFor = (x: number) => {
    let found = 0;
    for (let i = 0; i < columnX.length; i++) {
      // Half a character of tolerance, because a value is often set a shade left of its heading.
      if (x >= columnX[i]! - 4) found = i;
    }
    return found;
  };

  const rows: RawRow[] = [];
  for (let i = headerIndex + 1; i < ordered.length && rows.length < IMPORT_ROW_LIMIT; i++) {
    const line = ordered[i]!;
    const cells: Record<string, string> = {};
    for (const h of headers) cells[h] = "";
    let filled = 0;
    for (const run of line) {
      const key = headers[columnFor(run.x)]!;
      if (cells[key] === "") filled++;
      // Runs inside one column are the same value split by the renderer: "Malindi" and "Salt Ltd".
      cells[key] = cells[key] === "" ? run.text : `${cells[key]} ${run.text}`;
    }
    // A line that reaches fewer than half the columns is a footer, a total or prose.
    if (filled * 2 < headers.length) continue;
    rows.push({ lineNumber: rows.length + headerIndex + 2, cells });
  }
  return { headers, rows, problems: [] };
}
