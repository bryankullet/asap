/** The incident in a claim request, apart from the directions about the work (claim-facts.js). */
export function incidentFacts(raw: string): { facts: string | null; directions: string[] };
