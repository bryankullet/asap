/**
 * Registers every workflow the engine carries (D-139). Imported once by the app; importing it twice
 * registers nothing twice.
 */
import { registerWorkflow } from "./registry.js";
import { detectRenewals, RENEWAL } from "./renewal.js";
import { QUOTATION, QUOTATION_EVENTS } from "./quotation.js";
import { ISSUANCE, ISSUANCE_EVENTS, PLACEMENT, PLACEMENT_EVENTS } from "./placement.js";
import { CLAIM, CLAIM_EVENTS } from "./claim.js";
import { ENDORSEMENT, ENDORSEMENT_EVENTS } from "./endorsement.js";

registerWorkflow({
  definition: RENEWAL,
  detect: async (db, logger, organizationId, now) =>
    detectRenewals(db, logger, organizationId, now),
});

registerWorkflow({ definition: QUOTATION, on: QUOTATION_EVENTS });
registerWorkflow({ definition: PLACEMENT, on: PLACEMENT_EVENTS });
registerWorkflow({ definition: ISSUANCE, on: ISSUANCE_EVENTS });
registerWorkflow({ definition: CLAIM, on: CLAIM_EVENTS });
registerWorkflow({ definition: ENDORSEMENT, on: ENDORSEMENT_EVENTS });

export {
  advanceAnyRun,
  liveRunsOn,
  registerWorkflow,
  routeEventToWorkflows,
  registeredWorkflows,
  sweepWorkflows,
  withoutWorkflow,
  workflowNamed,
} from "./registry.js";
