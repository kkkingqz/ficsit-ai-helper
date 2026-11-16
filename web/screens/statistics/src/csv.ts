import type {
  ChartModel,
  ChartSeries,
  HistoryWindowMinutes,
  ReportTab,
  TableModel,
} from "./types.js";

/**
 * Escapes a cell according to RFC 4180.
 * If the value contains comma, double quote, CR, or LF, enclose in double quotes
 * and escape internal double quotes by doubling them ("").
 */
export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  let str: string;
  if (typeof value === "object") {
    if ("reading" in (value as any)) {
      const r = (value as any).reading;
      str = r && Number.isFinite(r.value) ? String(r.value) : "";
    } else if ("value" in (value as any) && Number.isFinite((value as any).value)) {
      str = String((value as any).value);
    } else {
      str = String(value);
    }
  } else {
    str = String(value);
  }

  if (str.includes('"') || str.includes(",") || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function buildCsvRow(cells: unknown[]): string {
  return cells.map(escapeCsvCell).join(",") + "\r\n";
}

export interface StatisticsExportData {
  tab: ReportTab;
  window: HistoryWindowMinutes;
  sessionTimeSec?: number;
  tables: Array<{
    title: string;
    source?: string;
    columns: string[];
    rows: Array<unknown[]>;
  }>;
  charts: Array<{
    title: string;
    series: Array<{
      id: string;
      label: string;
      timestamps: number[];
      values: (number | null)[];
    }>;
  }>;
}

/**
 * Generates an RFC 4180 compliant CSV string representing the active report and window.
 */
export function generateStatisticsCsv(data: StatisticsExportData): string {
  let csv = "";

  // 1. Metadata header
  csv += buildCsvRow(["# FICSIT AI Statistics Export"]);
  csv += buildCsvRow(["# Report", data.tab.toUpperCase()]);
  csv += buildCsvRow(["# Window", `${data.window} min`]);
  if (data.sessionTimeSec !== undefined) {
    csv += buildCsvRow(["# Session Time", `${data.sessionTimeSec} s`]);
  }
  csv += buildCsvRow(["# Generated At", new Date().toISOString()]);
  csv += "\r\n";

  // 2. Tables
  for (const table of data.tables) {
    csv += buildCsvRow([`[TABLE: ${table.title}]`]);
    if (table.source) {
      csv += buildCsvRow([`# Source: ${table.source}`]);
    }
    csv += buildCsvRow(table.columns);
    for (const row of table.rows) {
      csv += buildCsvRow(row);
    }
    csv += "\r\n";
  }

  // 3. Time Series Charts
  for (const chart of data.charts) {
    if (!chart.series.length) continue;
    csv += buildCsvRow([`[CHART: ${chart.title}]`]);

    // Collect all unique sorted timestamps
    const allTimestamps = Array.from(
      new Set(chart.series.flatMap((s) => s.timestamps))
    ).sort((a, b) => a - b);

    const header = ["Timestamp (s)", ...chart.series.map((s) => s.label || s.id)];
    csv += buildCsvRow(header);

    // Map timestamps to values per series
    const seriesMaps = chart.series.map((s) => {
      const m = new Map<number, number | null>();
      s.timestamps.forEach((t, i) => m.set(t, s.values[i] ?? null));
      return m;
    });

    for (const t of allTimestamps) {
      const row: unknown[] = [t];
      for (const sm of seriesMaps) {
        row.push(sm.get(t) ?? "");
      }
      csv += buildCsvRow(row);
    }
    csv += "\r\n";
  }

  return csv;
}

/**
 * Triggers a file download in the browser for client-side export.
 */
export function triggerBrowserCsvDownload(csv: string, filename: string): boolean {
  if (typeof document === "undefined" || typeof Blob === "undefined") {
    return false;
  }
  try {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    return true;
  } catch {
    return false;
  }
}
