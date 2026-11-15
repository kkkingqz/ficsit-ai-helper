import { fillBar, metricTable, metricTile, objectCard, segmentedControl, statusStrip, timeChart } from "../components.js";
import { button, element, keyedList, mountView } from "./view-dom.js";

const tabs = ["energy", "resources"];
const windows = [5, 15, 60];

export function mountStatistics(root, { presenter, Plot, copy, actions }) {
  const page = mountView(root, "d2-statistics");
  const header = element("header", "d2-screen-toolbar", page);
  const tabControl = segmentedControl({
    label: copy.tabLabel,
    options: tabs.map(value => ({ value, label: copy.reports[value].label })),
    selected: "energy",
    onChange: actions.tab,
  });
  const windowControl = segmentedControl({
    label: copy.windowLabel,
    options: windows.map(value => ({ value, label: copy.window(value) })),
    selected: 15,
    onChange: actions.window,
  });
  const exportButton = button(copy.export, actions.export);
  exportButton.dataset.export = "";
  const freshness = statusStrip();
  freshness.element.setAttribute("aria-live", "polite");
  header.append(tabControl.element, windowControl.element, freshness.element, exportButton);
  const notices = element("p", "d2-screen-notice", page);
  notices.setAttribute("role", "status");
  const reports = new Map();
  let previousFreshness = "";

  for (const key of tabs) {
    const config = copy.reports[key];
    const report = element("section", "d2-stats-report", page);
    report.setAttribute("aria-label", config.label);
    const tiles = element("div", "d2-stats-tiles", report);
    const columns = element("div", "d2-stats-columns", report);
    const primary = element("div", "d2-stats-stack", columns);
    const secondary = element("aside", "d2-stats-stack", columns);
    const charts = config.charts.map(title => {
      const chart = timeChart(presenter, Plot, { title, timeLabel: copy.time, axisLabel: copy.axis });
      primary.append(chart.element);
      return chart;
    });
    const tables = config.tables.map(({ title, columns }, index) => {
      const table = metricTable(presenter, {
        title, columns, emptyCellLabel: copy.noValue,
        onSelect: index === 0 ? actions.selectObject : undefined,
      });
      if (index === 0) charts[0].element.after(table.element);
      else secondary.append(table.element);
      return table;
    });
    const meters = element("div", "d2-stats-stack", secondary);
    const updateMeters = keyedList(meters, id => fillBar(presenter, config.meters[id]));
    const selection = objectCard(presenter);
    secondary.append(selection.element);
    const catalog = metricCatalog(secondary, copy, actions);
    const updateTiles = keyedList(tiles, () => metricTile(presenter));
    reports.set(key, { report, charts, tables, selection, catalog, updateTiles, meters, updateMeters });
  }

  return {
    update(model) {
      tabControl.select(model.tab);
      windowControl.select(model.window);
      exportButton.disabled = !model.canExport;
      const freshnessKey = JSON.stringify(model.freshness);
      if (freshnessKey !== previousFreshness) freshness.update(model.freshness);
      previousFreshness = freshnessKey;
      const notice = model.notice ?? copy.sessionOnly;
      if (notices.textContent !== notice) notices.textContent = notice;
      for (const [key, view] of reports) view.report.hidden = key !== model.tab;
      const { charts, tables, selection, catalog, updateTiles, meters, updateMeters } = reports.get(model.tab);
      updateTiles(model.tiles);
      charts.forEach((chart, index) => {
        const data = model.charts[index];
        chart.element.hidden = !data;
        if (data) chart.update(data);
      });
      tables.forEach((table, index) => {
        const data = model.tables[index];
        table.element.hidden = !data;
        if (data) table.update(data);
      });
      const bars = model.meters ?? [];
      meters.hidden = !bars.length;
      updateMeters(bars);
      selection.element.hidden = !model.selection;
      if (model.selection) selection.update(model.selection);
      catalog(model.metrics);
    },
    handleExportAction() {
      const focused = document.activeElement;
      if (exportButton.disabled || (page.contains(focused) && focused.matches("input[type=search]"))) return false;
      exportButton.click();
      return true;
    },
    unmount() {
      for (const { charts } of reports.values()) charts.forEach(chart => chart.destroy());
      page.remove();
    },
  };
}

function metricCatalog(parent, copy, actions) {
  const panel = element("section", "d2-panel d2-metric-catalog", parent);
  const heading = element("h3", "d2-panel-heading", panel);
  heading.textContent = copy.metrics;
  const label = element("label", "d2-label", panel);
  label.textContent = copy.metricSearch;
  const search = element("input", "d2-screen-input", label);
  search.type = "search";
  search.dataset.metricSearch = "";
  const items = element("ul", "d2-scroll d2-metric-options", panel);
  items.tabIndex = 0;
  items.setAttribute("aria-label", copy.metrics);
  const noMatches = element("p", "d2-label", panel);
  noMatches.textContent = copy.noMatches;
  let records = [];
  const updateItems = keyedList(items, id => {
    const row = element("li");
    row.dataset.metric = "";
    const option = button("", () => actions.selectMetric(id));
    row.append(option);
    return {
      element: row,
      update(metric) {
        row.hidden = !metric.matches;
        option.textContent = metric.label;
        option.disabled = !metric.hasSeries;
        option.setAttribute("aria-pressed", String(Boolean(metric.selected)));
      },
    };
  });
  function filter() {
    const term = search.value.trim().toLocaleLowerCase(copy.locale);
    const filtered = records.map(metric => ({
      ...metric, matches: metric.label.toLocaleLowerCase(copy.locale).includes(term) || metric.id.includes(term),
    }));
    updateItems(filtered);
    noMatches.hidden = filtered.some(metric => metric.matches);
  }
  search.addEventListener("input", () => {
    filter();
    actions.searchMetrics?.(search.value.trim());
  });
  return metrics => {
    records = metrics;
    filter();
  };
}
