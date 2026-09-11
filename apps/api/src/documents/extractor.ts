import { z } from "zod";

/**
 * The extraction service interface.
 *
 * **Documents are never sent to a third party for indexing or storage** (§45 rule 2). This talks
 * to our own Python service at `EXTRACTOR_URL`, authenticated with a shared secret, and there is
 * deliberately no adapter shape here that would let another implementation be a hosted vendor:
 * the interface takes bytes and returns text with positions, which is what our own service does.
 *
 * What comes back is *proposed*, always. Pages and their text are facts about the file; fields are
 * a reading of it, and a person accepts or corrects each one before anything treats it as known
 * (§45 rule 8).
 */

export const extractedPageSchema = z.object({
  pageNumber: z.number().int().min(1),
  text: z.string(),
  width: z.number().positive(),
  height: z.number().positive(),
});

export const extractedFieldSchema = z.object({
  fieldKey: z.string().min(1),
  value: z.string().nullable(),
  page: z.number().int().min(1).nullable(),
  region: z
    .object({ x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive() })
    .nullable(),
  /**
   * How sure the extractor is, as one of the six evidence conditions — not a percentage. A number
   * invites a threshold nobody agreed; a condition says what a person should do about it (D-060).
   */
  condition: z.enum(["known", "inferred", "conflicting", "missing", "stale", "waiting"]),
});

export const extractionResultSchema = z.object({
  pages: z.array(extractedPageSchema),
  fields: z.array(extractedFieldSchema),
});
export type ExtractionResult = z.infer<typeof extractionResultSchema>;

export type Extractor = {
  /** Reads one document. Throws `ExtractorUnavailable` rather than returning an empty result. */
  extract(input: { bytes: Uint8Array<ArrayBuffer>; mimeType: string; filename: string }): Promise<ExtractionResult>;
};

export class ExtractorUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtractorUnavailable";
  }
}

export function httpExtractor(config: { url: string; secret: string; timeoutMs: number }): Extractor {
  return {
    async extract(input) {
      const form = new FormData();
      form.append("file", new Blob([input.bytes], { type: input.mimeType }), input.filename);

      let res: Response;
      try {
        res = await fetch(new URL("/extract", config.url), {
          method: "POST",
          // A shared secret, not a user's token: the extractor serves the platform, not a session.
          headers: { "x-asap-extractor-secret": config.secret },
          body: form,
          signal: AbortSignal.timeout(config.timeoutMs),
        });
      } catch (err) {
        throw new ExtractorUnavailable(err instanceof Error ? err.message : "extractor unreachable");
      }
      if (!res.ok) {
        // The body is never logged or echoed: it can contain the document's own text.
        throw new ExtractorUnavailable(`extractor returned ${res.status}`);
      }
      const parsed = extractionResultSchema.safeParse(await res.json().catch(() => null));
      if (!parsed.success) throw new ExtractorUnavailable("extractor returned an unusable result");
      return parsed.data;
    },
  };
}

/** A deterministic extractor for tests and for a deployment with no extractor configured. */
export function scriptedExtractor(result: ExtractionResult): Extractor {
  return { extract: async () => result };
}
