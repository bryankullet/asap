import type { ExperienceIntent, LayoutNode, SubjectRef } from "@asap/schema";
import type { Composition } from "./build.js";

/** What a composer returns: the structure, its instances and actions, and what it concerns. */
export type Composed = {
  title: string;
  progress: ExperienceIntent["progress"];
  primary: SubjectRef | null;
  related?: SubjectRef[];
  layout: LayoutNode;
  composition: Composition;
  missing: string[];
  resolution?: ExperienceIntent["resolution"];
  understood?: string;
  notices?: { tone: "green" | "gold" | "red" | "grey"; text: string }[];
  unavailable?: string[];
  permissions?: Record<string, boolean>;
  /** Draft values the person's own words supplied (e.g. "Add Wanjiru Ltd as a client"). Never a record value. */
  prefill?: Record<string, Record<string, string>>;
};
