"use strict";

(() => {
  // Строки автономного спайка. Текст продуктовых экранов приходит из UE Localization.
  const copy = {
    eyebrow: "FICSIT AI / S8",
    title: "Terminal render workload",
    source: "FIXTURE · 1 Hz",
    window: "History",
    equipment: "Generators",
    columns: ["Generator", "State", "Output (MW)"],
    metrics: ["Generation", "Consumption", "Capacity", "Headroom",
              "Resource inflow", "Resource outflow", "Resource balance", "Online generators"],
    units: ["MW", "MW", "MW", "MW", "items/min", "items/min", "items/min", ""],
    live: "LIVE",
    running: "Running",
    standby: "Standby",
    samples: (count) => `${count} samples per series`,
    generator: (index) => `GEN-${String(index + 1).padStart(2, "0")}`,
  };

  const windows = [60, 300, 600];
  const generatorCount = 12;
  const charts = [
    { title: "Power (MW)", labels: ["Generation", "Consumption"], max: 800, fields: [0, 1] },
    { title: "Resources (items/min)", labels: ["Inflow", "Outflow"], max: 200, fields: [4, 5] },
  ];
  const number = new Intl.NumberFormat("en");
  const colors = getComputedStyle(document.documentElement);
  const color = (name) => colors.getPropertyValue(`--${name}`).trim();

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function snapshot(second) {
    const wave = (period) => Math.sin(second / period);
    const generation = 555 + Math.round(47 * wave(9) + 18 * wave(3));
    const consumption = 418 + Math.round(52 * wave(11) + 25 * wave(4));
    const capacity = 720;
    const inflow = 142 + Math.round(19 * wave(7));
    const outflow = 120 + Math.round(18 * wave(5));
    return [generation, consumption, capacity, capacity - consumption,
            inflow, outflow, inflow - outflow, activeOutputs.length];
  }

  document.querySelectorAll("[data-copy]").forEach((node) => {
    node.textContent = copy[node.dataset.copy];
  });

  const tiles = copy.metrics.map((label, index) => {
    const tile = element("article", "metric");
    const reading = element("p", "metric-value");
    const value = element("span", "metric-number");
    reading.append(value);
    if (copy.units[index]) reading.append(" ", element("span", "metric-unit", copy.units[index]));
    tile.append(element("h2", "metric-label", label), reading, element("p", "metric-status", copy.live));
    document.getElementById("metrics").append(tile);
    return value;
  });

  for (const title of copy.columns) {
    const header = element("th", "", title);
    header.scope = "col";
    document.getElementById("columns").append(header);
  }

  const activeOutputs = [];
  for (let index = 0; index < generatorCount; index += 1) {
    const running = index % 4 !== 3;
    const row = element("tr");
    const value = element("td", "", "0");
    row.append(element("td", "", copy.generator(index)),
               element("td", running ? "running" : "standby", running ? copy.running : copy.standby), value);
    document.getElementById("equipment-rows").append(row);
    if (running) activeOutputs.push(value);
  }

  let elapsed = 0;
  let history = [];
  const clock = document.getElementById("elapsed");
  const selector = document.getElementById("points");
  const requested = Number(new URLSearchParams(location.search).get("points"));
  const initialWindow = windows.includes(requested) ? requested : windows[0];
  for (const count of windows) {
    const option = element("option", "", copy.samples(count));
    option.value = count;
    selector.append(option);
  }
  selector.value = initialWindow;

  const axis = {
    font: "13px system-ui, sans-serif",
    stroke: color("text-muted"),
    grid: { stroke: color("stroke"), width: 1 },
    ticks: { stroke: color("stroke"), width: 1 },
  };

  function alignedData(fields) {
    return [history.map(({ second }) => second),
            ...fields.map((field) => history.map(({ values }) => values[field]))];
  }

  function refill(count) {
    history = Array.from({ length: count }, (_, index) => {
      const second = elapsed - count + 1 + index;
      return { second, values: snapshot(second) };
    });
  }

  refill(initialWindow);

  const plots = charts.map(({ title, labels, max, fields }) => {
    const panel = element("article", "panel");
    const heading = element("div", "chart-heading");
    const meta = element("span", "chart-meta");
    const legend = element("div", "legend");
    const plot = element("div", "plot");
    plot.setAttribute("role", "img");
    plot.setAttribute("aria-label", `${title}: ${labels.join(", ")}`);
    heading.append(element("h2", "", title), meta);
    legend.append(...labels.map((label) => element("span", "legend-item", label)));
    panel.append(heading, legend, plot);
    document.getElementById("charts").append(panel);

    const size = () => ({ width: plot.clientWidth, height: plot.clientHeight });
    const chart = new uPlot({
      ...size(),
      scales: { x: { time: false }, y: { range: [0, max] } },
      series: [
        {},
        { label: labels[0], stroke: color("info"), width: 2 },
        { label: labels[1], stroke: color("accent"), width: 2, dash: [6, 4] },
      ],
      axes: [
        { ...axis, size: 25, values: (_, ticks) => ticks.map((tick) => `${tick - elapsed} s`) },
        { ...axis, size: 36 },
      ],
      cursor: { show: false },
      legend: { show: false },
    }, alignedData(fields), plot);

    new ResizeObserver(() => {
      const next = size();
      if (next.width > 0 && next.height > 0 && (chart.width !== next.width || chart.height !== next.height)) {
        chart.setSize(next);
      }
    }).observe(plot);

    meta.textContent = copy.samples(history.length);
    return { chart, fields, meta };
  });

  function updateValues(values) {
    clock.textContent = `+${elapsed} s`;
    for (const [index, tile] of tiles.entries()) {
      tile.textContent = number.format(values[index]);
    }

    const baseOutput = Math.floor(values[0] / activeOutputs.length);
    const extra = values[0] % activeOutputs.length;
    for (const [index, output] of activeOutputs.entries()) {
      output.textContent = number.format(baseOutput + Number(index < extra));
    }
  }

  selector.addEventListener("change", () => {
    refill(Number(selector.value));
    for (const { chart, fields, meta } of plots) {
      chart.setData(alignedData(fields));
      meta.textContent = copy.samples(history.length);
    }
  });

  updateValues(history.at(-1).values);
  setInterval(() => {
    elapsed += 1;
    const values = snapshot(elapsed);
    history.shift();
    history.push({ second: elapsed, values });
    updateValues(values);
    for (const { chart, fields } of plots) chart.setData(alignedData(fields));
  }, 1000);
})();
