import { describe, expect, it } from "vitest";
import { incidentDateFrom } from "./drafts.js";

// Sent at 08:00 Nairobi on 5 October 2026.
const SENT = "2026-10-05T05:00:00.000Z";

describe("the incident date an email states (D-151)", () => {
  it("reads relative words against when the email was sent, in Nairobi", () => {
    expect(incidentDateFrom("Our truck overturned yesterday at Salgaa.", SENT)).toBe("2026-10-04");
    expect(incidentDateFrom("A van was hit last night.", SENT)).toBe("2026-10-04");
    expect(incidentDateFrom("The lorry caught fire this morning.", SENT)).toBe("2026-10-05");
    // 23:30 UTC on the 4th is already the 5th in Nairobi.
    expect(incidentDateFrom("It happened today.", "2026-10-04T23:30:00.000Z")).toBe("2026-10-05");
  });
  it("reads a stated date, day first, and never a date after the email", () => {
    expect(incidentDateFrom("The accident on 2nd October 2026 at Mlolongo.", SENT)).toBe("2026-10-02");
    expect(incidentDateFrom("Incident on 28 Sept.", SENT)).toBe("2026-09-28");
    expect(incidentDateFrom("Loss date 03/10/2026.", SENT)).toBe("2026-10-03");
    expect(incidentDateFrom("Loss date 30/12/2026.", SENT)).toBeNull();
  });
  it("says nothing when the email does not say when", () => {
    expect(incidentDateFrom("Our van was damaged; please advise.", SENT)).toBeNull();
  });
});
