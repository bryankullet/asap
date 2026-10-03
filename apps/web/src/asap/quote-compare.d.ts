import type { QuotationReadingResponse } from "@asap/schema";

export type CompareCell = { v: string; flag: "ok" | "uncertain" | "missing" };
export type CompareEvidence = { insurer: string; label: string; value: string; documentId: string; fieldId: string | null; page: number | null; confirmed: boolean };
export type CompareRisk = { insurer: string; text: string; documentId: string; page: number | null };
export type QuoteComparison = {
  cols: string[];
  rows: { label: string; cells: CompareCell[] }[];
  evidence: CompareEvidence[];
  risks: CompareRisk[];
  warnings: { insurer: string; text: string; documentId: string; page: number | null; confirmed: boolean }[];
  missingMaterial: { insurer: string; labels: string[] }[];
  unconfirmed: number;
  recommendation: null;
  whyNoRecommendation: string;
};
type Reading = Pick<QuotationReadingResponse, "fields" | "needsManualReview"> & {
  document: Pick<QuotationReadingResponse["document"], "id" | "filename" | "extractionState">;
  proposals: unknown[];
};
export const DIMENSIONS: { key: string; label: string; field?: string; term?: string[]; material?: boolean; notRead?: boolean }[];
export function compareQuotations(readings: Reading[], fieldIdOf?: (documentId: string, fieldKey: string) => string | null, today?: number): QuoteComparison;
