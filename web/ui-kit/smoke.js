const result = document.querySelector("#result");
const cases = document.querySelector("#cases");
const assert = (condition, message) => { if (!condition) throw new Error(message); };

try {
  const { createPresenter, metricTile, metricTable, chatMessage, statusStrip,
          metricState, alignSeries, segmentedControl, timeChart, fillBar, objectCard, promptChip } = await import("./components.js");
  const presenter = createPresenter("en", { megawatt: "MW" });
  const tile = metricTile(presenter);
  cases.append(tile.element);
  const reading = { value: 0, unit: "megawatt", precisionDigits: 0, state: "value" };
  const state = { kind: "fresh", label: "Updated 2 s ago" };
  tile.update({ label: "Grid power", reading, state, source: "Live source" });
  assert(tile.element.querySelector(".d2-reading").textContent === "0 MW", "A valid zero must be visible");
  assert(tile.element.textContent.includes("Live source") && tile.element.textContent.includes(state.label),
    "The source is distinct from freshness");
  tile.update({ label: "Grid power", reading, state: { kind: "empty", label: "No data" } });
  assert(tile.element.querySelector(".d2-reading").textContent === "—", "Empty must suppress a reading");
  tile.update({ label: "Grid power", reading, state: { kind: "stale", label: "Updated 61 s ago" } });
  assert(tile.element.textContent.includes("0 MW") && tile.element.dataset.state === "stale",
    "Stale retains the last reading");
  assert(presenter.reading({ ...reading, value: -1204.5, precisionDigits: 2 }) === "-1\u202f204.50 MW",
    "Readings use metric precision and space grouping");
  assert(presenter.reading({ ...reading, state: "notApplicable" }) === "—", "Not applicable is missing");
  assert(metricState({ ...reading, sessionTimeSec: 0 }, 10, 2) === "fresh" &&
    metricState({ ...reading, sessionTimeSec: 0 }, 11, 2) === "stale" &&
    metricState({ ...reading, sessionTimeSec: 0 }, 60, 20) === "fresh" &&
    metricState({ ...reading, sessionTimeSec: 0 }, 61, 20) === "stale", "Freshness boundaries differ by metric");
  const aligned = alignSeries([
    { timestamps: [5, 10, 20], values: [2, 3, 4] },
    { timestamps: [10, 15], values: [7, null] },
  ]);
  assert(JSON.stringify(aligned[0]) === "[5,10,15,20]" && aligned[1][2] === undefined &&
    aligned[1][3] === 4 && aligned[2][2] === null, "Series retain exact timestamps and explicit gaps");

  const missed = alignSeries([{ timestamps: [5, 10, 20], values: [2, 3, 4], intervalSec: 5 }]);
  assert(JSON.stringify(missed) === "[[5,10,15,20],[2,3,null,4]]",
    "Missing nominal samples must break the line without moving acquired samples");

  const localized = createPresenter("ru", { megawatt: "МВт" });
  assert(localized.reading({ ...reading, value: 1204.5, precisionDigits: 2 }) === "1\u202f204,50 МВт",
    "The supplied locale controls the decimal separator and unit translations");

  const longTile = metricTile(createPresenter("ru", { megawatt: "предметов в минуту" }));
  longTile.element.style.inlineSize = "223px";
  longTile.element.classList.add("d2");
  longTile.element.style.setProperty("--d2-scale", "1.5");
  cases.append(longTile.element);
  longTile.update({ label: "Длинная подпись мощности", reading: { ...reading, value: 1204500 }, state });
  const textWidth = longTile.element.querySelector(".d2-reading");
  assert(textWidth.scrollWidth <= textWidth.clientWidth + 1, "A translated unit must wrap at 150%");
  const bar = fillBar(presenter, "Battery charge");
  bar.update({ value: 72, max: 100, reading });
  assert(bar.element.querySelector("progress").position === .72, "A fill bar uses a native measurement");
  const card = objectCard(presenter);
  card.update({ title: "Coal Generator", fields: [{ label: "Output", value: reading }] });
  assert(card.element.textContent.includes("0 MW"), "Cards reuse metric formatting");
  let prompt;
  const chip = promptChip({ label: "Power balance", prompt: "Show the power balance", onSelect: value => { prompt = value; } });
  chip.click();
  assert(prompt === "Show the power balance", "A template chip passes the prompt to its caller");

  let chart;
  const series = [
    { id: "a", label: "Generation", current: reading, timestamps: [5, 10, 20], values: [2, 3, 4] },
    { id: "b", label: "Consumption", current: reading, timestamps: [5, 20], values: [2, 3] },
  ];
  function draw(windowMinutes, kind = "fresh", selected = series) {
    chart.update({
      state: { kind, label: kind, detail: windowMinutes === 60 ? "Partial session history" : undefined },
      series: selected, start: 20 - windowMinutes * 60, end: 20,
    });
  }
  const history = segmentedControl({
    label: "History", selected: 5, options: [5, 60].map(value => ({ value, label: String(value) })),
    onChange: draw,
  });
  let plot;
  function recordPlot(...args) {
    plot = new window.uPlot(...args);
    return plot;
  }
  chart = timeChart(presenter, recordPlot, {
    title: "Power", timeLabel: String, axisLabel: value => localized.number(value, 0), windowControl: history.element,
  });
  cases.append(chart.element);
  draw(5);
  const canvas = chart.element.querySelector("canvas");
  assert(canvas && chart.element.querySelectorAll("[data-series]").length === 2, "Chart must render");
  const option = history.element.querySelector('input[value="60"]');
  option.click();
  assert(option.checked && chart.element.textContent.includes("Partial session history") &&
    canvas === chart.element.querySelector("canvas"), "Window changes retain the existing plot");
  draw(5, "stale", [series[1]]);
  assert(chart.element.querySelector('[data-series="1"]').textContent.includes("Consumption"),
    "Selected series keeps its style after another series is removed");
  draw(5, "empty", []);
  assert(chart.element.querySelector("canvas") && chart.element.dataset.state === "empty",
    "Empty charts retain the plotting area");
  cases.style.setProperty("--d2-scale", "1.5");
  draw(5, "fresh", [{ ...series[0], values: [1_000_000, 2_000_000, 3_000_000] }]);
  await new Promise(resolve => requestAnimationFrame(resolve));
  const measure = document.createElement("canvas").getContext("2d");
  measure.font = getComputedStyle(chart.element.querySelector(".d2-plot")).font;
  const tickWidth = measure.measureText(localized.number(3_000_000, 0)).width;
  assert(plot.bbox.left / window.devicePixelRatio >= tickWidth + 10,
    `A scaled chart reserves enough room for large localized axis labels (${plot.bbox.left} vs ${tickWidth})`);
  cases.style.removeProperty("--d2-scale");
  chart.destroy();

  const table = metricTable(presenter, { title: "Generators by type", columns: [
    { label: "Type" }, { label: "Output", numeric: true },
  ] });
  cases.append(table.element);
  const rows = Array.from({ length: 24 }, (_, id) => ({ id, cells: [`Generator ${id}`, reading] }));
  const group = { id: "coal", summary: ["Coal", reading], rows };
  table.update({ state, groups: [group] });
  const viewport = table.element.querySelector(".d2-scroll");
  viewport.focus();
  viewport.scrollTop = 100;
  assert(viewport.scrollTop === 100, "Rows must scroll within the panel");
  const first = table.element.querySelector("tr[data-row]");
  table.update({ state, groups: [{ ...group, rows: rows.map(row => ({ ...row, cells: [row.cells[0], { ...reading, value: 14 }] })) }] });
  assert(document.activeElement === viewport && viewport.scrollTop === 100 &&
    first === table.element.querySelector("tr[data-row]") && first.textContent.includes("14 MW"),
    "A snapshot must preserve scroll, focus and row identity");
  assert(Math.abs(table.element.querySelector("thead").getBoundingClientRect().top -
    viewport.getBoundingClientRect().top) < 2, "The column header must stick to the scroller");

  table.update({ state, groups: [{ ...group, rows: [
    { ...rows[0], cells: ["Generator 0", { reading, trend: {
      timestamps: [5, 10, 20], values: [2, 3, 4], intervalSec: 5,
    }, trendLabel: "Output trend" }] },
  ] }] });
  assert(first.querySelector('svg[aria-label="Output trend"] path') && first.textContent.includes("0 MW"),
    "A numeric table cell must retain its value alongside the trend");

  const message = chatMessage();
  cases.append(message.element);
  const chat = { author: "Foreman", role: "assistant", time: "09:41", text: "<b>Energy</b>" };
  message.update({ ...chat, status: "Streaming" });
  const text = message.element.querySelector(".d2-chat-text");
  message.update({ ...chat, text: "<b>Energy</b> remains available.", status: "Stopped" });
  assert(text === message.element.querySelector(".d2-chat-text") && !text.querySelector("b") &&
    message.element.textContent.includes("Stopped"), "Chat updates in place and treats model output as text");
  const strip = statusStrip();
  strip.update([{ kind: "fresh", label: "LIVE" }, { kind: "empty", label: "OFFLINE" }]);
  assert(strip.element.textContent.includes("LIVE") && strip.element.textContent.includes("OFFLINE"),
    "Telemetry and connection states are distinct");

  result.textContent = "D-2 smoke passed";
  result.dataset.pass = "true";
} catch (error) {
  result.textContent = String(error);
  result.dataset.pass = "false";
}
