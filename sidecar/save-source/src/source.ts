import {
  decodeCursor,
  encodeCursor,
  filterScopes,
  getMetricDefinition,
  MAX_INLINE_SCOPES,
  MetricDefinition,
  normalizePageSize,
  toMetricDescriptor,
  V01_METRICS,
} from "./catalog.js";
import {
  buildGameDataIndex,
  createDefaultDeps,
  GameDataIndex,
  resolveForemanSrcDir,
  resolveSaveLocation,
} from "./foreman.js";
import { buildSaveSnapshot, MetricSample, SaveSnapshot } from "./snapshot.js";
import {
  FicsitAIApiError,
  ForemanPackages,
  GameData,
  GetStatusResponse,
  ListMetricsRequest,
  ListMetricsResponse,
  ListScopesRequest,
  ListScopesResponse,
  MetricDescriptor,
  MetricScope,
  PUBLIC_API_VERSION,
  QueryMetricRequest,
  QueryMetricResponse,
  QuerySeriesRequest,
  QuerySeriesResponse,
  SaveDataSourceMode,
  SaveSourceDeps,
  SaveSourceOptions,
  ScopeRef,
  SeriesWindow,
  WorldLocations,
} from "./types.js";

const VALID_SCOPES: ReadonlySet<string> = new Set<MetricScope>([
  "factory",
  "powerNetwork",
  "item",
  "machineType",
  "line",
]);

const VALID_SERIES_WINDOWS: ReadonlySet<string> = new Set<SeriesWindow>([
  "last5Min",
  "last15Min",
  "last60Min",
]);

interface CachedRuntime {
  packages: ForemanPackages;
  index: GameDataIndex;
  world: WorldLocations;
  snapshot?: SaveSnapshot;
  saveFilePath?: string;
}

/**
 * Библиотечный источник данных Save и SaveEstimated для FICSIT AI.
 * Читает `.sav` через пакеты FICSIT Foreman, кэширует снимок по `mtimeMs`
 * и отдаёт канонические ответы замороженного Public API v0 (`0.4.0`).
 */
export class SaveSource {
  private readonly options: SaveSourceOptions;
  private readonly sourceMode: SaveDataSourceMode;
  private readonly deps: SaveSourceDeps;
  private runtime: CachedRuntime | undefined;

  constructor(options: SaveSourceOptions = {}) {
    this.options = options;
    this.sourceMode = options.sourceMode ?? "save";
    if (this.sourceMode !== "save" && this.sourceMode !== "saveEstimated") {
      throw new FicsitAIApiError(
        "INVALID_ARGUMENT",
        `Unsupported sourceMode for SaveSource: ${String(options.sourceMode)}`,
      );
    }
    this.deps = createDefaultDeps(options.deps);
  }

  private assertApiVersion(): void {
    const expected = this.options.expectedApiVersion;
    if (expected !== undefined && expected !== PUBLIC_API_VERSION) {
      throw new FicsitAIApiError(
        "API_VERSION_MISMATCH",
        `API version mismatch: client expects ${expected}, source implements ${PUBLIC_API_VERSION}`,
        { expectedApiVersion: expected, actualApiVersion: PUBLIC_API_VERSION },
      );
    }
  }

  private async ensureRuntime(): Promise<CachedRuntime> {
    if (this.runtime) {
      return this.runtime;
    }
    const foremanDir = resolveForemanSrcDir(this.options);
    const packages = await this.deps.loadForemanPackages(foremanDir);
    if (this.sourceMode === "saveEstimated" && !packages.flowModule?.solveFlow) {
      throw new FicsitAIApiError(
        "SOURCE_UNAVAILABLE",
        "@foreman/sf-flow is required for saveEstimated mode but could not be loaded",
      );
    }
    const dataset = packages.loadDataset();
    const gameData: GameData = dataset.gameData;
    const world: WorldLocations = dataset.world ?? { resourceNodes: [] };
    const index = buildGameDataIndex(gameData);
    this.runtime = { packages, index, world };
    return this.runtime;
  }

  private async loadSnapshot(): Promise<SaveSnapshot> {
    const location = resolveSaveLocation(this.options);
    const exists = await this.deps.fileExists(location.saveFilePath);
    if (!exists) {
      throw new FicsitAIApiError(
        "SOURCE_UNAVAILABLE",
        `Save file not found or unreadable: ${location.saveFilePath}`,
        { saveFilePath: location.saveFilePath, saveId: location.saveId },
      );
    }

    const rt = await this.ensureRuntime();
    let mtimeMs: number;
    try {
      mtimeMs = rt.packages.statMtimeMs(location.saveFilePath);
    } catch (err) {
      throw new FicsitAIApiError(
        "SOURCE_UNAVAILABLE",
        `Failed to stat save file: ${location.saveFilePath}`,
        { cause: err instanceof Error ? err.message : String(err) },
      );
    }

    if (
      rt.snapshot &&
      rt.saveFilePath === location.saveFilePath &&
      rt.snapshot.mtimeMs === mtimeMs &&
      rt.snapshot.source === this.sourceMode
    ) {
      return rt.snapshot;
    }

    try {
      const parsed = rt.packages.parseSaveFile(location.saveFilePath, location.saveId);
      const { state } = rt.packages.normaliseSave(parsed, new Date().toISOString());
      const graph = rt.packages.buildSaveGraph(state);
      const snapshot = buildSaveSnapshot({
        saveId: location.saveId,
        mtimeMs,
        state,
        graph,
        index: rt.index,
        world: rt.world,
        packages: rt.packages,
        sourceMode: this.sourceMode,
      });
      rt.snapshot = snapshot;
      rt.saveFilePath = location.saveFilePath;
      return snapshot;
    } catch (err) {
      if (err instanceof FicsitAIApiError) {
        throw err;
      }
      throw new FicsitAIApiError(
        "SOURCE_UNAVAILABLE",
        `Failed to parse save file: ${location.saveFilePath}`,
        { cause: err instanceof Error ? err.message : String(err) },
      );
    }
  }

  private scopesForMetric(snapshot: SaveSnapshot, def: MetricDefinition): readonly ScopeRef[] {
    switch (def.scope) {
      case "factory":
        return [];
      case "powerNetwork":
        return snapshot.powerNetworkScopes;
      case "machineType":
        return snapshot.generatorTypeScopes;
      case "item":
        return def.id.startsWith("fluids.")
          ? snapshot.fluidItemScopes
          : snapshot.solidItemScopes;
      case "line":
        return [];
    }
  }

  private resolveSample(
    snapshot: SaveSnapshot,
    def: MetricDefinition,
    scopeId: string | undefined,
  ): { resolvedScopeId: string; sample: MetricSample } {
    if (def.scope === "factory") {
      if (scopeId !== undefined && scopeId !== "") {
        throw new FicsitAIApiError(
          "INVALID_ARGUMENT",
          `Factory metric ${def.id} does not accept scopeId`,
          { metricId: def.id, scopeId },
        );
      }
      const value =
        def.id === "power.production"
          ? snapshot.factory.powerProductionMW
          : snapshot.factory.powerConsumptionMW;
      return {
        resolvedScopeId: "",
        sample: { state: "value", value },
      };
    }

    if (scopeId === undefined || scopeId.trim() === "") {
      throw new FicsitAIApiError(
        "SCOPE_REQUIRED",
        `Metric ${def.id} (${def.scope}) requires scopeId`,
        { metricId: def.id, scope: def.scope },
      );
    }

    if (def.scope === "powerNetwork") {
      const circuit = snapshot.powerNetworks.get(scopeId);
      if (!circuit) {
        throw new FicsitAIApiError(
          "SCOPE_NOT_FOUND",
          `PowerNetwork scope not found: ${scopeId}`,
          { metricId: def.id, scopeId },
        );
      }
      const sampleMap: Record<string, MetricSample> = {
        "power.network.production": { state: "value", value: circuit.productionMW },
        "power.network.consumption": { state: "value", value: circuit.consumptionMW },
        "power.network.capacity": { state: "value", value: circuit.capacityMW },
        "power.network.max_consumption": { state: "value", value: circuit.maxConsumptionMW },
        "power.network.fuse_tripped": { state: "value", value: circuit.fuseTripped },
        "power.network.battery_charge": circuit.batteryCharge,
        "power.network.battery_output": circuit.batteryOutput,
        "power.network.battery_time_to_empty": circuit.batteryTimeToEmpty,
        "power.network.battery_time_to_full": circuit.batteryTimeToFull,
      };
      const sample = sampleMap[def.id];
      if (!sample) {
        throw new FicsitAIApiError("UNKNOWN_METRIC", `Unsupported metricId: ${def.id}`);
      }
      return { resolvedScopeId: scopeId, sample };
    }

    if (def.scope === "machineType") {
      const gen = snapshot.generatorTypes.get(scopeId);
      if (!gen) {
        throw new FicsitAIApiError(
          "SCOPE_NOT_FOUND",
          `MachineType scope not found: ${scopeId}`,
          { metricId: def.id, scopeId },
        );
      }
      const value =
        def.id === "generators.total"
          ? gen.total
          : def.id === "generators.running"
            ? gen.running
            : gen.productionMW;
      return {
        resolvedScopeId: scopeId,
        sample: { state: "value", value },
      };
    }

    if (def.scope === "item") {
      const isFluid = def.id.startsWith("fluids.");
      const rateMap = isFluid ? snapshot.fluidItems : snapshot.solidItems;
      const item = rateMap.get(scopeId);
      if (!item) {
        throw new FicsitAIApiError(
          "SCOPE_NOT_FOUND",
          `Item scope not found: ${scopeId}`,
          { metricId: def.id, scopeId },
        );
      }
      const value = def.id.endsWith(".produced")
        ? item.produced
        : def.id.endsWith(".consumed")
          ? item.consumed
          : item.balance;
      return {
        resolvedScopeId: scopeId,
        sample: { state: "value", value },
      };
    }

    throw new FicsitAIApiError("UNKNOWN_METRIC", `Unsupported scope: ${def.scope}`);
  }

  /** Возвращает статус источника данных (без падения при отсутствии .sav файла). */
  async getStatus(): Promise<GetStatusResponse> {
    const location = resolveSaveLocation(this.options);
    const expected = this.options.expectedApiVersion;
    const apiVersionMismatch =
      expected !== undefined && expected !== PUBLIC_API_VERSION
        ? `Expected ${expected}, server implements ${PUBLIC_API_VERSION}`
        : "";

    try {
      const snapshot = await this.loadSnapshot();
      return {
        apiVersion: PUBLIC_API_VERSION,
        saveId: snapshot.saveId,
        source: this.sourceMode,
        inert: false,
        lastSnapshotSessionTimeSec: snapshot.sessionTimeSec,
        sidecarConnected: false,
        apiVersionMismatch,
        reason: apiVersionMismatch ? "API version mismatch" : "",
      };
    } catch (err) {
      if (err instanceof FicsitAIApiError && err.code === "INVALID_ARGUMENT") {
        throw err;
      }
      return {
        apiVersion: PUBLIC_API_VERSION,
        saveId: location.saveId,
        source: this.sourceMode,
        inert: true,
        lastSnapshotSessionTimeSec: 0,
        sidecarConnected: false,
        apiVersionMismatch,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /** Каталог метрик Public API v0 с пагинацией и фильтрацией. */
  async listMetrics(request: ListMetricsRequest = {}): Promise<ListMetricsResponse> {
    this.assertApiVersion();

    const pageSize = normalizePageSize(request.pageSize);
    const metricOffset = decodeCursor(request.cursor, "m", "cursor");
    const scopeOffset = decodeCursor(request.scopeCursor, "s", "scopeCursor");

    if (request.scope !== undefined && !VALID_SCOPES.has(request.scope)) {
      throw new FicsitAIApiError("INVALID_ARGUMENT", `Invalid scope: ${String(request.scope)}`);
    }

    const hasMetricId = request.metricId !== undefined && request.metricId !== "";
    if (!hasMetricId && (request.scopeFilter !== undefined || request.scopeCursor !== undefined)) {
      throw new FicsitAIApiError(
        "INVALID_ARGUMENT",
        "scopeFilter and scopeCursor require metricId to be specified",
      );
    }

    const snapshot = await this.loadSnapshot();

    if (hasMetricId) {
      const def = getMetricDefinition(request.metricId as string);
      if (request.scope !== undefined && def.scope !== request.scope) {
        return { metrics: [], nextCursor: "", nextScopeCursor: "" };
      }
      if (metricOffset > 0) {
        return { metrics: [], nextCursor: "", nextScopeCursor: "" };
      }
      const allScopes = this.scopesForMetric(snapshot, def);
      const filteredScopes = filterScopes(allScopes, request.scopeFilter);
      const { descriptor, nextScopeCursor } = toMetricDescriptor(
        def,
        filteredScopes,
        scopeOffset,
        MAX_INLINE_SCOPES,
      );
      return {
        metrics: [descriptor],
        nextCursor: "",
        nextScopeCursor,
      };
    }

    const needle = request.filter?.trim().toLowerCase();
    const matchingDefs = V01_METRICS.filter((def) => {
      if (request.scope !== undefined && def.scope !== request.scope) {
        return false;
      }
      if (needle && needle !== "") {
        return (
          def.id.toLowerCase().includes(needle) ||
          def.displayName.toLowerCase().includes(needle)
        );
      }
      return true;
    });

    if (metricOffset > matchingDefs.length) {
      throw new FicsitAIApiError("INVALID_ARGUMENT", "cursor is out of range");
    }

    const slice = matchingDefs.slice(metricOffset, metricOffset + pageSize);
    const metrics: MetricDescriptor[] = slice.map((def) => {
      const scopes = this.scopesForMetric(snapshot, def);
      return toMetricDescriptor(def, scopes, 0, MAX_INLINE_SCOPES).descriptor;
    });

    const nextOffset = metricOffset + slice.length;
    const nextCursor =
      nextOffset < matchingDefs.length ? encodeCursor("m", nextOffset) : "";

    return {
      metrics,
      nextCursor,
    };
  }

  /** Пагинированный список допустимых scopeId для заданной метрики. */
  async listScopes(request: ListScopesRequest): Promise<ListScopesResponse> {
    this.assertApiVersion();

    if (!request.metricId || request.metricId.trim() === "") {
      throw new FicsitAIApiError("INVALID_ARGUMENT", "metricId is required");
    }

    const def = getMetricDefinition(request.metricId);
    const pageSize = normalizePageSize(request.pageSize);
    const offset = decodeCursor(request.cursor, "s", "cursor");

    const snapshot = await this.loadSnapshot();
    const allScopes = this.scopesForMetric(snapshot, def);
    const filtered = filterScopes(allScopes, request.scopeFilter);

    if (offset > filtered.length) {
      throw new FicsitAIApiError("INVALID_ARGUMENT", "cursor is out of range");
    }

    const slice = filtered.slice(offset, offset + pageSize);
    const nextOffset = offset + slice.length;
    const nextCursor = nextOffset < filtered.length ? encodeCursor("s", nextOffset) : "";

    return {
      scopes: slice,
      nextCursor,
    };
  }

  /** Текущее значение метрики из снимка `.sav`. */
  async queryMetric(request: QueryMetricRequest): Promise<QueryMetricResponse> {
    this.assertApiVersion();

    if (!request.metricId || request.metricId.trim() === "") {
      throw new FicsitAIApiError("INVALID_ARGUMENT", "metricId is required");
    }

    const def = getMetricDefinition(request.metricId);
    const snapshot = await this.loadSnapshot();
    const { resolvedScopeId, sample } = this.resolveSample(snapshot, def, request.scopeId);

    return {
      kind: "value",
      metricId: def.id,
      scopeId: resolvedScopeId,
      state: sample.state,
      value: sample.value,
      unit: def.unit,
      source: snapshot.source,
      sessionTimeSec: snapshot.sessionTimeSec,
      precisionDigits: def.precisionDigits,
    };
  }

  /** Временные ряды в Save и SaveEstimated отсутствуют (возвращает SERIES_NOT_AVAILABLE). */
  async querySeries(request: QuerySeriesRequest): Promise<QuerySeriesResponse> {
    this.assertApiVersion();

    if (!request.metricId || request.metricId.trim() === "") {
      throw new FicsitAIApiError("INVALID_ARGUMENT", "metricId is required");
    }
    if (!VALID_SERIES_WINDOWS.has(request.window)) {
      throw new FicsitAIApiError(
        "INVALID_ARGUMENT",
        `Invalid series window: ${String(request.window)}`,
      );
    }

    const def = getMetricDefinition(request.metricId);
    throw new FicsitAIApiError(
      "SERIES_NOT_AVAILABLE",
      `Time series are not available for metric ${def.id} in ${this.sourceMode} source`,
      { metricId: def.id, source: this.sourceMode, hasSeries: def.hasSeries },
    );
  }
}

export function createSaveSource(options: SaveSourceOptions = {}): SaveSource {
  return new SaveSource(options);
}
