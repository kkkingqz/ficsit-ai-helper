import { createPresenter } from "../components.js";

const presenter = createPresenter("en", {
  megawatt: "MW", itemsPerMinute: "items/min", cubicMetersPerMinute: "m³/min",
  items: "", percent: "%", seconds: "s",
});
const read = (value, unit = "megawatt", precisionDigits = 0) =>
  ({ value, unit, precisionDigits, sessionTimeSec: 2098, state: "value" });
const fresh = { kind: "fresh", label: "Updated 2 s ago" };
const power = Object.fromEntries(Object.entries({
  generation: 576, consumption: 439, capacity: 720, headroom: 281, peak: 505,
}).map(([id, value]) => [id, read(value)]));
const table = (title, ...labels) => ({ title, columns: labels.map((label, index) => ({ label, numeric: index > 0 })) });
const groups = (id, rows) => [{ id, rows: rows.map(([id, ...cells]) => ({ id, cells })) }];
const panel = groups => ({ groups, state: fresh });
const tile = (id, label, reading) => ({ id, label, reading, state: fresh, source: "Live source" });
const series = (id, label, value, timestamps, amplitude) => ({
  id, label, current: value, timestamps, intervalSec: 5,
  values: timestamps.map(time => value.value + Math.round(Math.sin((time - 2100) / 78) * amplitude)),
});

export const statisticsOptions = {
  presenter,
  copy: {
    locale: "en", tabLabel: "Report", windowLabel: "History window", export: "Export CSV",
    reports: {
      energy: {
        label: "Energy",
        charts: ["Power — production and consumption"],
        meters: { battery: "Battery charge" },
        tables: [
          table("Generators by type", "Generator", "State", "Output", "Load"),
          table("Grid", "Metric", "Reading"),
          table("Fuel and batteries", "Metric", "Reading"),
        ],
      },
      resources: {
        label: "Resources",
        charts: ["Extraction", "Consumption", "Stock trend"],
        tables: [table("Balance", "Resource", "Production", "Consumption", "Balance"), table("Stocks", "Resource", "Stock")],
      },
    },
    window: minutes => `${minutes} min`,
    time: seconds => seconds ? `${Math.round(seconds / 60)} min` : "Now",
    axis: value => presenter.number(value, 0),
    sessionOnly: "Session data only — 24 h history arrives in v1.1",
    noValue: "No value",
    metrics: "Metrics",
    metricSearch: "Find a metric",
    noMatches: "No matching metrics",
  },
};

function generatorGroups(selected) {
  return ["Coal", "Fuel", "Geothermal"].map((label, index) => ({
    id: `type-${index}`, summary: [label, "3 / 4 running", read(192), "—"], selectable: true,
    selected: selected === `type-${index}`,
    rows: [64, 64, 64, 0].map((output, offset) => {
      const id = `GEN-${String(index * 4 + offset + 1).padStart(2, "0")}`;
      return {
        id, cells: [id, output ? "Running" : "Standby", read(output), read(output ? 100 : 0, "percent")],
        selectable: true, selected: selected === id,
      };
    }),
  }));
}

const catalog = {
  energy: [
    { id: "power.production", label: "Power production", unit: "megawatt", selected: true },
    { id: "power.consumption", label: "Power consumption", unit: "megawatt", selected: true },
  ],
  resources: [
    { id: "iron.production", label: "Iron ore production", unit: "itemsPerMinute", selected: true },
    { id: "copper.production", label: "Copper ore production", unit: "itemsPerMinute", selected: true },
    { id: "water.production", label: "Water production", unit: "cubicMetersPerMinute", selected: false },
  ],
};

export function statisticsFixture(tab, window, selected = "GEN-02", selectedMetrics) {
  const metrics = catalog[tab].map(metric => ({
    ...metric, hasSeries: true, selected: selectedMetrics?.includes(metric.id) ?? metric.selected,
  }));
  const active = id => metrics.some(metric => metric.id === id && metric.selected);
  const end = 2100;
  const start = end - window * 60;
  const samples = Array.from({ length: (end - Math.max(0, start)) / 5 + 1 }, (_, index) =>
    Math.max(0, start) + index * 5);
  const chart = series => ({
    start, end, series, state: start < 0 ? { ...fresh, detail: "35 min of session history available" } : fresh,
  });
  const base = {
    tab, window, canExport: true, freshness: [{ label: fresh.label, kind: fresh.kind }], metrics,
  };

  if (tab === "energy") {
    return {
      ...base,
      tiles: [
        ...[
          ["generation", "Generation"], ["consumption", "Consumption"], ["capacity", "Grid capacity"],
          ["headroom", "Headroom"], ["peak", "Session peak"],
        ].map(([id, label]) => tile(id, label, power[id])),
        tile("generators", "Generators online", read(9, "items"))],
      charts: [chart([
        active("power.production") && series("production", "Generation", power.generation, samples, 39),
        active("power.consumption") && series("consumption", "Consumption", power.consumption, samples, 22),
        series("capacity", "Capacity", power.capacity, samples, 0),
      ].filter(Boolean))],
      tables: [
        panel(generatorGroups(selected)),
        panel(groups("grid", [
          ["capacity", "Capacity", power.capacity], ["headroom", "Headroom", power.headroom],
          ["peak", "Session peak", power.peak], ["fuse", "Fuse", "Fuse OK"],
        ])),
        panel(groups("batteries", [
          ["charge-time", "Time until full", read(230, "seconds")],
          ["fuel", "Fuel stock", read(180, "items")],
        ])),
      ],
      meters: [{ id: "battery", value: 72, max: 100, reading: read(72, "percent") }],
      selection: { title: "Selected generator", fields: [{ label: "Generator", value: selected }] },
    };
  }

  const resources = [
    { id: "iron", name: "Iron ore", production: 420, consumption: 360, unit: "itemsPerMinute", stock: 2840 },
    { id: "copper", name: "Copper ore", production: 240, consumption: 250, unit: "itemsPerMinute", stock: 1400 },
    { id: "water", name: "Water", production: 180, consumption: 170, unit: "cubicMetersPerMinute", stock: 760 },
  ];
  const [iron] = resources;
  return {
    ...base,
    tiles: [
      tile("extraction", "Iron ore extraction", read(iron.production, iron.unit)),
      tile("consumption", "Iron ore consumption", read(iron.consumption, iron.unit)),
      tile("balance", "Iron ore balance", read(iron.production - iron.consumption, iron.unit)),
      tile("stock", "Iron ore stock", read(iron.stock, "items")),
    ],
    charts: [
      chart(resources.filter(item => active(`${item.id}.production`)).map(item =>
        series(item.id, item.name, read(item.production, item.unit), samples, 28))),
      chart(resources.slice(0, 2).map(item =>
        series(item.id, item.name, read(item.consumption, item.unit), samples, 18))),
    ],
    tables: [
      panel([{ id: "resources", rows: resources.map(item => {
        const balance = read(item.production - item.consumption, item.unit);
        return {
          id: item.id, selectable: true, selected: selected === item.id,
          cells: [item.name, read(item.production, item.unit), read(item.consumption, item.unit), {
            reading: balance, trend: series(item.id, item.name, balance, samples.slice(-20), 5),
            trendLabel: `${item.name} balance trend`,
          }],
        };
      }) }]),
      panel(groups("stocks", resources.map(item => [item.id, item.name, read(item.stock, "items")]))),
    ],
    selection: {
      title: "Selected resource",
      fields: [{ label: "Resource", value: resources.find(item => item.id === selected)?.name ?? iron.name }],
    },
  };
}

export const chatOptions = {
  presenter,
  copy: {
    history: "Conversation",
    historyStates: {
      loading: { label: "Loading history" },
      unavailable: { label: "History unavailable", detail: "Earlier messages could not be loaded." },
      empty: { label: "No messages yet", detail: "Ask about your factory. The assistant reads factory data and can prepare notes or screens." },
    },
    offlineTitle: "Assistant unavailable — the sidecar is not connected",
    offlineDetail: "Start the sidecar and reopen Chat. Connection retries automatically.",
    offlineScope: "Statistics, Notes, Screens and Lines keep working.",
    streaming: backKey => `Streaming… ${backKey} stops the answer`,
    sending: "Sending request…",
    stop: "Stop", retry: "Retry", draftLabel: "Message", send: "Send",
    sendHint: "Enter to send · Shift+Enter for a new line",
    prompts: [
      { label: "Find the bottleneck", text: "Which production stage is limiting throughput?" },
      { label: "Explain this metric", text: "Explain the selected metric in factory terms." },
      { label: "Power use this session", text: "Summarize power consumption during this session." },
      { label: "What changed in 15 min", text: "What changed during the last 15 minutes?" },
    ],
    promptHint: "Templates fill the field. Press Send to submit.",
    context: "Factory context", workOrders: "Related work orders", assistant: "Assistant",
  },
};

export function chatFixture(state) {
  const streaming = state === "streaming";
  const empty = state === "empty";
  const offline = state === "offline";
  return {
    connected: !offline, streaming, draft: "", backKey: "Esc",
    history: empty ? "empty" : offline ? "unavailable" : "ready",
    messages: empty ? [] : [
      { id: "operator-1", role: "operator", author: "Operator", time: "09:41",
        text: "How much power headroom do we have, and where is most of it used?" },
      { id: "assistant-1", role: "assistant", author: "FICSIT AI", time: "09:41",
        text: "There is 281 MW of headroom on this grid. Consumption is 439 MW against a capacity of 720 MW.",
        status: offline ? "Stopped" : "" },
    ],
    error: state === "error" ? { text: "The assistant did not respond.", canRetry: true } : null,
    context: [
      { label: "Generation", value: power.generation },
      { label: "Consumption", value: power.consumption },
      { label: "Active lines", value: "12 / 12" },
    ],
    assistant: [{ label: "Connection", value: offline ? "Offline" : "Linked" }],
  };
}
