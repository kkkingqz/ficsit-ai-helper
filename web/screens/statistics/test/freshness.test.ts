import { describe, expect, it } from "vitest";
import { aggregateFreshness, evaluateFreshness } from "../src/freshness.js";

describe("Freshness Evaluation (D-1 §1.1 & §8.2)", () => {
  it("evaluates null or non-finite readings as empty", () => {
    expect(evaluateFreshness(null, 2000).kind).toBe("empty");
    expect(evaluateFreshness(undefined, 2000).kind).toBe("empty");
    expect(
      evaluateFreshness(
        { state: "notApplicable", value: null, unit: "megawatt" },
        2000
      ).kind
    ).toBe("empty");
  });

  it("evaluates readings within threshold as fresh", () => {
    // sampleInterval = 5s => threshold = max(15s, 10s) = 15s
    const reading = {
      value: 500,
      unit: "megawatt",
      sessionTimeSec: 2000,
      state: "value" as const,
    };

    // Age 2s
    const freshRes = evaluateFreshness(reading, 2002, 5);
    expect(freshRes.kind).toBe("fresh");
    expect(freshRes.label).toBe("Updated just now");

    // Age 12s (<= 15s threshold)
    const freshRes2 = evaluateFreshness(reading, 2012, 5);
    expect(freshRes2.kind).toBe("fresh");
    expect(freshRes2.label).toBe("Updated 12 s ago");
  });

  it("evaluates readings exceeding threshold as stale", () => {
    // sampleInterval = 5s => threshold = 15s. Age = 25s
    const reading = {
      value: 500,
      unit: "megawatt",
      sessionTimeSec: 2000,
      state: "value" as const,
    };

    const staleRes = evaluateFreshness(reading, 2025, 5);
    expect(staleRes.kind).toBe("stale");
    expect(staleRes.label).toBe("Updated 25 s ago");
    expect(staleRes.detail).toContain("exceeds 15 s threshold");
  });

  it("aggregates freshness by worst severity order: error > stale > loading > empty > fresh", () => {
    expect(
      aggregateFreshness([
        { kind: "fresh", label: "Updated just now" },
        { kind: "stale", label: "Updated 40s ago" },
      ]).kind
    ).toBe("stale");

    expect(
      aggregateFreshness([
        { kind: "fresh", label: "Updated just now" },
        { kind: "stale", label: "Updated 40s ago" },
        { kind: "error", label: "UNAVAILABLE" },
      ]).kind
    ).toBe("error");

    expect(
      aggregateFreshness([
        { kind: "fresh", label: "Updated just now" },
        { kind: "fresh", label: "Updated 2s ago" },
      ]).kind
    ).toBe("fresh");

    expect(
      aggregateFreshness([
        { kind: "empty", label: "NO DATA" },
        { kind: "empty", label: "NO DATA" },
      ]).kind
    ).toBe("empty");
  });
});
