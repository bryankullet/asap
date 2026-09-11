import { ImportColumn, suggestColumns, type AiProvider } from "@asap/schema";
import type { Logger } from "pino";

/**
 * Working out what a column means when its heading is one nobody anticipated.
 *
 * The synonym table covers the spellings real exports use. It cannot cover "Sum Ins.", "U/W",
 * "Cover From" or whatever the brokerage's previous system happened to print — and a brokerage
 * should not have to rename its columns to get its own book in.
 *
 * **The model maps headings. It never sees, chooses or produces a value.** It is given the column
 * names and nothing else, and what comes back is checked against the enum before it is used
 * (§45 rule 8: an AI-generated value is not authoritative until validated). A heading it gets
 * wrong is visible on the preview and correctable before anything is written, which is why this is
 * a safe place for a model and the values are not.
 *
 * When no model is configured this simply returns what the synonyms found. Ask says so elsewhere;
 * an import does not need to fail for want of a model.
 */
export async function mapColumnsIntelligently(
  headers: string[],
  provider: AiProvider | null,
  logger: Logger,
): Promise<Record<string, ImportColumn | null>> {
  const suggested = suggestColumns(headers);
  const unmapped = headers.filter((h) => suggested[h] == null && h.trim() !== "");
  if (unmapped.length === 0 || !provider) return suggested;

  const taken = new Set(Object.values(suggested).filter(Boolean) as ImportColumn[]);
  const available = ImportColumn.options.filter((m) => !taken.has(m));
  if (available.length === 0) return suggested;

  try {
    const reply = await provider.complete({
      system: [
        "You map the column headings of an insurance brokerage's spreadsheet onto a fixed list of meanings.",
        "You are given headings only. You never see the data in the columns and never produce a value.",
        "Reply with JSON only: an object whose keys are the headings you were given and whose values are one of the allowed meanings, or null when a heading does not mean any of them.",
        "Most headings mean nothing on the list. Answer null rather than forcing a match: a wrong mapping puts a value in the wrong field, which is worse than leaving a column out.",
        `The allowed meanings are: ${available.join(", ")}.`,
      ].join("\n"),
      messages: [{ role: "user", content: JSON.stringify({ headings: unmapped }) }],
      tools: [],
      responseSchema: {
        type: "object",
        properties: Object.fromEntries(
          unmapped.map((h) => [h, { type: ["string", "null"], enum: [...available, null] }]),
        ),
        additionalProperties: false,
      },
      maxOutputTokens: 600,
    });

    const parsed: unknown = JSON.parse(firstJsonObject(reply.text));
    if (!parsed || typeof parsed !== "object") return suggested;

    const out = { ...suggested };
    const claimed = new Set(taken);
    for (const [header, meaning] of Object.entries(parsed as Record<string, unknown>)) {
      // Only headings we asked about, only meanings on the list, and each meaning only once:
      // a model that mapped two columns to the same field would make the later one win silently.
      if (!unmapped.includes(header)) continue;
      const check = ImportColumn.safeParse(meaning);
      if (!check.success || claimed.has(check.data)) continue;
      claimed.add(check.data);
      out[header] = check.data;
    }
    return out;
  } catch (e) {
    // A model that is unreachable, slow or unhelpful must not stop a brokerage importing its book.
    // The synonyms already mapped what they could, and the person can correct the rest.
    logger.warn({ err: e }, "column mapping fell back to the synonym table");
    return suggested;
  }
}

/** The first JSON object in a reply, since a model may wrap one in prose or a code fence. */
function firstJsonObject(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start === -1 || end <= start ? "{}" : text.slice(start, end + 1);
}
