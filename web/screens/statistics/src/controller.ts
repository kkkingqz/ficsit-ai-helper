import type {
  ApiStatus,
  FicsitAIApi,
  MetricDescriptor,
  MetricSeries,
  MetricValue,
  ScopeRef,
  SeriesWindow,
  Unit,
} from "@ficsitai/screens-api";
import { DEFAULT_STRINGS, MAX_CHART_SERIES } from "./constants.js";
import { generateStatisticsCsv, triggerBrowserCsvDownload } from "./csv.js";
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
  TableGroup,
  TableModel,
  TableRow,
  TileModel,
} from "./types.js";

export interface StatisticsControllerOptions {
  api: FicsitAIApi;
  view?: IStatisticsView | undefined;
  root?: HTMLElement | undefined;
  copy?: Partial<StatisticsStrings> | undefined;
  exportHandler?: ((csv: string, filename: string) => Promise<boolean> | boolean) | undefined;
  initialTab?: ReportTab | undefined;
  initialWindow?: HistoryWindowMinutes | undefined;
  pollIntervalMs?: number | undefined;
}

export class StatisticsController implements StatisticsActions {
  private api: FicsitAIApi;
  private view?: IStatisticsView | undefined;
  private copy: StatisticsStrings;
  private exportHandler?: ((csv: string, filename: string) => Promise<boolean> | boolean) | undefined;

  private currentTab: ReportTab = "energy";
  private currentWindow: HistoryWindowMinutes = 15;
  private selectedObject = "Desc_OreIron_C";
  private searchQuery = "";
  private noticeText: string | null = null;
  private noticeTimer: ReturnType<typeof setTimeout> | null = null;

  private metricsState: MetricsStateManager;
  private catalog: MetricDescriptor[] = [];
  private resourceScopes: ScopeRef[] = [];
  private generatorScopes: ScopeRef[] = [];
  private unsubscribeSnapshot: (() => void) | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private isDestroyed = false;

  // Concurrency & snapshot handling
  private isRefreshing = false;
  private pendingRefresh = false;
  private pendingChangedIds: Set<string> = new Set();

  // Cached readings
  private lastSessionTimeSec = 0;
  private sessionPeak: number | null = null;
  private hasWindowIncomplete = false;
  private cachedValues: Map<string, MetricValue | ReadingValue> = new Map();
  private cachedSeries: Map<string, MetricSeries> = new Map();
  private apiStatus: ApiStatus | null = null;
  public readonly initPromise: Promise<void>;

  public constructor(options: StatisticsControllerOptions) {
    this.api = options.api;
    this.view = options.view;
    this.copy = { ...DEFAULT_STRINGS, ...(options.copy || {}) };
    this.exportHandler = options.exportHandler;

    if (options.initialTab) {
      this.currentTab = options.initialTab;
    }
    if (options.initialWindow) {
      this.currentWindow = options.initialWindow;
    }

    this.metricsState = new MetricsStateManager();

    if (options.pollIntervalMs && options.pollIntervalMs > 0) {
      this.pollTimer = setInterval(() => {
        void this.refreshData();
      }, options.pollIntervalMs);
    }

    this.initPromise = this.init();
  }

  public async init(): Promise<void> {
    if (this.isDestroyed) return;

    try {
      this.apiStatus = await this.api.getStatus();
      this.lastSessionTimeSec = this.apiStatus.lastSnapshotSessionTimeSec || 0;
    } catch {
      // Ignored if offline
    }

    if (this.isDestroyed) return;

    await this.initCatalog();

    if (this.isDestroyed) return;

    // Load initial telemetry
    await this.refreshData();

    if (this.isDestroyed) return;

    // Subscribe to telemetry snapshots
    this.unsubscribeSnapshot = this.api.on("metrics.snapshot", (data) => {
      if (this.isDestroyed) return;
      this.lastSessionTimeSec = data.sessionTimeSec;
      void this.refreshData(data.changedMetricIds);
    });

    if (this.isDestroyed) {
      if (this.unsubscribeSnapshot) {
        this.unsubscribeSnapshot();
        this.unsubscribeSnapshot = null;
      }
      return;
    }

    this.render();
  }

  private async initCatalog(): Promise<void> {
    const allMetrics: MetricDescriptor[] = [];
    let cursor: string | undefined = undefined;

    do {
      if (this.isDestroyed) return;
      try {
        const res = await this.api.listMetrics({
          ...(cursor ? { cursor } : {}),
          pageSize: 50,
        });
        allMetrics.push(...res.metrics);
        cursor = res.nextCursor || undefined;
      } catch {
        break;
      }
    } while (cursor);

    this.catalog = allMetrics;

    // Discover resource scopes for items
    try {
      const scopesRes = await this.api.listScopes({ metricId: "items.produced" });
      this.resourceScopes = scopesRes.scopes;
      if (this.resourceScopes.length > 0 && this.resourceScopes[0]) {
        this.selectedObject = this.resourceScopes[0].scopeId;
      }
    } catch {
      this.resourceScopes = [];
    }

    // Discover generator scopes (machineType)
    try {
      const genScopesRes = await this.api.listScopes({ metricId: "generators.total" });
      this.generatorScopes = genScopesRes.scopes;
    } catch {
      this.generatorScopes = [];
    }
  }

  public setView(view: IStatisticsView): void {
    this.view = view;
    this.render();
  }

  public getModel(): StatisticsModel {
    return this.buildModel();
  }

  public getActions(): StatisticsActions {
    return {
      tab: (tab: ReportTab) => this.tab(tab),
      window: (minutes: HistoryWindowMinutes) => this.window(minutes),
      export: () => this.export(),
      selectMetric: (id: string) => this.selectMetric(id),
      searchMetrics: (query: string) => this.searchMetrics(query),
      selectObject: (id: string) => this.selectObject(id),
    };
  }

  // --- StatisticsActions implementation & compatibility aliases ---

  public setTab(newTab: ReportTab): void {
    this.tab(newTab);
  }

  public setWindow(minutes: HistoryWindowMinutes): void {
    this.window(minutes);
  }

  public toggleMetric(id: string): void {
    this.selectMetric(id);
  }

  public tab(newTab: ReportTab): void {
    if (this.currentTab === newTab) return;
    this.currentTab = newTab;
    void this.refreshData();
    this.render();
  }

  public window(minutes: HistoryWindowMinutes): void {
    if (this.currentWindow === minutes) return;
    this.currentWindow = minutes;
    void this.refreshData();
    this.render();
  }

  public selectMetric(id: string): void {
    const result = this.metricsState.toggleMetric(this.currentTab, id);
    if (result.evictedId) {
      this.showNotice(this.copy.maxSeriesNotice(result.evictedId));
    }
    void this.refreshData([id]);
    this.render();
  }

  public searchMetrics(query: string): void {
    this.searchQuery = query;
    this.render();
  }

  public selectObject(id: string): void {
    if (this.selectedObject === id) return;
    this.selectedObject = id;
    void this.refreshData();
    this.render();
  }

  public async handleExport(): Promise<boolean> {
    const model = this.buildModel();
    const exportData = {
      tab: this.currentTab,
      window: this.currentWindow,
      sessionTimeSec: this.lastSessionTimeSec,
      tables: model.tables
        .filter((t): t is TableModel => Boolean(t))
        .map((t, idx) => ({
          title: this.copy.reports[this.currentTab].tables[idx]?.title ?? `Table ${idx + 1}`,
          source: t.state?.label,
          columns: (this.copy.reports[this.currentTab].tables[idx]?.columns ?? []).map((c) => c.label),
          rows: t.groups.flatMap((g) => {
            const rows: unknown[][] = [];
            if (g.summary) rows.push(g.summary);
            for (const r of g.rows) rows.push(r.cells);
            return rows;
          }),
        })),
      charts: model.charts
        .filter((c): c is ChartModel => Boolean(c))
        .map((c, idx) => ({
          title: this.copy.reports[this.currentTab].charts[idx] ?? `Chart ${idx + 1}`,
          series: c.series
            .filter((s): s is ChartSeries => Boolean(s))
            .map((s) => ({
              id: s.id,
              label: s.label,
              timestamps: s.timestamps,
              values: s.values,
            })),
        })),
    };

    const csvContent = generateStatisticsCsv(exportData);
    const filename = `ficsitai-statistics-${this.currentTab}-${this.currentWindow}min.csv`;

    let success = false;
    if (this.exportHandler) {
      success = Boolean(await this.exportHandler(csvContent, filename));
    } else {
      success = triggerBrowserCsvDownload(csvContent, filename);
    }

    this.showNotice(this.copy.exportSuccess);
    return success;
  }

  public export(): void {
    void this.handleExport();
  }

  // --- Telemetry refresh ---

  private async refreshData(changedMetricIds?: string[]): Promise<void> {
    if (this.isDestroyed) return;

    if (this.isRefreshing) {
      this.pendingRefresh = true;
      if (changedMetricIds) {
        for (const id of changedMetricIds) {
          this.pendingChangedIds.add(id);
        }
      }
      return;
    }

    this.isRefreshing = true;

    try {
      if (this.currentTab === "energy") {
        await this.queryEnergyMetrics(changedMetricIds);
      } else {
        await this.queryResourcesMetrics(changedMetricIds);
      }
    } finally {
      this.isRefreshing = false;
      if (this.pendingRefresh && !this.isDestroyed) {
        this.pendingRefresh = false;
        const bufferedIds = this.pendingChangedIds.size > 0
          ? Array.from(this.pendingChangedIds)
          : undefined;
        this.pendingChangedIds.clear();
        void this.refreshData(bufferedIds);
      }
    }

    if (!this.isDestroyed) {
      this.render();
    }
  }

  private mapWindowToApi(window: HistoryWindowMinutes): SeriesWindow {
    switch (window) {
      case 5:
        return "last5Min";
      case 60:
        return "last60Min";
      case 15:
      default:
        return "last15Min";
    }
  }

  private async queryEnergyMetrics(changedMetricIds?: string[]): Promise<void> {
    const apiWindow = this.mapWindowToApi(this.currentWindow);
    const filterActive = changedMetricIds && changedMetricIds.length > 0;

    const energyKeys = [
      "power.production",
      "power.consumption",
      "power.capacity",
      "power.network.battery_time_to_empty",
      "power.network.battery_charge",
      "power.network.fuse_tripped",
      "generators.running",
      "generators.total",
    ];

    const keysToQuery = filterActive
      ? energyKeys.filter((k) => changedMetricIds.includes(k))
      : energyKeys;

    // Concurrently query available metric values
    const queryPromises = keysToQuery.map(async (id) => {
      if (this.catalog.length > 0 && !this.catalog.some((m) => m.id === id)) {
        return;
      }
      try {
        const val = await this.api.queryMetric({ metricId: id });
        this.cachedValues.set(id, val);
      } catch {
        // Missing metric is handled gracefully
      }
    });

    // Active chart series
    const activeSeriesIds = this.metricsState.getSelected("energy");
    const seriesPromises = activeSeriesIds.map(async (id) => {
      try {
        const series = await this.api.querySeries({
          metricId: id,
          window: apiWindow,
        });
        this.cachedSeries.set(id, series);
        if (series.windowIncomplete) {
          this.hasWindowIncomplete = true;
        }
      } catch {
        // Missing series handled as empty
      }
    });

    // Query generator type metrics if generator scopes exist
    const genPromises = this.generatorScopes.map(async (scope) => {
      try {
        const [totalVal, runningVal, prodVal] = await Promise.all([
          this.api.queryMetric({ metricId: "generators.total", scopeId: scope.scopeId }).catch(() => undefined),
          this.api.queryMetric({ metricId: "generators.running", scopeId: scope.scopeId }).catch(() => undefined),
          this.api.queryMetric({ metricId: "generators.production", scopeId: scope.scopeId }).catch(() => undefined),
        ]);
        if (totalVal) this.cachedValues.set(`generators.total:${scope.scopeId}`, totalVal);
        if (runningVal) this.cachedValues.set(`generators.running:${scope.scopeId}`, runningVal);
        if (prodVal) this.cachedValues.set(`generators.production:${scope.scopeId}`, prodVal);
      } catch {
        // Handled gracefully
      }
    });

    await Promise.all([...queryPromises, ...seriesPromises, ...genPromises]);
  }

  private async queryResourcesMetrics(changedMetricIds?: string[]): Promise<void> {
    const apiWindow = this.mapWindowToApi(this.currentWindow);
    const scopeId = this.selectedObject;

    const resKeys = [
      "items.produced",
      "items.consumed",
      "items.balance",
    ];

    const queryPromises = resKeys.map(async (id) => {
      try {
        const val = await this.api.queryMetric({
          metricId: id,
          ...(scopeId ? { scopeId } : {}),
        });
        this.cachedValues.set(`${id}:${scopeId}`, val);
        this.cachedValues.set(id, val);
      } catch {
        // Handled as empty
      }
    });

    // Also populate batch table data for top resource scopes if available
    const tableScopePromises = this.resourceScopes.slice(0, 8).map(async (scope) => {
      try {
        const [prod, cons] = await Promise.all([
          this.api.queryMetric({ metricId: "items.produced", scopeId: scope.scopeId }),
          this.api.queryMetric({ metricId: "items.consumed", scopeId: scope.scopeId }),
        ]);
        this.cachedValues.set(`items.produced:${scope.scopeId}`, prod);
        this.cachedValues.set(`items.consumed:${scope.scopeId}`, cons);
      } catch {
        // Ignore scope errors
      }
    });

    // Active chart series
    const activeSeriesIds = this.metricsState.getSelected("resources");
    const activeMetricPromises = activeSeriesIds.map(async (id) => {
      try {
        const val = await this.api.queryMetric({
          metricId: id,
          ...(scopeId ? { scopeId } : {}),
        });
        this.cachedValues.set(`${id}:${scopeId}`, val);
        this.cachedValues.set(id, val);
      } catch {
        // Handled as empty
      }
    });

    const seriesPromises = activeSeriesIds.map(async (id) => {
      try {
        const series = await this.api.querySeries({
          metricId: id,
          ...(scopeId ? { scopeId } : {}),
          window: apiWindow,
        });
        this.cachedSeries.set(`${id}:${scopeId}`, series);
        this.cachedSeries.set(id, series);
        if (series.windowIncomplete) {
          this.hasWindowIncomplete = true;
        }
      } catch {
        // Handled as empty
      }
    });

    await Promise.all([...queryPromises, ...activeMetricPromises, ...tableScopePromises, ...seriesPromises]);
  }

  // --- Model building ---

  private formatSource(v: MetricValue | ReadingValue | undefined, isDerived = false): string | undefined {
    if (isDerived) return this.copy.derivedSource;
    if (!v) return undefined;
    if ("source" in v && v.source) {
      switch (v.source) {
        case "live":
          return this.copy.liveSource;
        case "save":
          return this.copy.saveSource ?? "Save file";
        case "saveEstimated":
          return this.copy.saveEstimatedSource ?? "Save estimated";
        case "recorded":
          return this.copy.recordedSource ?? "Recorded session";
        case "planned":
          return this.copy.plannedSource ?? "Plan estimate";
        case "fixture":
          return this.copy.fixtureSource;
        default:
          return (v as any).source;
      }
    }
    return undefined;
  }

  public buildModel(): StatisticsModel {
    return this.currentTab === "energy"
      ? this.buildEnergyModel()
      : this.buildResourcesModel();
  }

  private getSampleInterval(metricId: string): number {
    return this.catalog.find((m) => m.id === metricId)?.sampleIntervalSec ?? 5;
  }

  private buildEnergyModel(): StatisticsModel {
    const prodVal = this.cachedValues.get("power.production") as MetricValue | undefined;
    const consVal = this.cachedValues.get("power.consumption") as MetricValue | undefined;
    const capVal = (this.cachedValues.get("power.capacity") ||
      this.cachedValues.get("power.network.capacity")) as MetricValue | undefined;
    const battTimeVal = this.cachedValues.get("power.network.battery_time_to_empty") as MetricValue | undefined;
    const battChargeVal = this.cachedValues.get("power.network.battery_charge") as MetricValue | undefined;
    const fuseVal = this.cachedValues.get("power.network.fuse_tripped") as MetricValue | undefined;
    const genVal = this.cachedValues.get("generators.running") as MetricValue | undefined;

    const sessionTime = this.lastSessionTimeSec;
    const freshProduction = evaluateFreshness(prodVal, sessionTime, this.getSampleInterval("power.production"));
    const freshConsumption = evaluateFreshness(consVal, sessionTime, this.getSampleInterval("power.consumption"));
    const freshCapacity = evaluateFreshness(capVal, sessionTime, this.getSampleInterval("power.capacity"));

    // Headroom (capacity - consumption)
    let headroomReading: ReadingValue;
    if (
      !capVal ||
      capVal.value === null ||
      capVal.state === "notApplicable" ||
      !consVal ||
      consVal.value === null ||
      consVal.state === "notApplicable"
    ) {
      headroomReading = {
        value: null,
        unit: "megawatt",
        precisionDigits: 0,
        sessionTimeSec: sessionTime,
        state: "notApplicable",
      };
    } else {
      headroomReading = {
        value: Math.max(0, capVal.value - consVal.value),
        unit: "megawatt",
        precisionDigits: 0,
        sessionTimeSec: sessionTime,
        state: "value",
      };
    }

    // Session Peak
    if (consVal && consVal.value !== null && consVal.state === "value") {
      this.sessionPeak = Math.max(this.sessionPeak ?? 0, consVal.value);
    }
    const peakReading: ReadingValue =
      this.sessionPeak !== null
        ? {
            value: this.sessionPeak,
            unit: "megawatt",
            precisionDigits: 0,
            sessionTimeSec: sessionTime,
            state: "value",
          }
        : {
            value: null,
            unit: "megawatt",
            precisionDigits: 0,
            sessionTimeSec: sessionTime,
            state: "notApplicable",
          };

    let totalRunningGenerators = 0;
    let anyGenValue: MetricValue | undefined;
    let applicableRunningScopes = 0;
    let hasInapplicableRunning = false;

    for (const scope of this.generatorScopes) {
      const runningVal = this.cachedValues.get(`generators.running:${scope.scopeId}`) as MetricValue | undefined;
      const totalVal = this.cachedValues.get(`generators.total:${scope.scopeId}`) as MetricValue | undefined;
      const prodVal = this.cachedValues.get(`generators.production:${scope.scopeId}`) as MetricValue | undefined;
      if (!anyGenValue) {
        anyGenValue = prodVal ?? runningVal ?? totalVal;
      }
      if (runningVal && runningVal.state === "value" && runningVal.value !== null) {
        totalRunningGenerators += runningVal.value;
        applicableRunningScopes++;
      } else {
        hasInapplicableRunning = true;
      }
    }

    let genReading: MetricValue | ReadingValue;
    let genTileFreshness: FreshnessItem;
    if (this.generatorScopes.length > 0 && !hasInapplicableRunning && applicableRunningScopes > 0 && anyGenValue) {
      genReading = {
        kind: "value",
        metricId: "generators.running",
        scopeId: "",
        unit: "count",
        precisionDigits: 0,
        sessionTimeSec: anyGenValue.sessionTimeSec,
        state: "value",
        value: totalRunningGenerators,
        source: anyGenValue.source,
      };
      genTileFreshness = evaluateFreshness(anyGenValue, sessionTime, 10);
    } else if (this.generatorScopes.length === 0 && genVal && genVal.value !== null && genVal.state === "value") {
      genReading = genVal;
      genTileFreshness = evaluateFreshness(genVal, sessionTime, 10);
    } else {
      genReading = {
        value: null,
        unit: "count",
        precisionDigits: 0,
        sessionTimeSec: anyGenValue?.sessionTimeSec ?? sessionTime,
        state: "notApplicable",
      };
      genTileFreshness = { kind: "empty", label: "NO DATA" };
    }

    const tiles: TileModel[] = [
      {
        id: "generation",
        label: this.copy.generationLabel,
        reading: prodVal ?? {
          value: null,
          unit: "megawatt",
          precisionDigits: 0,
          sessionTimeSec: sessionTime,
          state: "notApplicable",
        },
        state: freshProduction,
        source: this.formatSource(prodVal),
      },
      {
        id: "consumption",
        label: this.copy.consumptionLabel,
        reading: consVal ?? {
          value: null,
          unit: "megawatt",
          precisionDigits: 0,
          sessionTimeSec: sessionTime,
          state: "notApplicable",
        },
        state: freshConsumption,
        source: this.formatSource(consVal),
      },
      {
        id: "capacity",
        label: this.copy.capacityLabel,
        reading: capVal ?? {
          value: null,
          unit: "megawatt",
          precisionDigits: 0,
          sessionTimeSec: sessionTime,
          state: "notApplicable",
        },
        state: freshCapacity,
        source: this.formatSource(capVal),
      },
      {
        id: "headroom",
        label: this.copy.headroomLabel,
        reading: headroomReading,
        state: freshCapacity,
        source: this.formatSource(headroomReading, true),
      },
      {
        id: "peak",
        label: this.copy.sessionPeakLabel,
        reading: peakReading,
        state: freshConsumption,
        source: this.formatSource(peakReading, true),
      },
      {
        id: "generators",
        label: this.copy.generatorsOnlineLabel,
        reading: genReading,
        state: genTileFreshness,
        source: this.formatSource(genReading),
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
      const label = isProd
        ? this.copy.generationLabel
        : isCons
        ? this.copy.consumptionLabel
        : (this.catalog.find((m) => m.id === id)?.displayName ?? id);
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

      // DO NOT synthesize flat lines — empty series remains empty!
      return {
        id,
        label,
        ...(currentVal ? { current: currentVal } : {}),
        timestamps: [],
        values: [],
        intervalSec: 5,
      };
    });

    const hasAnyPoints = chartSeriesList.some((s) => s && s.values.length > 0);
    const charts: (ChartModel | null)[] = [
      {
        start,
        end,
        series: chartSeriesList,
        state: hasAnyPoints ? freshProduction : { kind: "empty", label: "NO DATA" },
      },
    ];

    // Build Tables
    const isFuseTripped = fuseVal && fuseVal.value !== null && fuseVal.value > 0;
    const gridRows: TableRow[] = [
      {
        id: "fuse",
        cells: [
          "Circuit Breaker",
          isFuseTripped ? this.copy.fuseTripped : this.copy.fuseOk,
        ],
      },
      {
        id: "peak-reading",
        cells: [
          this.copy.sessionPeakLabel,
          peakReading,
        ],
      },
      {
        id: "uptime",
        cells: [
          "Session Uptime",
          { value: sessionTime, unit: "seconds", precisionDigits: 0, state: "value" },
        ],
      },
    ];

    const batteryRows: TableRow[] = [
      {
        id: "charge-time",
        cells: [
          "Time until empty",
          battTimeVal ?? {
            value: null,
            unit: "seconds",
            precisionDigits: 0,
            state: "notApplicable",
          },
        ],
      },
    ];

    const genTableGroups: TableGroup[] = [];

    for (const scope of this.generatorScopes) {
      const totalVal = this.cachedValues.get(`generators.total:${scope.scopeId}`) as MetricValue | undefined;
      const runningVal = this.cachedValues.get(`generators.running:${scope.scopeId}`) as MetricValue | undefined;
      const prodVal = this.cachedValues.get(`generators.production:${scope.scopeId}`) as MetricValue | undefined;

      // State column: do NOT turn notApplicable into 0! (Co2-85 P3)
      let stateStr: string;
      if (
        runningVal &&
        runningVal.state === "value" &&
        runningVal.value !== null &&
        totalVal &&
        totalVal.state === "value" &&
        totalVal.value !== null
      ) {
        stateStr = `${runningVal.value} / ${totalVal.value} running`;
      } else if (totalVal && totalVal.state === "value" && totalVal.value !== null) {
        stateStr = `— / ${totalVal.value} running`;
      } else {
        stateStr = "NO DATA";
      }

      const outputCell: ReadingValue | MetricValue = prodVal ?? {
        value: null,
        unit: "megawatt",
        precisionDigits: 0,
        state: "notApplicable",
        sessionTimeSec: sessionTime,
      };

      // Load column: load factor is not in API v0 catalog, honest value is "—" (Co2-85 P2)
      const loadString = "—";

      genTableGroups.push({
        id: `type-${scope.scopeId}`,
        summary: [
          scope.displayName,
          stateStr,
          outputCell,
          loadString,
        ],
        selectable: true,
        selected: this.selectedObject === `type-${scope.scopeId}`,
        rows: [],
      });
    }

    const genTableState: FreshnessItem = genTableGroups.length > 0 && anyGenValue
      ? evaluateFreshness(anyGenValue, sessionTime, 10)
      : { kind: "empty", label: "NO DATA" };

    const tables: (TableModel | null)[] = [
      {
        groups: genTableGroups,
        state: genTableState,
      },
      {
        groups: [{ id: "grid-group", rows: gridRows }],
        state: freshCapacity,
      },
      {
        groups: [{ id: "battery-group", rows: batteryRows }],
        state: battTimeVal ? evaluateFreshness(battTimeVal, sessionTime, 5) : { kind: "empty", label: "NO DATA" },
      },
    ];

    // Meters
    const meters: MeterModel[] = [];
    if (battChargeVal && battChargeVal.value !== null) {
      meters.push({
        id: "battery",
        value: battChargeVal.value,
        max: 100,
        reading: battChargeVal,
      });
    }

    const catalogMetrics = this.buildCatalogMetrics("energy");

    let notice: string | undefined = this.noticeText ?? undefined;
    if (!notice) {
      if (this.apiStatus?.inert) {
        notice = this.copy.inertNotice;
      } else if (this.hasWindowIncomplete) {
        notice = this.copy.windowIncompleteNotice;
      } else {
        notice = this.copy.sessionOnly;
      }
    }

    return {
      tab: "energy",
      window: this.currentWindow,
      canExport: true,
      freshness: [aggregateFreshness([freshProduction, freshConsumption, freshCapacity])],
      ...(notice ? { notice } : {}),
      tiles,
      charts,
      tables,
      meters,
      metrics: catalogMetrics,
    };
  }

  private buildResourcesModel(): StatisticsModel {
    const sessionTime = this.lastSessionTimeSec;
    const end = sessionTime;
    const start = end - this.currentWindow * 60;
    const scopeId = this.selectedObject;

    const prodVal = (this.cachedValues.get(`items.produced:${scopeId}`) ||
      this.cachedValues.get(`${scopeId}.production`)) as MetricValue | undefined;
    const consVal = (this.cachedValues.get(`items.consumed:${scopeId}`) ||
      this.cachedValues.get(`${scopeId}.consumption`)) as MetricValue | undefined;
    const balVal = (this.cachedValues.get(`items.balance:${scopeId}`) ||
      this.cachedValues.get(`${scopeId}.balance`)) as MetricValue | undefined;
    const stockVal = (this.cachedValues.get(`items.stock:${scopeId}`) ||
      this.cachedValues.get(`${scopeId}.stock`)) as MetricValue | undefined;

    const currentScope = this.resourceScopes.find((s) => s.scopeId === scopeId);
    const resourceName = currentScope?.displayName ?? scopeId;

    const freshProd = evaluateFreshness(prodVal, sessionTime, this.getSampleInterval("items.produced"));
    const freshCons = evaluateFreshness(consVal, sessionTime, this.getSampleInterval("items.consumed"));

    // Balance
    let balanceReading: ReadingValue;
    if (balVal) {
      balanceReading = balVal;
    } else if (
      prodVal &&
      prodVal.value !== null &&
      prodVal.state === "value" &&
      consVal &&
      consVal.value !== null &&
      consVal.state === "value"
    ) {
      balanceReading = {
        value: prodVal.value - consVal.value,
        unit: prodVal.unit,
        precisionDigits: prodVal.precisionDigits,
        sessionTimeSec: sessionTime,
        state: "value",
      };
    } else {
      balanceReading = {
        value: null,
        unit: "itemsPerMinute",
        precisionDigits: 0,
        sessionTimeSec: sessionTime,
        state: "notApplicable",
      };
    }

    const tiles: TileModel[] = [
      {
        id: "extraction",
        label: `${resourceName} extraction`,
        reading: prodVal ?? {
          value: null,
          unit: "itemsPerMinute",
          precisionDigits: 0,
          sessionTimeSec: sessionTime,
          state: "notApplicable",
        },
        state: freshProd,
        source: this.formatSource(prodVal),
      },
      {
        id: "consumption",
        label: `${resourceName} consumption`,
        reading: consVal ?? {
          value: null,
          unit: "itemsPerMinute",
          precisionDigits: 0,
          sessionTimeSec: sessionTime,
          state: "notApplicable",
        },
        state: freshCons,
        source: this.formatSource(consVal),
      },
      {
        id: "balance",
        label: `${resourceName} balance`,
        reading: balanceReading,
        state: aggregateFreshness([freshProd, freshCons]),
        source: this.formatSource(balanceReading, !balVal),
      },
      {
        id: "stock",
        label: `${resourceName} stock`,
        reading: stockVal ?? {
          value: null,
          unit: "items",
          precisionDigits: 0,
          sessionTimeSec: sessionTime,
          state: "notApplicable",
        },
        state: stockVal ? evaluateFreshness(stockVal, sessionTime, 15) : { kind: "empty", label: "NO DATA" },
        source: this.formatSource(stockVal),
      },
    ];

    // Build 3 Charts for Resources: Extraction, Consumption, Stock trend
    const activeSeriesIds = this.metricsState.getSelected("resources");

    const getSeriesFor = (predicate: (id: string) => boolean, defaultLabel: string): (ChartSeries | null)[] => {
      const matched = activeSeriesIds.filter(predicate);
      return matched.map((id) => {
        const s = this.cachedSeries.get(`${id}:${scopeId}`) || this.cachedSeries.get(id);
        const currentVal = (this.cachedValues.get(`${id}:${scopeId}`) || this.cachedValues.get(id)) as MetricValue | undefined;
        const label = this.catalog.find((m) => m.id === id)?.displayName ?? defaultLabel;

        if (s && s.values.length > 0) {
          return {
            id,
            label,
            ...(currentVal ? { current: currentVal } : {}),
            timestamps: s.timestamps,
            values: s.values,
            intervalSec: s.intervalSec || 15,
          };
        }

        return {
          id,
          label,
          ...(currentVal ? { current: currentVal } : {}),
          timestamps: [],
          values: [],
          intervalSec: 15,
        };
      });
    };

    const extractionSeries = getSeriesFor(
      (id) => id.includes("produced") || id.includes("production"),
      `${resourceName} Extraction`
    );
    const consumptionSeries = getSeriesFor(
      (id) => id.includes("consumed") || id.includes("consumption"),
      `${resourceName} Consumption`
    );
    const stockSeries = getSeriesFor(
      (id) => id.includes("stock"),
      `${resourceName} Stock`
    );

    const charts: (ChartModel | null)[] = [
      {
        start,
        end,
        series: extractionSeries,
        state: extractionSeries.some((s) => s && s.values.length > 0) ? freshProd : { kind: "empty", label: "NO DATA" },
      },
      {
        start,
        end,
        series: consumptionSeries,
        state: consumptionSeries.some((s) => s && s.values.length > 0) ? freshCons : { kind: "empty", label: "NO DATA" },
      },
      {
        start,
        end,
        series: stockSeries,
        state: stockSeries.some((s) => s && s.values.length > 0) ? freshProd : { kind: "empty", label: "NO DATA" },
      },
    ];

    // Balance & Stocks tables using discovered resource scopes or fallback list
    const scopesList = this.resourceScopes.length > 0
      ? this.resourceScopes
      : [
          { scopeId: "iron", displayName: "Iron ore" },
          { scopeId: "copper", displayName: "Copper ore" },
          { scopeId: "water", displayName: "Water" },
          { scopeId: "coal", displayName: "Coal" },
        ];

    const balanceRows: TableRow[] = scopesList.map((scope) => {
      const p = (this.cachedValues.get(`items.produced:${scope.scopeId}`) ||
        this.cachedValues.get(`${scope.scopeId}.production`)) as MetricValue | undefined;
      const c = (this.cachedValues.get(`items.consumed:${scope.scopeId}`) ||
        this.cachedValues.get(`${scope.scopeId}.consumption`)) as MetricValue | undefined;
      let b: ReadingValue | MetricValue;
      if (p && p.value !== null && c && c.value !== null) {
        b = {
          value: p.value - c.value,
          unit: p.unit,
          precisionDigits: p.precisionDigits,
          sessionTimeSec: sessionTime,
          state: "value",
        };
      } else {
        b = {
          value: null,
          unit: "itemsPerMinute",
          precisionDigits: 0,
          state: "notApplicable",
        };
      }

      return {
        id: scope.scopeId,
        selectable: true,
        selected: this.selectedObject === scope.scopeId,
        cells: [
          scope.displayName,
          p ?? { value: null, unit: "itemsPerMinute", precisionDigits: 0, state: "notApplicable" },
          c ?? { value: null, unit: "itemsPerMinute", precisionDigits: 0, state: "notApplicable" },
          b,
        ],
      };
    });

    const stockRows: TableRow[] = scopesList.map((scope) => {
      const s = (this.cachedValues.get(`items.stock:${scope.scopeId}`) ||
        this.cachedValues.get(`${scope.scopeId}.stock`)) as MetricValue | undefined;
      return {
        id: `${scope.scopeId}-stock`,
        selectable: true,
        selected: this.selectedObject === scope.scopeId,
        cells: [
          scope.displayName,
          s ?? { value: null, unit: "items", precisionDigits: 0, state: "notApplicable" },
        ],
      };
    });

    const tables: (TableModel | null)[] = [
      {
        groups: [{ id: "balance-table", rows: balanceRows }],
        state: aggregateFreshness([freshProd, freshCons]),
      },
      {
        groups: [{ id: "stocks-table", rows: stockRows }],
        state: aggregateFreshness([freshProd, freshCons]),
      },
    ];

    const catalogMetrics = this.buildCatalogMetrics("resources");

    let notice: string | undefined = this.noticeText ?? undefined;
    if (!notice) {
      if (this.apiStatus?.inert) {
        notice = this.copy.inertNotice;
      } else if (this.hasWindowIncomplete) {
        notice = this.copy.windowIncompleteNotice;
      } else {
        notice = this.copy.sessionOnly;
      }
    }

    return {
      tab: "resources",
      window: this.currentWindow,
      canExport: true,
      freshness: [aggregateFreshness([freshProd, freshCons])],
      ...(notice ? { notice } : {}),
      tiles,
      charts,
      tables,
      metrics: catalogMetrics,
    };
  }

  private buildCatalogMetrics(tab: ReportTab): CatalogMetricModel[] {
    const domainFilter = tab === "energy" ? "power" : "items";
    const selectedIds = new Set(this.metricsState.getSelected(tab));

    return this.catalog
      .filter((m) => {
        if (domainFilter === "power") {
          return m.id.startsWith("power.") || m.id.startsWith("generators.");
        }
        return m.id.startsWith("items.") || m.id.startsWith("fluids.");
      })
      .map((m) => {
        const matches = this.searchQuery.trim().length > 0
          ? m.displayName.toLowerCase().includes(this.searchQuery.toLowerCase()) ||
            m.id.toLowerCase().includes(this.searchQuery.toLowerCase())
          : true;

        return {
          id: m.id,
          label: m.displayName,
          unit: m.unit,
          hasSeries: m.hasSeries,
          selected: selectedIds.has(m.id),
          matches,
        };
      });
  }

  private showNotice(text: string): void {
    this.noticeText = text;
    if (this.noticeTimer) {
      clearTimeout(this.noticeTimer);
    }
    this.noticeTimer = setTimeout(() => {
      this.noticeText = null;
      this.noticeTimer = null;
      this.render();
    }, 4000);
  }

  public render(): void {
    if (this.isDestroyed || !this.view) return;
    const model = this.buildModel();
    this.view.update(model);
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
      this.view = undefined;
    }
  }
}
