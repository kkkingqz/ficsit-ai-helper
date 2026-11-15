import type { FreshnessItem, FreshnessKind, ReadingValue } from "./types.js";
import type { MetricValue } from "@ficsitai/screens-api";

export function evaluateFreshness(
  reading: MetricValue | ReadingValue | null | undefined,
  currentSessionTime: number,
  sampleIntervalSec = 5
): FreshnessItem {
  if (!reading || reading.state === "notApplicable" || !Number.isFinite(reading.value)) {
    return {
      kind: "empty",
      label: "NO DATA",
    };
  }

  const readingTime = reading.sessionTimeSec ?? currentSessionTime;
  const age = Math.max(0, currentSessionTime - readingTime);
  const threshold = Math.max(3 * sampleIntervalSec, 10);

  if (age <= threshold) {
    const label = age < 5 ? "Updated just now" : `Updated ${Math.round(age)} s ago`;
    return {
      kind: "fresh",
      label,
    };
  }

  return {
    kind: "stale",
    label: `Updated ${Math.round(age)} s ago`,
    detail: `Telemetry age exceeds ${threshold} s threshold`,
  };
}

export function aggregateFreshness(items: FreshnessItem[]): FreshnessItem {
  if (!items.length) {
    return { kind: "empty", label: "NO DATA" };
  }

  if (items.some((i) => i.kind === "error")) {
    const err = items.find((i) => i.kind === "error")!;
    return {
      kind: "error",
      label: err.label || "UNAVAILABLE",
      ...(err.detail !== undefined ? { detail: err.detail } : {}),
    };
  }

  if (items.some((i) => i.kind === "stale")) {
    const stale = items.find((i) => i.kind === "stale")!;
    return {
      kind: "stale",
      label: stale.label,
      ...(stale.detail !== undefined ? { detail: stale.detail } : {}),
    };
  }

  if (items.some((i) => i.kind === "loading")) {
    return { kind: "loading", label: "LOADING" };
  }

  if (items.every((i) => i.kind === "empty")) {
    return { kind: "empty", label: "NO DATA" };
  }

  const fresh = items.find((i) => i.kind === "fresh");
  return fresh ?? { kind: "fresh", label: "Updated just now" };
}
