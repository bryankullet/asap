import type { MeResponse } from "@asap/schema";
export function loadLiveAdapters(options: { me: MeResponse; switchToDemo: () => void }): Promise<unknown>;
export { draftProblems } from "@asap/schema";
export function withoutProhibitions(text: string): { text: string; prohibited: boolean };
