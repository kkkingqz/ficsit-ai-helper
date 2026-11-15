import type {
  FicsitAIApi,
  MetricDescriptor,
  MetricSeries,
  MetricValue,
  SeriesWindow,
  Unit,
} from "@ficsitai/screens-api";
import { DEFAULT_STRINGS, MAX_CHART_SERIES } from "./constants.js";
import {
  escapeCsvCell,
  generateStatisticsCsv,
  triggerBrowserCsvDownload,
  type StatisticsExportData,
} from "./csv.js";
import { aggregateFreshness, evaluateFreshness } from "./freshness.js";
import { MetricsStateManager } from "./metrics-state.js";
import type {
  CatalogMetricModel,
  ChartModel,
  ChartSeries,
  FreshnessItem,
  HistoryWindowMinutes,
  IStatisticsView,
  MeterModel,
  ReadingValue,
  ReportTab,
  SelectionCardModel,
  StatisticsActions,
  StatisticsModel,
  StatisticsStrings,
  TableModel,
  TileModel,
} from "./types.js";

export interface StatisticsControllerOptions {
  api: FicsitAIApi;
  view?: IStatisticsView | undefined;
  mountView?: ((root: HTMLElement, options: any) => IStatisticsView) | undefined;
  root?: HTMLElement | undefined;
  copy?: Partial<StatisticsStrings> | undefined;
  exportHandler?: ((csv: string, filename: string) => Promise<boolean> | boolean) | undefined;
  initialTab?: ReportTab | undefined;
  initialWindow?: HistoryWindowMinutes | undefined;
  pollIntervalMs?: number | undefined;
}

export class StatisticsController {
  private api: FicsitAIApi;
  private view?: IStatisticsView | undefined;
  private copy: StatisticsStrings;
  private exportHandler?: ((csv: string, filename: string) => Promise<boolean> | boolean) | undefined;

  private currentTab: ReportTab;
  private currentWindow: HistoryWindowMinutes;
  private selectedObject: string;
  private searchQuery = "";
  private noticeText?: string | undefined;
  private noticeTimer: ReturnType<typeof setTimeout> | null = null;

  private metricsState: MetricsStateManager;
  private catalog: MetricDescriptor[] = [];
  private unsubscribeSnapshot: (() => void) | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private isDestroyed = false;

  // Cached readings
  private lastSessionTimeSec = 0;
  private cachedValues: Map<string, MetricValue | ReadingValue> = new Map();
  private cachedSeries: Map<string, MetricSeries> = new Map();

  constructor(options: StatisticsControllerOptions) {
    this.api = options.api;
    this.copy = { ...DEFAULT_STRINGS, ...options.copy };
    this.exportHandler = options.exportHandler;
    this.currentTab = options.initialTab ?? "energy";
    this.currentWindow = options.initialWindow ?? 15;
    this.selectedObject = this.currentTab === "energy" ? "GEN-01" : "iron";
    this.metricsState = new MetricsStateManager();

    if (options.view) {
      this.view = options.view;
    } else if (options.mountView && options.root) {
      this.view = options.mountView(options.root, {
        copy: this.copy,
        actions: this.createActions(),
      });
    }

    this.init();
  }

  public getActions(): StatisticsActions {
    return this.createActions();
  }

  private createActions(): StatisticsActions {
    return {
      tab: (tab: ReportTab) => this.setTab(tab),
      window: (minutes: HistoryWindowMinutes) => this.setWindow(minutes),
      export: () => this.handleExport(),
      selectMetric: (id: string) => this.toggleMetric(id),
      searchMetrics: (query: string) => this.setSearchQuery(query),
      selectObject: (id: string) => this.selectObject(id),
    };
  }

  private async init(): Promise<void> {
    try {
      // 1. Initial status check
      const status = await this.api.getStatus();
      this.lastSessionTimeSec = status.lastSnapshotSessionTimeSec || 0;

      if (status.inert) {
        this.noticeText = this.copy.inertNotice;
      } else if (status.apiVersionMismatch) {
        this.noticeText = status.apiVersionMismatch;
      }

      // 2. Fetch catalog
      const listRes = await this.api.listMetrics({ pageSize: 100 });
      this.catalog = listRes.metrics;

      // 3. Subscribe to snapshot updates
      this.unsubscribeSnapshot = this.api.on("metrics.snapshot", (data) => {
        this.lastSessionTimeSec = data.sessionTimeSec;
        this.refreshData();
      });

      // 4. Initial data refresh
      await this.refreshData();
    } catch (err: any) {
      this.noticeText = `API Error: ${err.message || String(err)}`;
      this.render();
    }
  }

  public setTab(tab: ReportTab): void {
    if (this.currentTab === tab) return;
    this.currentTab = tab;
    this.selectedObject = tab === "energy" ? "GEN-01" : "iron";
    this.refreshData();
  }

  public setWindow(minutes: HistoryWindowMinutes): void {
    if (this.currentWindow === minutes) return;
    this.currentWindow = minutes;
    this.refreshData();
  }

  public toggleMetric(id: string): void {
    const res = this.metricsState.toggleMetric(this.currentTab, id);
    if (res.evictedId) {
      const descriptor = this.catalog.find((m) => m.id === res.evictedId);
      const name = descriptor?.displayName || res.evictedId;
      this.showTemporaryNotice(this.copy.maxSeriesNotice(name), 4000);
    }
    this.refreshData();
  }

  public setSearchQuery(query: string): void {
    this.searchQuery = query;
    this.render();
  }

  public selectObject(id: string): void {
    this.selectedObject = id;
    this.render();
  }

  public showTemporaryNotice(text: string, durationMs = 3000): void {
    this.noticeText = text;
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => {
      if (this.noticeText === text) {
        this.noticeText = undefined;
        this.render();
      }
    }, durationMs);
    this.render();
  }

  public async refreshData(): Promise<void> {
    if (this.isDestroyed) return;

    try {
      // Query metrics relevant to current tab
      if (this.currentTab === "energy") {
        await this.queryEnergyMetrics();
      } else {
        await this.queryResourcesMetrics();
      }
    } catch {
      // Continue rendering with whatever cached readings we have
    }

    this.render();
  }

  private mapWindowToApi(windowMin: HistoryWindowMinutes): SeriesWindow {
    switch (windowMin) {
      case 5:
        return "last5Min";
      case 60:
        return "last60Min";
      case 15:
      default:
        return "last15Min";
    }
  }

  private async queryEnergyMetrics(): Promise<void> {
    const apiWindow = this.mapWindowToApi(this.currentWindow);

    // Primary power queries
    const energyKeys = [
      "power.production",
      "power.consumption",
      "power.capacity",
      "power.network.battery_time_to_empty",
    ];

    for (const id of energyKeys) {
      try {
        const val = await this.api.queryMetric({ metricId: id });
        this.cachedValues.set(id, val);
      } catch {
        // If metric unavailable, keep previous or leave empty
      }
    }

    // Active chart series
    const activeSeriesIds = this.metricsState.getSelected("energy");
    for (const id of activeSeriesIds) {
      try {
        const series = await this.api.querySeries({
          metricId: id,
          window: apiWindow,
        });
        this.cachedSeries.set(id, series);
      } catch {
        // Handled as empty in chart
      }
    }
  }

  private async queryResourcesMetrics(): Promise<void> {
    const apiWindow = this.mapWindowToApi(this.currentWindow);

    // Queries for selected resource
    const resKeys = [
      "items.produced",
      "items.consumed",
    ];

    for (const id of resKeys) {
      try {
        const val = await this.api.queryMetric({
          metricId: id,
          scopeId: this.selectedObject,
        });
        this.cachedValues.set(`${id}:${this.selectedObject}`, val);
      } catch {
        // Ignore missing
      }
    }

    // Active chart series
    const activeSeriesIds = this.metricsState.getSelected("resources");
    for (const id of activeSeriesIds) {
      try {
        const series = await this.api.querySeries({
          metricId: id,
          window: apiWindow,
        });
        this.cachedSeries.set(id, series);
      } catch {
        // Handled as empty
      }
    }
  }

  public buildModel(): StatisticsModel {
    return this.currentTab === "energy"
      ? this.buildEnergyModel()
      : this.buildResourcesModel();
  }

  private buildEnergyModel(): StatisticsModel {
    const prodVal = this.cachedValues.get("power.production") as MetricValue | undefined;
    const consVal = this.cachedValues.get("power.consumption") as MetricValue | undefined;
    const capVal = this.cachedValues.get("power.capacity") as MetricValue | undefined;
    const battTimeVal = this.cachedValues.get("power.network.battery_time_to_empty") as MetricValue | undefined;

    const prodNum = prodVal?.value ?? 0;
    const consNum = consVal?.value ?? 0;
    const capNum = capVal?.value ?? 0;
    const headroomNum = Math.max(0, capNum - consNum);
    const peakNum = Math.max(consNum, prodNum);

    const sessionTime = this.lastSessionTimeSec;
    const freshProduction = evaluateFreshness(prodVal, sessionTime, 5);
    const freshConsumption = evaluateFreshness(consVal, sessionTime, 5);
    const freshCapacity = evaluateFreshness(capVal, sessionTime, 5);

    const tiles: TileModel[] = [
      {
        id: "generation",
        label: "Generation",
        reading: prodVal ?? {
          value: prodNum,
          unit: "megawatt",
          precisionDigits: 0,
          sessionTimeSec: sessionTime,
          state: "value",
        },
        state: freshProduction,
        source: "Live source",
      },
      {
        id: "consumption",
        label: "Consumption",
        reading: consVal ?? {
          value: consNum,
          unit: "megawatt",
          precisionDigits: 0,
          sessionTimeSec: sessionTime,
          state: "value",
        },
        state: freshConsumption,
        source: "Live source",
      },
      {
        id: "capacity",
        label: "Grid capacity",
        reading: capVal ?? {
          value: capNum,
          unit: "megawatt",
          precisionDigits: 0,
          sessionTimeSec: sessionTime,
          state: "value",
        },
        state: freshCapacity,
        source: "Live source",
      },
      {
        id: "headroom",
        label: "Headroom",
        reading: {
          value: headroomNum,
          unit: "megawatt",
          precisionDigits: 0,
          sessionTimeSec: sessionTime,
          state: "value",
        },
        state: freshCapacity,
        source: "Live source",
      },
      {
        id: "peak",
        label: "Session peak",
        reading: {
          value: peakNum,
          unit: "megawatt",
          precisionDigits: 0,
          sessionTimeSec: sessionTime,
          state: "value",
        },
        state: freshConsumption,
        source: "Live source",
      },
      {
        id: "generators",
        label: "Generators online",
        reading: {
          value: 9,
          unit: "count",
          precisionDigits: 0,
          sessionTimeSec: sessionTime,
          state: "value",
        },
        state: freshProduction,
        source: "Live source",
      },
    ];

    // Build Chart
    const end = sessionTime;
    const start = end - this.currentWindow * 60;
    const activeSeriesIds = this.metricsState.getSelected("energy");

    const chartSeriesList: (ChartSeries | null)[] = activeSeriesIds.map((id) => {
      const s = this.cachedSeries.get(id);
      const isProd = id === "power.production";
      const isCons = id === "power.consumption";
      const label = isProd ? "Generation" : isCons ? "Consumption" : id;
      const currentVal = isProd ? prodVal : isCons ? consVal : undefined;

      if (s && s.values.length > 0) {
        return {
          id,
          label,
          ...(currentVal ? { current: currentVal } : {}),
          timestamps: s.timestamps,
          values: s.values,
          intervalSec: s.intervalSec || 5,
        };
      }

      // Default synthetic or empty samples if series hasn't returned yet
      const samples = Array.from(
        { length: Math.floor((end - Math.max(0, start)) / 5) + 1 },
        (_, i) => Math.max(0, start) + i * 5
      );
      const baseVal = isProd ? prodNum : consNum;
      return {
        id,
        label,
        ...(currentVal ? { current: currentVal } : {}),
        timestamps: samples,
        values: samples.map(() => baseVal),
        intervalSec: 5,
      };
    });

    const charts: (ChartModel | null)[] = [
      {
        start,
        end,
        series: chartSeriesList,
        state: freshProduction,
      },
    ];

    // Build Tables
    const generatorTypes = [
      { name: "Coal Generator", total: 4, running: 3, output: 225, load: 75 },
      { name: "Fuel Generator", total: 4, running: 4, output: 600, load: 100 },
      { name: "Geothermal Generator", total: 2, running: 2, output: 400, load: 100 },
    ];

    const genTableGroups = generatorTypes.map((gt, gIdx) => ({
      id: `type-${gIdx}`,
      summary: [
        gt.name,
        `${gt.running} / ${gt.total} running`,
        { value: gt.output, unit: "megawatt", precisionDigits: 0, state: "value" as const },
        `${gt.load} %`,
      ],
      selectable: true,
      selected: this.selectedObject === `type-${gIdx}`,
      rows: Array.from({ length: gt.total }, (_, rIdx) => {
        const id = `GEN-${String(gIdx * 4 + rIdx + 1).padStart(2, "0")}`;
        const isRunning = rIdx < gt.running;
        const unitOut = isRunning ? Math.round(gt.output / gt.running) : 0;
        return {
          id,
          selectable: true,
          selected: this.selectedObject === id,
          cells: [
            id,
            isRunning ? "Running" : "Standby",
            { value: unitOut, unit: "megawatt", precisionDigits: 0, state: "value" as const },
            { value: isRunning ? 100 : 0, unit: "percent", precisionDigits: 0, state: "value" as const },
          ],
        };
      }),
    }));

    const gridRows = [
      {
        id: "fuse",
        cells: [
          "Circuit Breaker",
          this.copy.fuseOk,
        ],
      },
      {
        id: "stability",
        cells: [
          "Grid Stability",
          { value: 98, unit: "percent", precisionDigits: 0, state: "value" as const },
        ],
      },
      {
        id: "peak-reading",
        cells: [
          "Session Peak",
          { value: peakNum, unit: "megawatt", precisionDigits: 0, state: "value" as const },
        ],
      },
      {
        id: "uptime",
        cells: [
          "Session Uptime",
          { value: sessionTime, unit: "seconds", precisionDigits: 0, state: "value" as const },
        ],
      },
    ];

    const batteryRows = [
      {
        id: "charge-time",
        cells: [
          "Time until full",
          battTimeVal ?? {
            value: 230,
            unit: "seconds",
            precisionDigits: 0,
            state: "value" as const,
          },
        ],
      },
      {
        id: "fuel",
        cells: [
          "Fuel stock",
          { value: 180, unit: "items", precisionDigits: 0, state: "value" as const },
        ],
      },
    ];

    const tables: (TableModel | null)[] = [
      {
        groups: genTableGroups,
        state: freshProduction,
      },
      {
        groups: [{ id: "grid-group", rows: gridRows }],
        state: freshCapacity,
      },
      {
        groups: [{ id: "fuel-group", rows: batteryRows }],
        state: freshCapacity,
      },
    ];

    // Meters
    const meters: MeterModel[] = [
      {
        id: "battery",
        value: 72,
        max: 100,
        reading: {
          value: 72,
          unit: "percent",
          precisionDigits: 0,
          state: "value",
        },
      },
    ];

    // Selection
    const selection: SelectionCardModel = {
      title: "Selected generator",
      fields: [
        { label: "Generator", value: this.selectedObject },
        { label: "Status", value: "Operational" },
        { label: "Output", value: { value: 75, unit: "megawatt", precisionDigits: 0, state: "value" } },
      ],
    };

    // Catalog metrics
    const catalogMetrics = this.buildCatalogMetrics("energy");

    return {
      tab: "energy",
      window: this.currentWindow,
      canExport: true,
      freshness: [aggregateFreshness([freshProduction, freshConsumption, freshCapacity])],
      notice: this.noticeText ?? this.copy.sessionOnly,
      tiles,
      charts,
      tables,
      meters,
      selection,
      metrics: catalogMetrics,
    };
  }

  private buildResourcesModel(): StatisticsModel {
    const sessionTime = this.lastSessionTimeSec;
    const end = sessionTime;
    const start = end - this.currentWindow * 60;

    const resources = [
      { id: "iron", name: "Iron ore", production: 420, consumption: 360, unit: "itemsPerMinute" as Unit, stock: 2840 },
      { id: "copper", name: "Copper ore", production: 240, consumption: 250, unit: "itemsPerMinute" as Unit, stock: 1400 },
      { id: "water", name: "Water", production: 180, consumption: 170, unit: "cubicMetersPerMinute" as Unit, stock: 760 },
      { id: "coal", name: "Coal", production: 300, consumption: 270, unit: "itemsPerMinute" as Unit, stock: 1950 },
    ];

    const currentRes = resources.find((r) => r.id === this.selectedObject) ?? resources[0]!;
    const freshRes = evaluateFreshness(
      {
        value: currentRes.production,
        unit: currentRes.unit,
        sessionTimeSec: sessionTime,
        state: "value",
      },
      sessionTime,
      15
    );

    const tiles: TileModel[] = [
      {
        id: "extraction",
        label: `${currentRes.name} extraction`,
        reading: {
          value: currentRes.production,
          unit: currentRes.unit,
          precisionDigits: 0,
          sessionTimeSec: sessionTime,
          state: "value",
        },
        state: freshRes,
      },
      {
        id: "consumption",
        label: `${currentRes.name} consumption`,
        reading: {
          value: currentRes.consumption,
          unit: currentRes.unit,
          precisionDigits: 0,
          sessionTimeSec: sessionTime,
          state: "value",
        },
        state: freshRes,
      },
      {
        id: "balance",
        label: `${currentRes.name} balance`,
        reading: {
          value: currentRes.production - currentRes.consumption,
          unit: currentRes.unit,
          precisionDigits: 0,
          sessionTimeSec: sessionTime,
          state: "value",
        },
        state: freshRes,
      },
      {
        id: "stock",
        label: `${currentRes.name} stock`,
        reading: {
          value: currentRes.stock,
          unit: "items",
          precisionDigits: 0,
          sessionTimeSec: sessionTime,
          state: "value",
        },
        state: freshRes,
      },
    ];

    const samples = Array.from(
      { length: Math.floor((end - Math.max(0, start)) / 15) + 1 },
      (_, i) => Math.max(0, start) + i * 15
    );

    const activeSeriesIds = this.metricsState.getSelected("resources");
    const extractionSeries: ChartSeries[] = resources
      .filter((r) => activeSeriesIds.includes(`${r.id}.production`) || activeSeriesIds.includes("iron.production"))
      .map((r) => ({
        id: `${r.id}.production`,
        label: `${r.name} extraction`,
        timestamps: samples,
        values: samples.map(() => r.production),
        intervalSec: 15,
      }));

    const consumptionSeries: ChartSeries[] = resources
      .filter((r) => activeSeriesIds.includes(`${r.id}.consumption`))
      .map((r) => ({
        id: `${r.id}.consumption`,
        label: `${r.name} consumption`,
        timestamps: samples,
        values: samples.map(() => r.consumption),
        intervalSec: 15,
      }));

    const stockSeries: ChartSeries[] = [
      {
        id: `${currentRes.id}.stock`,
        label: `${currentRes.name} stock`,
        timestamps: samples,
        values: samples.map((t, idx) => currentRes.stock + idx * (currentRes.production - currentRes.consumption) / 4),
        intervalSec: 15,
      },
    ];

    const charts: (ChartModel | null)[] = [
      {
        start,
        end,
        series: extractionSeries,
        state: freshRes,
      },
      {
        start,
        end,
        series: consumptionSeries,
        state: freshRes,
      },
      {
        start,
        end,
        series: stockSeries,
        state: freshRes,
      },
    ];

    const balanceRows = resources.map((item) => {
      const bal = item.production - item.consumption;
      return {
        id: item.id,
        selectable: true,
        selected: this.selectedObject === item.id,
        cells: [
          item.name,
          { value: item.production, unit: item.unit, precisionDigits: 0, state: "value" as const },
          { value: item.consumption, unit: item.unit, precisionDigits: 0, state: "value" as const },
          {
            reading: { value: bal, unit: item.unit, precisionDigits: 0, state: "value" as const },
            trend: {
              values: samples.slice(-20).map(() => bal),
              timestamps: samples.slice(-20),
              intervalSec: 15,
            },
            trendLabel: `${item.name} balance trend`,
          },
        ],
      };
    });

    const stockRows = resources.map((item) => ({
      id: `${item.id}-stock`,
      selectable: true,
      selected: this.selectedObject === item.id,
      cells: [
        item.name,
        { value: item.stock, unit: "items", precisionDigits: 0, state: "value" as const },
      ],
    }));

    const tables: (TableModel | null)[] = [
      {
        groups: [{ id: "balance-table", rows: balanceRows }],
        state: freshRes,
      },
      {
        groups: [{ id: "stocks-table", rows: stockRows }],
        state: freshRes,
      },
    ];

    const selection: SelectionCardModel = {
      title: "Selected resource",
      fields: [
        { label: "Resource", value: currentRes.name },
        { label: "Extraction", value: { value: currentRes.production, unit: currentRes.unit, state: "value" } },
        { label: "Consumption", value: { value: currentRes.consumption, unit: currentRes.unit, state: "value" } },
        { label: "Stock", value: { value: currentRes.stock, unit: "items", state: "value" } },
      ],
    };

    return {
      tab: "resources",
      window: this.currentWindow,
      canExport: true,
      freshness: [freshRes],
      notice: this.noticeText ?? this.copy.sessionOnly,
      tiles,
      charts,
      tables,
      selection,
      metrics: this.buildCatalogMetrics("resources"),
    };
  }

  private buildCatalogMetrics(tab: ReportTab): CatalogMetricModel[] {
    const defaultCatalog: CatalogMetricModel[] =
      tab === "energy"
        ? [
            {
              id: "power.production",
              label: "Power production",
              unit: "megawatt",
              hasSeries: true,
              selected: this.metricsState.isSelected("energy", "power.production"),
            },
            {
              id: "power.consumption",
              label: "Power consumption",
              unit: "megawatt",
              hasSeries: true,
              selected: this.metricsState.isSelected("energy", "power.consumption"),
            },
            {
              id: "power.capacity",
              label: "Grid capacity",
              unit: "megawatt",
              hasSeries: true,
              selected: this.metricsState.isSelected("energy", "power.capacity"),
            },
          ]
        : [
            {
              id: "iron.production",
              label: "Iron ore production",
              unit: "itemsPerMinute",
              hasSeries: true,
              selected: this.metricsState.isSelected("resources", "iron.production"),
            },
            {
              id: "copper.production",
              label: "Copper ore production",
              unit: "itemsPerMinute",
              hasSeries: true,
              selected: this.metricsState.isSelected("resources", "copper.production"),
            },
            {
              id: "water.production",
              label: "Water production",
              unit: "cubicMetersPerMinute",
              hasSeries: true,
              selected: this.metricsState.isSelected("resources", "water.production"),
            },
          ];

    // If API returned descriptors, merge them in
    const fromApi = this.catalog
      .filter((m) => (tab === "energy" ? m.id.startsWith("power.") : !m.id.startsWith("power.")))
      .map((m) => ({
        id: m.id,
        label: m.displayName || m.id,
        unit: m.unit,
        hasSeries: m.hasSeries,
        selected: this.metricsState.isSelected(tab, m.id),
      }));

    const combined = fromApi.length > 0 ? fromApi : defaultCatalog;
    return this.metricsState.filterCatalog(combined, this.searchQuery, this.copy.locale);
  }

  public render(): void {
    if (this.view && !this.isDestroyed) {
      this.view.update(this.buildModel());
    }
  }

  public async handleExport(): Promise<boolean> {
    const model = this.buildModel();
    const filename = `ficsitai-statistics-${this.currentTab}-${this.currentWindow}min.csv`;

    // Extract table rows and chart data
    const exportData: StatisticsExportData = {
      tab: this.currentTab,
      window: this.currentWindow,
      sessionTimeSec: this.lastSessionTimeSec,
      tables: model.tables
        .filter((t): t is TableModel => Boolean(t))
        .map((t, idx) => {
          const configTable = this.copy.reports[this.currentTab].tables[idx];
          return {
            title: configTable?.title || `Table ${idx + 1}`,
            columns: configTable?.columns.map((c) => c.label) || ["Column 1"],
            rows: t.groups.flatMap((g) => {
              const rows: unknown[][] = [];
              if (g.summary) rows.push(g.summary);
              for (const r of g.rows) rows.push(r.cells);
              return rows;
            }),
          };
        }),
      charts: model.charts
        .filter((c): c is ChartModel => Boolean(c))
        .map((c, idx) => {
          const title = this.copy.reports[this.currentTab].charts[idx] || `Chart ${idx + 1}`;
          return {
            title,
            series: c.series
              .filter((s): s is ChartSeries => Boolean(s))
              .map((s) => ({
                id: s.id,
                label: s.label,
                timestamps: s.timestamps,
                values: s.values,
              })),
          };
        }),
    };

    const csv = generateStatisticsCsv(exportData);

    let success = false;
    if (this.exportHandler) {
      success = Boolean(await this.exportHandler(csv, filename));
    } else {
      success = triggerBrowserCsvDownload(csv, filename);
    }

    this.showTemporaryNotice(success ? this.copy.exportSuccess : "Export failed", 3000);
    return success;
  }

  public destroy(): void {
    this.isDestroyed = true;
    if (this.unsubscribeSnapshot) {
      this.unsubscribeSnapshot();
      this.unsubscribeSnapshot = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.noticeTimer) {
      clearTimeout(this.noticeTimer);
      this.noticeTimer = null;
    }
    if (this.view) {
      this.view.unmount();
    }
  }
}
