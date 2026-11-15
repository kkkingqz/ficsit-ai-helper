import {
  chatMessage, createPresenter, metricState, metricTable, metricTile, segmentedControl, statusStrip, timeChart,
} from "./components.js";

// Replace this catalog with strings from UE Localization when mounting an actual screen.
const english = {
  locale: "en",
  units: { megawatt: "MW", percent: "%", itemsPerMinute: "items/min" },
  brand: "FICSIT AI / D-2",
  title: "Component showcase",
  fixture: "FIXTURE",
  metricHeading: "Power telemetry",
  stateHeading: "Panel states",
  stateExample: "Same metric · 0 MW is a valid reading",
  powerChart: "Power history",
  zoom: "Interface scale",
  window: "History window",
  time: seconds => seconds === 0 ? "Now" : `${Math.round(seconds / 60)} min`,
  partial: minutes => `${minutes} min of session history available`,
  updated: age => `Updated ${age} s ago`,
  statuses: {
    loading: "Loading", empty: "No data", error: "Unavailable",
    loadingDetail: "Waiting for first sample", emptyDetail: "No telemetry received", errorDetail: "Telemetry connection failed",
    live: "LIVE", offline: "OFFLINE", stopped: "Stopped",
  },
  metrics: ["Generation", "Consumption", "Grid capacity", "Headroom"],
  generators: "Generators by type",
  columns: ["Generator", "State", "Output"],
  groups: ["Coal", "Fuel", "Geothermal"],
  running: "Running",
  standby: "Standby",
  groupStatus: (running, total) => `${running} / ${total} running`,
  chat: "Chat messages",
  operator: "Operator",
  assistant: "Foreman",
  messages: ["How much headroom is left on this grid?", "The grid has 281 MW of headroom at the current consumption."],
  strips: "Status and key hints",
  telemetry: "Telemetry",
  sidecar: "Sidecar",
  close: "Back",
  export: "Export CSV",
};

const root = document.querySelector("#showcase");
const presenter = createPresenter(english.locale, english.units);
const current = [576, 439, 720, 281];
const reading = (value, sessionTimeSec = 898, precisionDigits = 0) =>
  ({ value, sessionTimeSec, precisionDigits, unit: "megawatt", state: "value" });
const fresh = { kind: "fresh", label: english.updated(2) };
const stale = { kind: "stale", label: english.updated(48) };

function add(parent, tag, content, className) {
  const element = document.createElement(tag);
  if (content) element.textContent = content;
  if (className) element.className = className;
  parent.append(element);
  return element;
}

function addTile(parent, label, value, state) {
  const component = metricTile(presenter);
  parent.append(component.element);
  component.update({ label, reading: value, state });
}

const header = add(root, "header", null, "lab-head");
const title = add(header, "div");
add(title, "span", english.brand, "lab-brand");
add(title, "h1", english.title);
const headerControls = add(header, "div");
const fixture = statusStrip();
headerControls.append(fixture.element);
fixture.update([{ label: english.fixture, kind: "fresh" }]);
const scale = segmentedControl({
  label: english.zoom,
  options: [100, 150].map(value => ({ value, label: `${value}%` })),
  selected: 100,
});
scale.element.classList.add("lab-zoom");
headerControls.append(scale.element);

const telemetry = add(root, "section", null, "lab-section");
add(telemetry, "h2", english.metricHeading);
const metrics = add(telemetry, "div", null, "lab-metrics");
english.metrics.forEach((label, index) => addTile(metrics, label, reading(current[index]), fresh));

const columns = add(root, "div", null, "lab-columns");
const history = segmentedControl({
  label: english.window,
  options: [5, 15, 60].map(value => ({ value, label: `${value} min` })),
  selected: 15,
  onChange: renderHistory,
});
const chart = timeChart(presenter, window.uPlot, {
  title: english.powerChart,
  windowControl: history.element,
  timeLabel: english.time,
  axisLabel: value => presenter.number(value, 0),
});
columns.append(chart.element);

function renderHistory(minutes) {
  const count = minutes * 12;
  const samples = Array.from({ length: count + 1 }, (_, i) => i * 5 - count * 5)
    .filter(time => time >= -2100);
  const series = [0, 1].map(index => ({
    id: index ? "power.consumption" : "power.production",
    label: english.metrics[index],
    timestamps: samples,
    values: samples.map(time => {
      const wave = index ? Math.sin(time / 240) * 23 : Math.sin(time / 170) * 34;
      return current[index] + Math.round(wave + Math.sin(time / 56) * 13);
    }),
    current: reading(current[index]),
  }));
  const state = minutes === 60 ? { ...fresh, detail: english.partial(35) } : fresh;
  chart.update({ series, state, start: -minutes * 60, end: 0 });
}
renderHistory(15);

const table = metricTable(presenter, {
  title: english.generators,
  columns: english.columns.map((label, index) => ({ label, numeric: index === 2 })),
  emptyCellLabel: english.statuses.empty,
});
columns.append(table.element);
table.update({
  state: fresh,
  groups: english.groups.map((label, group) => ({
    id: label,
    summary: [label, english.groupStatus(3, 4), reading(192)],
    rows: [64, 64, 64, 0].map((output, index) => {
      const id = 1 + group * 4 + index;
      return {
        id,
        selected: id === 2,
        cells: [`GEN-${String(id).padStart(2, "0")}`, output ? english.running : english.standby, reading(output)],
      };
    }),
  })),
});

const stateSection = add(root, "section", null, "lab-section");
const stateHeading = add(stateSection, "header", null, "lab-section-heading");
add(stateHeading, "h2", english.stateHeading);
add(stateHeading, "span", english.stateExample, "d2-label");
const states = add(stateSection, "div", null, "lab-states");
const { statuses } = english;
for (const [value, state] of [
  [reading(0), fresh],
  [null, { kind: "loading", label: statuses.loading, detail: statuses.loadingDetail }],
  [reading(576, 852), stale],
  [null, { kind: "empty", label: statuses.empty, detail: statuses.emptyDetail }],
  [reading(576, 852), { kind: "error", label: statuses.error, detail: statuses.errorDetail + " · " + english.updated(48) }],
]) addTile(states, english.metrics[0], value, state);

const bottom = add(root, "div", null, "lab-columns");
const chat = add(bottom, "section", null, "lab-chat d2-panel");
add(chat, "h2", english.chat);
english.messages.forEach((text, index) => {
  const message = chatMessage();
  chat.append(message.element);
  message.update({
    author: index ? english.assistant : english.operator,
    role: index ? "assistant" : "operator",
    time: "09:41",
    text,
    status: index ? statuses.stopped : undefined,
  });
});
const bindings = add(bottom, "section", null, "lab-bindings");
add(bindings, "h2", english.strips);
const sources = statusStrip();
sources.update([
  { name: english.telemetry, label: statuses.live, kind: metricState(reading(0), 900, 2) },
  { name: english.sidecar, label: statuses.offline, kind: "empty" },
]);
const keyboard = statusStrip();
keyboard.update([{ key: "Esc", label: english.close }, { key: "C", label: english.export }]);
bindings.append(sources.element, keyboard.element);
