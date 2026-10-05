/**
 * Registers every workflow the engine carries (D-139). Imported once by the app; importing it twice
 * registers nothing twice.
 */
import { registerWorkflow } from "./registry.js";
import { detectRenewals, RENEWAL } from "./renewal.js";
import { QUOTATION, QUOTATION_EVENTS } from "./quotation.js";

registerWorkflow({
  definition: RENEWAL,
  detect: async (db, logger, organizationId, now) =>
    detectRenewals(db, logger, organizationId, now),
});

registerWorkflow({ definition: QUOTATION, on: QUOTATION_EVENTS });

export {
  advanceAnyRun,
  liveRunsOn,
  registerWorkflow,
  routeEventToWorkflows,
  registeredWorkflows,
  sweepWorkflows,
  workflowNamed,
} from "./registry.js";
