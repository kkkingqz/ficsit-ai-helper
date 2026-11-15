function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function setText(element, value = "") {
  if (element.textContent !== value) element.textContent = value;
}

function setState(element, state) {
  if (element.dataset.state !== state.kind) element.dataset.state = state.kind;
}

function panelNotice() {
  const container = node("p", "d2-notice");
  const label = node("span", "d2-state");
  const detail = node("span", "d2-notice-detail");
  container.append(label, detail);
  return {
    element: container,
    update(state) {
      setState(container, state);
      setText(label, state.label);
      setText(detail, state.detail ?? "");
      detail.hidden = !state.detail;
    },
  };
}

function hasReading(reading) {
  return reading?.state !== "notApplicable" && Number.isFinite(reading?.value);
}

export function createPresenter(locale, units) {
  const formats = new Map();
  function number(value, digits) {
    if (!formats.has(digits)) {
      formats.set(digits, new Intl.NumberFormat(locale, {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }));
    }
    return formats.get(digits).formatToParts(value)
      .map(part => part.type === "group" ? "\u202f" : part.value).join("");
  }

  function parts(reading) {
    if (!hasReading(reading)) return { amount: "—", unit: "" };
    return {
      amount: number(reading.value, reading.precisionDigits ?? 0),
      unit: units[reading.unit] ?? "",
    };
  }

  return {
    number,
    parts,
    reading(reading) {
      const { amount, unit } = parts(reading);
      return unit ? `${amount} ${unit}` : amount;
    },
  };
}

export function metricState(reading, sessionTimeSec, sampleIntervalSec) {
  if (!hasReading(reading)) return "empty";
  return sessionTimeSec - reading.sessionTimeSec > Math.max(3 * sampleIntervalSec, 10)
    ? "stale"
    : "fresh";
}

export function metricTile(presenter) {
  const tile = node("article", "d2-panel d2-tile");
  const title = node("h3", "d2-label");
  const reading = node("p", "d2-reading");
  const amount = node("span", "d2-amount");
  const unit = node("span", "d2-unit");
  const notice = panelNotice();
  const separator = document.createTextNode(" ");
  reading.append(amount, separator, unit);
  tile.append(title, reading, notice.element);

  return {
    element: tile,
    update({ label, reading: value, state }) {
      const visible = state.kind === "loading" || state.kind === "empty" ? null : value;
      const parts = presenter.parts(visible);
      setText(title, label);
      setText(amount, parts.amount);
      setText(unit, parts.unit);
      unit.hidden = !parts.unit;
      separator.data = parts.unit ? " " : "";
      setState(tile, state);
      notice.update(state);
    },
  };
}

export function alignSeries(series) {
  const bySeries = series.map(({ timestamps, values }) =>
    new Map(timestamps.map((timestamp, index) => [timestamp, values[index]])));
  const timestamps = [...new Set(series.flatMap(item => item.timestamps))].sort((a, b) => a - b);
  return [timestamps, ...bySeries.map(points => timestamps.map(timestamp => points.get(timestamp)))];
}

export function timeChart(presenter, Plot, { title, timeLabel, axisLabel, windowControl }) {
  const figure = node("figure", "d2-panel d2-chart");
  const heading = node("figcaption", "d2-panel-heading");
  heading.append(node("h3", "", title));
  if (windowControl) heading.append(windowControl);
  const legend = node("ul", "d2-legend");
  const surface = node("div", "d2-plot");
  const notice = panelNotice();
  figure.append(heading, legend, surface, notice.element);
  surface.setAttribute("aria-hidden", "true");

  const seriesColors = ["info", "accent", "text", "text-muted"];
  const seriesDashes = [[], [8, 4], [2, 4], [10, 4, 2, 4]];
  let slots = new Map();
  let model;
  let plot;
  let plotKey;
  let plotWidth;
  let plotHeight;
  let dataChanged = false;

  function render() {
    const width = surface.clientWidth;
    const height = surface.clientHeight;
    if (!model || !width || !height) return;

    const { series } = model;
    const style = getComputedStyle(surface);
    const font = style.font;
    const scale = Number(style.getPropertyValue("--d2-scale")) || 1;
    const key = JSON.stringify([font, scale, series.map(item => [item.id, item.label, slots.get(item.id)])]);
    if (plot && key === plotKey) {
      if (width !== plotWidth || height !== plotHeight) plot.setSize({ width, height });
      if (dataChanged) plot.setData(alignSeries(series));
    } else {
      const color = name => getComputedStyle(figure).getPropertyValue(`--d2-${name}`).trim();
      const axis = {
        font,
        stroke: color("text-muted"),
        grid: { stroke: color("stroke"), width: 1 },
        ticks: { stroke: color("stroke"), width: 1 },
      };
      const data = alignSeries(series);
      plot?.destroy();
      plot = new Plot({
        width, height,
        scales: {
          x: { time: false, range: () => [model.start, model.end] },
          y: { range: (_plot, min, max) => {
            if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
            return [Math.min(0, min), Math.max(1, max) * 1.12];
          } },
        },
        axes: [
          { ...axis, size: Math.ceil(31 * scale), values: (_plot, values) => values.map(value => timeLabel(value - model.end)) },
          { ...axis, size: Math.ceil(52 * scale), values: (_plot, values) => values.map(axisLabel) },
        ],
        series: [{}, ...series.map(item => {
          const slot = slots.get(item.id);
          return {
            label: item.label, stroke: color(seriesColors[slot]), dash: seriesDashes[slot],
            width: 2, points: { show: (chart, index) => chart.data[index].filter(Number.isFinite).length === 1 },
          };
        })],
        legend: { show: false },
        cursor: { show: false },
      }, data, surface);
      plotKey = key;
    }
    plotWidth = width;
    plotHeight = height;
    dataChanged = false;
  }

  const resize = new ResizeObserver(render);
  resize.observe(surface);

  return {
    element: figure,
    update({ state, series, start, end }) {
      const selected = series.slice(0, 4);
      const next = new Map();
      for (const item of selected) {
        if (slots.has(item.id)) next.set(item.id, slots.get(item.id));
      }
      for (const item of selected) {
        if (!next.has(item.id)) next.set(item.id, seriesColors.findIndex((_, index) => ![...next.values()].includes(index)));
      }
      slots = next;
      const hasData = state.kind !== "empty" && state.kind !== "loading";
      const displayed = hasData ? selected : selected.map(item => ({ ...item, timestamps: [], values: [] }));
      // Two null boundary samples keep both axes visible when all series are empty.
      model = {
        start, end,
        series: displayed.length ? displayed : [{ id: "empty", label: "", timestamps: [], values: [] }],
      };
      if (!model.series.some(item => item.timestamps.length)) {
        model.series = model.series.map(item => ({ ...item, timestamps: [start, end], values: [null, null] }));
      }
      const entries = selected.map(item => {
        const entry = node("li");
        entry.dataset.series = slots.get(item.id);
        entry.append(node("i"), node("span", "", item.label),
          node("strong", "", hasData ? presenter.reading(item.current) : "—"));
        return entry;
      });
      legend.replaceChildren(...entries);
      setState(figure, state);
      notice.update(state);
      dataChanged = true;
      render();
    },
    destroy() {
      resize.disconnect();
      plot?.destroy();
    },
  };
}

let nextTableId = 0;

export function metricTable(presenter, { title, columns, emptyCellLabel }) {
  const panel = node("section", "d2-panel d2-table-panel");
  const heading = node("h3", "d2-panel-heading", title);
  heading.id = `d2-table-${++nextTableId}`;
  const viewport = node("div", "d2-scroll");
  viewport.tabIndex = 0;
  viewport.setAttribute("role", "region");
  viewport.setAttribute("aria-labelledby", heading.id);
  const table = node("table");
  const head = table.createTHead().insertRow();
  for (const column of columns) {
    const th = node("th", column.numeric ? "d2-number" : "", column.label);
    th.scope = "col";
    head.append(th);
  }
  const empty = table.createTBody();
  const placeholder = empty.insertRow().insertCell();
  placeholder.colSpan = columns.length;
  const notice = panelNotice();
  viewport.append(table);
  panel.append(heading, viewport, notice.element);
  const bodies = new Map();

  function setCells(row, values, rowGroup = false) {
    columns.forEach((column, index) => {
      let cell = row.cells[index];
      if (!cell) {
        cell = node(index === 0 ? "th" : "td", column.numeric ? "d2-number" : "");
        if (index === 0) cell.scope = rowGroup ? "rowgroup" : "row";
        row.append(cell);
      }
      const value = values[index];
      const formatted = typeof value === "object" || value == null ? presenter.reading(value) : String(value);
      setText(cell, formatted);
      if (formatted === "—" && emptyCellLabel) cell.setAttribute("aria-label", emptyCellLabel);
      else cell.removeAttribute("aria-label");
    });
  }

  function reconcile(parent, records, cache, build, update, anchor = null) {
    const wanted = new Set(records.map(record => record.id));
    for (const [id, entry] of cache) {
      if (wanted.has(id)) continue;
      entry.element.remove();
      cache.delete(id);
    }

    let before = anchor ? anchor.nextElementSibling : parent.firstElementChild;
    for (const record of records) {
      let entry = cache.get(record.id);
      if (!entry) {
        entry = build();
        cache.set(record.id, entry);
      }
      if (entry.element !== before) parent.insertBefore(entry.element, before);
      update(entry, record);
      before = entry.element.nextElementSibling;
    }
  }

  return {
    element: panel,
    update({ groups, state }) {
      const visible = state.kind === "empty" || state.kind === "loading" ? [] : groups;
      empty.hidden = visible.length > 0;
      setText(placeholder, state.detail ?? state.label);
      reconcile(table, visible, bodies, () => ({
        element: node("tbody"), summary: node("tr", "d2-group"), rows: new Map(),
      }), (group, record) => {
        if (record.summary) {
          if (group.summary.parentNode !== group.element) group.element.prepend(group.summary);
          setCells(group.summary, record.summary, true);
        } else group.summary.remove();
        reconcile(group.element, record.rows, group.rows, () => {
          const row = node("tr");
          row.dataset.row = "";
          return { element: row };
        }, (entry, row) => {
          setCells(entry.element, row.cells);
          entry.element.classList.toggle("d2-selected", Boolean(row.selected));
        }, record.summary ? group.summary : null);
      }, empty);
      setState(panel, state);
      notice.update(state);
    },
  };
}

export function chatMessage() {
  const article = node("article", "d2-message");
  const heading = node("header", "d2-message-heading");
  const author = node("strong");
  const time = node("time");
  const status = node("span", "d2-message-status");
  const text = node("p", "d2-chat-text");
  heading.append(author, time, status);
  article.append(heading, text);
  return {
    element: article,
    update(message) {
      article.dataset.role = message.role;
      setText(author, message.author);
      setText(time, message.time);
      if (message.dateTime) time.dateTime = message.dateTime;
      else time.removeAttribute("datetime");
      setText(status, message.status);
      status.hidden = !message.status;
      setText(text, message.text);
    },
  };
}

export function statusStrip() {
  const strip = node("ul", "d2-strip");
  return {
    element: strip,
    update(items) {
      strip.replaceChildren(...items.map(item => {
        const entry = node("li");
        if (item.name) entry.append(node("span", "d2-label", item.name));
        if (item.key) entry.append(node("kbd", "", item.key));
        const value = node("span", item.kind ? "d2-state" : "", item.label);
        if (item.kind) setState(value, item);
        entry.append(value);
        return entry;
      }));
    },
  };
}

export function segmentedControl({ label, options, selected, onChange }) {
  const fieldset = node("fieldset", "d2-segmented");
  fieldset.append(node("legend", "d2-visually-hidden", label));
  const radios = new Map();
  const name = `d2-segment-${++nextTableId}`;
  for (const option of options) {
    const caption = node("label");
    const input = node("input", "d2-visually-hidden");
    input.type = "radio";
    input.name = name;
    input.value = option.value;
    input.checked = option.value === selected;
    if (onChange) input.addEventListener("change", () => onChange(option.value));
    radios.set(option.value, input);
    caption.append(input, node("span", "", option.label));
    fieldset.append(caption);
  }
  return {
    element: fieldset,
    select(value) {
      const radio = radios.get(value);
      if (radio) radio.checked = true;
    },
  };
}
