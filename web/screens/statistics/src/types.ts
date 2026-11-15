import type {
  ApiStatus,
  MetricDescriptor,
  MetricSeries,
  MetricValue,
  SeriesWindow,
  Unit,
} from "@ficsitai/screens-api";

export type ReportTab = "energy" | "resources";
export type HistoryWindowMinutes = 5 | 15 | 60;
export type FreshnessKind = "fresh" | "stale" | "loading" | "empty" | "error";

export interface FreshnessItem {
  label: string;
  kind: FreshnessKind;
  detail?: string | undefined;
}

export interface ReadingValue {
  value: number | null;
  unit: Unit | string;
  precisionDigits?: number | undefined;
  sessionTimeSec?: number | undefined;
  state: "value" | "notApplicable";
}

export interface TileModel {
  id: string;
  label: string;
  reading: MetricValue | ReadingValue;
  state: FreshnessItem;
  source?: string | undefined;
}

export interface ChartSeries {
  id: string;
  label: string;
  current?: MetricValue | ReadingValue | undefined;
  timestamps: number[];
  values: (number | null)[];
  intervalSec: number;
}

export interface ChartModel {
  start: number;
  end: number;
  series: (ChartSeries | null | false)[];
  state: FreshnessItem;
}

export interface TrendCell {
  reading: MetricValue | ReadingValue;
  trend: {
    values: (number | null)[];
    timestamps: number[];
    intervalSec: number;
  };
  trendLabel?: string | undefined;
}

export type TableCell =
  | string
  | number
  | MetricValue
  | ReadingValue
  | TrendCell
  | null
  | undefined;

export interface TableRow {
  id: string;
  cells: TableCell[];
  selectable?: boolean | undefined;
  selected?: boolean | undefined;
}

export interface TableGroup {
  id: string;
  summary?: TableCell[] | undefined;
  rows: TableRow[];
  selectable?: boolean | undefined;
  selected?: boolean | undefined;
}

export interface TableModel {
  groups: TableGroup[];
  state: FreshnessItem;
}

export interface MeterModel {
  id: string;
  value: number;
  max: number;
  reading: MetricValue | ReadingValue;
}

export interface SelectionField {
  label: string;
  value: string | MetricValue | ReadingValue;
}

export interface SelectionCardModel {
  title: string;
  fields: SelectionField[];
}

export interface CatalogMetricModel {
  id: string;
  label: string;
  unit: Unit | string;
  hasSeries: boolean;
  selected: boolean;
  matches?: boolean | undefined;
}

export interface StatisticsModel {
  tab: ReportTab;
  window: HistoryWindowMinutes;
  canExport: boolean;
  freshness: FreshnessItem[];
  notice?: string | undefined;
  tiles: TileModel[];
  charts: (ChartModel | null)[];
  tables: (TableModel | null)[];
  meters?: MeterModel[] | undefined;
  selection?: SelectionCardModel | null | undefined;
  metrics: CatalogMetricModel[];
}

export interface StatisticsActions {
  tab(tab: ReportTab): void;
  window(minutes: HistoryWindowMinutes): void;
  export(): void;
  selectMetric(id: string): void;
  searchMetrics?(query: string): void;
  selectObject(id: string): void;
}

export interface IStatisticsView {
  update(model: StatisticsModel): void;
  handleExportAction?(): boolean;
  unmount(): void;
}

export interface StatisticsStrings {
  locale: string;
  tabLabel: string;
  windowLabel: string;
  export: string;
  reports: {
    energy: {
      label: string;
      charts: string[];
      meters: Record<string, string>;
      tables: Array<{
        title: string;
        columns: Array<{ label: string; numeric: boolean }>;
      }>;
    };
    resources: {
      label: string;
      charts: string[];
      meters?: Record<string, string>;
      tables: Array<{
        title: string;
        columns: Array<{ label: string; numeric: boolean }>;
      }>;
    };
  };
  window(minutes: number): string;
  time(seconds: number): string;
  sessionOnly: string;
  noValue: string;
  metrics: string;
  metricSearch: string;
  noMatches: string;
  fuseOk: string;
  fuseTripped: string;
  batteryBalanceNotice: string;
  inertNotice: string;
  offlineTelemetryNotice: string;
  maxSeriesNotice(evicted: string): string;
  exportSuccess: string;
  exportEmpty: string;
}
