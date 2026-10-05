/**
 * Registers every workflow the engine carries (D-139). Imported once by the app; importing it twice
 * registers nothing twice.
 */
import { registerWorkflow } from "./registry.js";
import { detectRenewals, RENEWAL } from "./renewal.js";

registerWorkflow({
  definition: RENEWAL,
  detect: async (db, logger, organizationId, now) =>
    detectRenewals(db, logger, organizationId, now),
});

export {
  advanceAnyRun,
  registerWorkflow,
  registeredWorkflows,
  sweepWorkflows,
  workflowNamed,
} from "./registry.js";
