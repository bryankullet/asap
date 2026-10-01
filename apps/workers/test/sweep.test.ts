import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import { sweepOnce } from "../src/workflows/sweep.js";

const logger = pino({ level: "silent" });

describe("the workflow sweep tick", () => {
  it("reports what the API started and advanced", async () => {
    expect(await sweepOnce(async () => ({ started: 2, advanced: 3 }), logger)).toEqual({ started: 2, advanced: 3 });
  });
  it("never throws: a failed sweep is logged and the next tick tries again", async () => {
    const error = vi.spyOn(logger, "error");
    expect(await sweepOnce(async () => { throw new Error("the API answered 503"); }, logger)).toBeNull();
    expect(error).toHaveBeenCalled();
  });
});
