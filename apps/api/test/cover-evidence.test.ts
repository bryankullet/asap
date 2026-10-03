/**
 * What can prove cover (staging finding, D-135). The guarded check on UX TEST KDN 482Q rightly said
 * "Not on cover": no schedule, no insurer confirmation. A logbook uploaded for the vehicle, the
 * client's request or an email must never change that — only the insurer's own confirmation, its
 * issued policy, or a reviewed schedule or certificate applied to the period can.
 */
import { describe, expect, it } from "vitest";
import { documentProvesCover, evidenceVerifiesCover } from "../src/policy/space.js";

describe("evidence of cover", () => {
  it.each([
    "logbook",
    "proposal_form",
    "quotation",
    "claim_form",
    "police_abstract",
    "other",
    null,
    undefined,
  ])("a %s document is never proof of cover", (kind) =>
    expect(documentProvesCover(kind as string | null | undefined)).toBe(false),
  );
  it.each(["policy_schedule", "certificate"])(
    "an insurer's %s, reviewed and applied, can be",
    (kind) => expect(documentProvesCover(kind)).toBe(true),
  );
  it("a period with no evidence, or only an email or request, is not verified", () => {
    expect(evidenceVerifiesCover([])).toBe(false);
    expect(
      evidenceVerifiesCover([
        { kind: "email" },
        { kind: "client_request" },
        { kind: "issuance_application" },
      ]),
    ).toBe(false);
  });
  it("the insurer's confirmation verifies it", () => {
    expect(evidenceVerifiesCover([{ kind: "cover_confirmation" }])).toBe(true);
  });
});
