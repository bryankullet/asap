/**
 * UI Build Spec v1 Part 2.3 and 2.4: position is enforced by component. Each status component
 * throws in the wrong slot; TaskStatus cannot render with_party without party and since; and
 * FileStatus never appears inside a WorkCard.
 */
import { WITH_PARTY_ERROR } from "@asap/schema";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  ActivityPanelSlot,
  CardHeadline,
  CoverStatus,
  FileStatus,
  MoneyRow,
  MoneyStatus,
  PolicyPeriodLine,
  RunStatus,
  TaskStatus,
  WorkCardSlot,
} from "./slots.js";

describe("status components refuse the wrong slot", () => {
  it("TaskStatus renders in a card headline and throws outside one", () => {
    render(
      <CardHeadline>
        <TaskStatus status="needs_you" />
      </CardHeadline>,
    );
    expect(screen.getByText("Needs you")).toHaveAttribute("data-layer", "task");
    expect(() => render(<TaskStatus status="needs_you" />)).toThrow(
      /<TaskStatus> may only render inside/,
    );
    expect(() =>
      render(
        <MoneyRow>
          <TaskStatus status="done" />
        </MoneyRow>,
      ),
    ).toThrow(/<TaskStatus>/);
  });

  it("CoverStatus only in a policy period line, MoneyStatus only in a money row, RunStatus only in Activity or run detail", () => {
    render(
      <PolicyPeriodLine>
        <CoverStatus status="active" />
      </PolicyPeriodLine>,
    );
    expect(screen.getByText("Active cover")).toBeInTheDocument();
    expect(() => render(<CoverStatus status="active" />)).toThrow(/<CoverStatus>/);
    expect(() =>
      render(
        <CardHeadline>
          <MoneyStatus status="paid" />
        </CardHeadline>,
      ),
    ).toThrow(/<MoneyStatus>/);
    render(
      <ActivityPanelSlot>
        <RunStatus status="could_not_finish" />
      </ActivityPanelSlot>,
    );
    expect(screen.getByText("Couldn't finish")).toBeInTheDocument();
    expect(() =>
      render(
        <CardHeadline>
          <RunStatus status="working" />
        </CardHeadline>,
      ),
    ).toThrow(/<RunStatus>/);
  });

  it("TaskStatus refuses with_party without a party and a since date", () => {
    expect(() =>
      render(
        <CardHeadline>
          <TaskStatus status="with_party" />
        </CardHeadline>,
      ),
    ).toThrow(WITH_PARTY_ERROR);
    render(
      <CardHeadline>
        <TaskStatus status="with_party" party="Jubilee" since="2026-09-03T00:00:00Z" />
      </CardHeadline>,
    );
    expect(screen.getByText(/With Jubilee since/)).toBeInTheDocument();
  });

  it("FileStatus never appears inside a WorkCard (Part 2.4)", () => {
    expect(() =>
      render(
        <WorkCardSlot>
          <CardHeadline>
            <FileStatus status="incomplete" />
          </CardHeadline>
        </WorkCardSlot>,
      ),
    ).toThrow(/<FileStatus>/);
  });
});
