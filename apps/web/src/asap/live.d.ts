import type { MeResponse } from "@asap/schema";
export function loadLiveAdapters(options: { me: MeResponse; switchToDemo: () => void }): Promise<unknown>;
