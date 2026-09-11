/**
 * Reading a brokerage's spreadsheet.
 *
 * Pure: text in, rows out. No database, no clock, no network — so every shape a real export takes
 * can be tested exhaustively and cheaply, which matters because this is the one place a
 * brokerage's whole book passes through.
 *
 * Written rather than taken from a library for one reason: the failure mode here is not "throws an
 * error", it is "reads the wrong value silently". A quoted comma that becomes a column break moves
 * every figure on the line one place to the left, and nothing downstream can tell. So the parser
 * is small enough to read in full and is tested against what exports actually contain.
 */

/** A line of the file, by header. Order is preserved; a blank line is not a row. */
export type RawRow = { lineNumber: number; cells: Record<string, string> };

export type ParsedCsv = {
  headers: string[];
  rows: RawRow[];
  /** Lines that could not be read as rows, and why, in words. Never silently dropped. */
  problems: { lineNumber: number; problem: string }[];
};

/**
 * Split one line into fields, honouring RFC 4180 quoting.
 *
 * The cases that matter, all tested: a comma inside quotes ("Nairobi, Kenya"), a doubled quote
 * meaning one literal quote, and a quoted field containing a newline — which is why the file
 * cannot simply be split on "\n" first.
 */
function splitFields(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      out.push(field);
      field = "";
    } else field += c;
  }
  out.push(field);
  return out;
}

/**
 * Split the file into logical lines, keeping a quoted newline inside its field.
 *
 * Each logical line carries the physical line number it started on, so a problem can be found in
 * the person's own copy of the file rather than in our idea of it.
 */
function logicalLines(text: string): { lineNumber: number; text: string }[] {
  const out: { lineNumber: number; text: string }[] = [];
  let current = "";
  let quoted = false;
  let startedAt = 1;
  let physical = 1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '"') {
      quoted = !quoted;
      current += c;
      continue;
    }
    if (c === "\r") continue; // a file written on Windows is the same file
    if (c === "\n" && !quoted) {
      out.push({ lineNumber: startedAt, text: current });
      current = "";
      physical++;
      startedAt = physical;
      continue;
    }
    if (c === "\n") physical++;
    current += c;
  }
  if (current.trim() !== "") out.push({ lineNumber: startedAt, text: current });
  return out;
}

/** Header text, reduced to what two spellings of the same thing have in common. */
export function normaliseHeader(header: string): string {
  return header
    .toLowerCase()
    .replace(/[\s_\-./]+/g, " ")
    .replace(/[^a-z0-9 %]/g, "")
    .trim();
}

export function parseCsv(text: string, rowLimit: number): ParsedCsv {
  // A byte-order mark is invisible in a spreadsheet and would otherwise become part of the first
  // header, so the first column would map to nothing for reasons nobody could see.
  const lines = logicalLines(text.replace(/^\uFEFF/, ""));
  const problems: { lineNumber: number; problem: string }[] = [];
  if (lines.length === 0) return { headers: [], rows: [], problems };

  const headers = splitFields(lines[0]!.text).map((h) => h.trim());
  const rows: RawRow[] = [];

  for (const line of lines.slice(1)) {
    if (line.text.trim() === "") continue; // a blank line between sections is not a row
    if (rows.length >= rowLimit) {
      problems.push({
        lineNumber: line.lineNumber,
        problem: `This file has more than ${rowLimit} rows. Nothing from this line on was read.`,
      });
      break;
    }
    const fields = splitFields(line.text);
    /*
     * More fields than headers almost always means a lost quote, and reading the line anyway would
     * put the wrong value in every later column. Refused by name rather than truncated, because
     * truncating is the silent version of the same mistake.
     */
    if (fields.length > headers.length) {
      problems.push({
        lineNumber: line.lineNumber,
        problem: `This line has ${fields.length} values but the file has ${headers.length} columns. It may contain an unquoted comma.`,
      });
      continue;
    }
    const cells: Record<string, string> = {};
    headers.forEach((h, i) => {
      cells[h] = (fields[i] ?? "").trim();
    });
    rows.push({ lineNumber: line.lineNumber, cells });
  }

  return { headers, rows, problems };
}
