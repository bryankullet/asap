import type { ComponentInstance, ExperienceComponentId, ExperienceProps } from "@asap/schema";
import type { ComponentType } from "react";
import { ApprovalReview, Confirmation } from "../components/deciding.js";
import { ChangeList, SourceList } from "../components/evidence.js";
import { Comparison, FilterBar, RecordDetail, RecordTable } from "../components/exploring.js";
import { Consequences, Milestones, NextSteps, Obligations, Timeline } from "../components/progress.js";
import { Answer, Clarification, ContextSummary, RecordChoice } from "../components/understanding.js";
import { DocumentViewer, GovernedAction, ProgressiveForm } from "../components/working.js";

/**
 * The React side of the component registry (D-172): exactly one view per registered component id.
 * The record is typed against EXPERIENCE_COMPONENTS, so adding a component to the contract without
 * a view — or a view without a contract — fails the build. Nothing outside this map can render.
 */
export const REGISTRY: { [C in ExperienceComponentId]: ComponentType<{ instance: ComponentInstance; props: ExperienceProps<C> }> } = {
  Clarification,
  RecordChoice,
  ContextSummary,
  Answer,
  FilterBar,
  RecordTable,
  RecordDetail,
  Comparison,
  ProgressiveForm,
  DocumentViewer,
  GovernedAction,
  ApprovalReview,
  Confirmation,
  Milestones,
  NextSteps,
  Obligations,
  Consequences,
  Timeline,
  SourceList,
  ChangeList,
};
