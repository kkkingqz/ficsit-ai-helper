import { createPresenter } from "../components.js";

export const presenter = createPresenter("en", { megawatt: "MW" });
export const copy = {
  reference: "Telemetry reference",
  estimate: "Assistant estimate",
  fallbackTitle: "Card unavailable",
  incomplete: "Session history is shorter than this window",
  sources: {
    live: "Live", save: "Save", saveEstimated: "Save estimate",
    recorded: "Recording", fixture: "Fixture", planned: "Planned",
  },
  time: seconds => seconds ? `${Math.round(seconds / 60)} min` : "Now",
  axis: value => presenter.number(value, 0),
};

const states = {
  fresh: { kind: "fresh", label: "Updated 2 s ago" },
  stale: { kind: "stale", label: "Updated 2 min ago" },
  loading: { kind: "loading", label: "Loading telemetry" },
  empty: { kind: "empty", label: "No applicable data" },
  error: { kind: "error", label: "Telemetry unavailable", detail: "The last request failed" },
};

export function cardFixture(type = "metric", status = "fresh", source = "fixture") {
  const available = status === "fresh" || status === "stale";
  const metric = {
    kind: "value", metricId: "power.production", scopeId: "grid-1",
    state: status === "empty" ? "notApplicable" : "value",
    value: status === "empty" ? null : 576, unit: "megawatt",
    source, sessionTimeSec: 598, precisionDigits: 0,
  };
  const timestamps = available
    ? Array.from({ length: 121 }, (_, index) => index * 5).filter(time => time < 300 || time > 320)
    : [];
  const series = {
    kind: "series", metricId: "power.production", scopeId: "grid-1",
    window: "last15Min", unit: "megawatt", source, intervalSec: 5,
    timestamps,
    values: timestamps.map((time, index) => index === timestamps.length - 1
      ? 576 : 560 + Math.round(Math.sin(time / 90) * 22 + time / 50)),
    firstPointSessionTimeSec: 0, windowIncomplete: true,
  };
  return {
    resolved: {
      card: {
        schemaVersion: 1, type, title: "Grid generation",
        source: { kind: "metric", id: "power.production", scopeId: "grid-1" },
      },
      status, isReference: true,
      metric: status === "loading" || status === "error" ? undefined : metric,
      series: type === "timeseries" ? series : undefined,
      descriptor: { id: "power.production", displayName: "Generation", sampleIntervalSec: 5 },
      fallbackText: "Grid generation — telemetry unavailable",
    },
    state: { ...states[status] }, start: -300, end: 600,
  };
}

export function estimateFixture() {
  return {
    resolved: {
      card: { schemaVersion: 1, type: "text", title: "Expansion estimate", data: {
        text: "Adding two generators could provide 150 MW. This is an assistant estimate.",
      } },
      status: "fresh", isReference: false,
      fallbackText: "Adding two generators could provide 150 MW. This is an assistant estimate.",
    },
    state: { kind: "fresh", label: "Assistant-provided text" },
  };
}
