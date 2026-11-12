"use strict";

(() => {
  // Строки автономного спайка. Текст продуктовых экранов приходит из UE Localization.
  const copy = {
    eyebrow: "FICSIT AI / S8",
    title: "Terminal render workload",
    source: "FIXTURE · 1 Hz",
    window: "History",
    equipment: "Generators by type",
    columns: ["Generator", "State", "Output (MW)"],
    metrics: ["Generation", "Consumption", "Capacity", "Headroom",
              "Resource inflow", "Resource outflow", "Resource balance", "Online generators"],
    units: ["MW", "MW", "MW", "MW", "items/min", "items/min", "items/min", ""],
    live: "LIVE",
    running: "Running",
    standby: "Standby",
    groupStatus: (running, total) => `${running} / ${total} running`,
    samples: (count) => `${count} samples per series`,
    generator: (index) => `GEN-${String(index + 1).padStart(2, "0")}`,
  };

  const windows = [60, 300, 600];
  const generatorTypes = [
    { name: "Coal", total: 4, running: 3 },
    { name: "Fuel", total: 4, running: 3 },
    { name: "Geothermal", total: 4, running: 3 },
  ];
  const runningCount = generatorTypes.reduce((count, type) => count + type.running, 0);
  const charts = [
    { title: "Power (MW)", labels: ["Generation", "Consumption"], max: 800, fields: [0, 1] },
    { title: "Resources (items/min)", labels: ["Inflow", "Outflow"], max: 200, fields: [4, 5] },
  ];
  const number = new Intl.NumberFormat("en");

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
            inflow, outflow, inflow - outflow, runningCount];
  }

  const params = new URLSearchParams(location.search);
  const overlay = params.get("overlay") === "1";
  const metrics = document.getElementById("metrics");
  const metricIndexes = overlay ? [0, 1, 3] : copy.metrics.keys();
  const tiles = Array.from(metricIndexes, (index) => {
    const tile = element("article", "metric");
    const reading = element("p", "metric-value");
    const value = element("span", "metric-number");
    reading.append(value);
    if (copy.units[index]) reading.append(" ", element("span", "metric-unit", copy.units[index]));
    tile.append(element("h2", "metric-label", copy.metrics[index]), reading,
                element("p", "metric-status", copy.live));
    metrics.append(tile);
    return { index, value };
  });

  let elapsed = 0;

  function updateMetrics(values) {
    for (const { index, value } of tiles) {
      value.textContent = number.format(values[index]);
    }
  }

  function sampleEverySecond(update) {
    setInterval(() => {
      elapsed += 1;
      update(snapshot(elapsed));
    }, 1000);
  }

  if (overlay) {
    document.documentElement.classList.add("hud");
    document.querySelectorAll(".topbar, .details").forEach((node) => node.remove());
    updateMetrics(snapshot(elapsed));
    sampleEverySecond(updateMetrics);
    return;
  }

  document.documentElement.classList.add("terminal");
  document.querySelectorAll("[data-copy]").forEach((node) => {
    node.textContent = copy[node.dataset.copy];
  });

  for (const title of copy.columns) {
    const header = element("th", "", title);
    header.scope = "col";
    document.getElementById("columns").append(header);
  }

  const table = document.getElementById("generator-table");
  let generatorIndex = 0;
  const generatorGroups = generatorTypes.map(({ name, total, running }) => {
    const body = element("tbody");
    const summary = element("tr", "generator-group");
    const groupName = element("th", "", name);
    groupName.scope = "rowgroup";
    const groupOutput = element("td", "", "0");
    summary.append(groupName, element("td", "", copy.groupStatus(running, total)), groupOutput);
    body.append(summary);

    const activeOutputs = [];
    for (let index = 0; index < total; index += 1) {
      const active = index < running;
      const row = element("tr");
      const generatorName = element("th", "", copy.generator(generatorIndex));
      generatorName.scope = "row";
      generatorIndex += 1;
      const value = element("td", "", "0");
      row.append(generatorName,
                 element("td", active ? "running" : "standby", active ? copy.running : copy.standby), value);
      body.append(row);
      if (active) activeOutputs.push(value);
    }
    table.append(body);
    return { groupOutput, activeOutputs };
  });

  let history = [];
  const clock = document.getElementById("elapsed");
  const selector = document.getElementById("points");
  const requested = Number(params.get("points"));
  const initialWindow = windows.includes(requested) ? requested : windows[0];
  for (const count of windows) {
    const option = element("option", "", copy.samples(count));
    option.value = count;
    selector.append(option);
  }
  selector.value = initialWindow;

  const colors = getComputedStyle(document.documentElement);
  const color = (name) => colors.getPropertyValue(`--${name}`).trim();
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
    updateMetrics(values);

    const baseOutput = Math.floor(values[0] / runningCount);
    let extra = values[0] % runningCount;
    for (const { groupOutput, activeOutputs } of generatorGroups) {
      let totalOutput = 0;
      for (const output of activeOutputs) {
        const additional = Number(extra > 0);
        const reading = baseOutput + additional;
        extra -= additional;
        totalOutput += reading;
        output.textContent = number.format(reading);
      }
      groupOutput.textContent = number.format(totalOutput);
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
  sampleEverySecond((values) => {
    history.shift();
    history.push({ second: elapsed, values });
    updateValues(values);
    for (const { chart, fields } of plots) chart.setData(alignedData(fields));
  });
})();
