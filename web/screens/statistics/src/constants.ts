import type { StatisticsStrings } from "./types.js";

export const DEFAULT_STRINGS: StatisticsStrings = {
  locale: "en",
  tabLabel: "Report",
  windowLabel: "History window",
  export: "Export CSV",
  generationLabel: "Generation",
  consumptionLabel: "Consumption",
  capacityLabel: "Grid capacity",
  headroomLabel: "Headroom",
  sessionPeakLabel: "Session peak",
  generatorsOnlineLabel: "Generators online",
  windowIncompleteNotice: "Session shorter than requested history window",
  liveSource: "Live telemetry",
  derivedSource: "Derived calculation",
  fixtureSource: "Fixture data",
  reports: {
    energy: {
      label: "Energy",
      charts: ["Power — production and consumption"],
      meters: { battery: "Battery charge" },
      tables: [
        {
          title: "Generators by type",
          columns: [
            { label: "Generator", numeric: false },
            { label: "State", numeric: false },
            { label: "Output", numeric: true },
            { label: "Load", numeric: true },
          ],
        },
        {
          title: "Grid",
          columns: [
            { label: "Metric", numeric: false },
            { label: "Reading", numeric: true },
          ],
        },
        {
          title: "Fuel and batteries",
          columns: [
            { label: "Metric", numeric: false },
            { label: "Reading", numeric: true },
          ],
        },
      ],
    },
    resources: {
      label: "Resources",
      charts: ["Extraction", "Consumption", "Stock trend"],
      tables: [
        {
          title: "Balance",
          columns: [
            { label: "Resource", numeric: false },
            { label: "Production", numeric: true },
            { label: "Consumption", numeric: true },
            { label: "Balance", numeric: true },
          ],
        },
        {
          title: "Stocks",
          columns: [
            { label: "Resource", numeric: false },
            { label: "Stock", numeric: true },
          ],
        },
      ],
    },
  },
  window: (minutes: number) => `${minutes} min`,
  time: (seconds: number) => (seconds ? `${Math.round(seconds / 60)} min` : "Now"),
  sessionOnly: "Session data only — 24 h history arrives in v1.1",
  noValue: "No value",
  metrics: "Metrics",
  metricSearch: "Find a metric",
  noMatches: "No matching metrics",
  fuseOk: "Fuse OK",
  fuseTripped: "Fuse tripped",
  batteryBalanceNotice:
    "Time left is computed from the current balance, not predicted",
  inertNotice:
    "Inert mode — telemetry not available on client without authority",
  offlineTelemetryNotice: "Live telemetry from game mod (sidecar offline)",
  maxSeriesNotice: (evicted: string) =>
    `Max 4 series reached — evicted oldest: ${evicted}`,
  exportSuccess: "CSV export complete",
  exportEmpty: "No data available to export",
};

export const MAX_CHART_SERIES = 4;
