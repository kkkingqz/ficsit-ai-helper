/** Каноническая версия замороженного контракта Public API v0. */
export const PUBLIC_API_VERSION = "0.4.0";

/** Источник данных телеметрии. */
export type DataSource =
  | "live"
  | "save"
  | "saveEstimated"
  | "recorded"
  | "fixture"
  | "planned";

/** Подмножество DataSource, реализуемое библиотекой save-source. */
export type SaveDataSourceMode = "save" | "saveEstimated";

/** Состояние значения метрики. */
export type ValueState = "value" | "notApplicable";

/** Единицы измерения метрик Public API v0. */
export type Unit =
  | "itemsPerMinute"
  | "cubicMetersPerMinute"
  | "megawatt"
  | "megawattHour"
  | "percent"
  | "count"
  | "seconds";

/** Область агрегации метрики. */
export type MetricScope =
  | "factory"
  | "powerNetwork"
  | "item"
  | "machineType"
  | "line";

/** Окно временного ряда. */
export type SeriesWindow = "last5Min" | "last15Min" | "last60Min";

/** Стоимость вычисления метрики. */
export type CostClass = "cheap" | "normal" | "heavy";

/** Коды ошибок Public API v0. */
export type ErrorCode =
  | "MOD_INERT"
  | "API_VERSION_MISMATCH"
  | "UNKNOWN_METRIC"
  | "SCOPE_REQUIRED"
  | "SERIES_NOT_AVAILABLE"
  | "RATE_LIMITED"
  | "SCOPE_NOT_FOUND"
  | "SOURCE_UNAVAILABLE"
  | "INVALID_ARGUMENT";

/** Ошибка уровня контракта FICSIT AI Public API v0. */
export class FicsitAIApiError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    code: ErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "FicsitAIApiError";
    this.code = code;
    this.details = details;
  }

  toJSON(): { code: ErrorCode; message: string; details?: Record<string, unknown> } {
    if (this.details !== undefined) {
      return {
        code: this.code,
        message: this.message,
        details: this.details,
      };
    }
    return {
      code: this.code,
      message: this.message,
    };
  }
}

export interface ScopeRef {
  scopeId: string;
  displayName: string;
}

export interface MetricDescriptor {
  id: string;
  displayName: string;
  unit: Unit;
  scope: MetricScope;
  hasSeries: boolean;
  costClass: CostClass;
  sampleIntervalSec: number;
  external: boolean;
  availableScopes: ScopeRef[];
  scopesTruncated: boolean;
}

export interface GetStatusResponse {
  apiVersion: string;
  saveId: string;
  source: DataSource;
  inert: boolean;
  lastSnapshotSessionTimeSec: number;
  sidecarConnected: boolean;
  apiVersionMismatch: string;
  reason: string;
}

export interface ListMetricsRequest {
  metricId?: string;
  scope?: MetricScope;
  filter?: string;
  scopeFilter?: string;
  pageSize?: number;
  cursor?: string;
  scopeCursor?: string;
}

export interface ListMetricsResponse {
  metrics: MetricDescriptor[];
  nextCursor: string;
  nextScopeCursor?: string;
}

export interface ListScopesRequest {
  metricId: string;
  scopeFilter?: string;
  pageSize?: number;
  cursor?: string;
}

export interface ListScopesResponse {
  scopes: ScopeRef[];
  nextCursor: string;
}

export interface QueryMetricRequest {
  metricId: string;
  scopeId?: string;
}

export interface QueryMetricResponse {
  kind: "value";
  metricId: string;
  scopeId: string;
  state: ValueState;
  value: number | null;
  unit: Unit;
  source: DataSource;
  sessionTimeSec: number;
  precisionDigits: number;
}

export interface QuerySeriesRequest {
  metricId: string;
  window: SeriesWindow;
  scopeId?: string;
}

/* ---------- Структурные типы пакетов FICSIT Foreman ---------- */

export type Purity = "impure" | "normal" | "pure";

export interface SaveVector3 {
  x: number;
  y: number;
  z: number;
}

export interface ProducerLine {
  instanceName: string;
  buildingClass: string;
  recipeClass?: string;
  clockSpeed: number;
  productionBoost: number;
  location?: SaveVector3;
}

export interface ExtractorLine {
  instanceName: string;
  buildingClass: string;
  clockSpeed: number;
  productionBoost: number;
  location?: SaveVector3;
}

export interface GeneratorLine {
  instanceName: string;
  buildingClass: string;
  clockSpeed: number;
  fuelClass?: string;
  location?: SaveVector3;
}

export interface BatteryLine {
  instanceName: string;
  buildingClass: string;
  chargeMWh: number;
  location?: SaveVector3;
}

export interface BuildableActor {
  instanceName: string;
  classKey: string;
  location?: SaveVector3;
}

export interface SavePowerCircuit {
  circuitId: number;
  members: string[];
}

export interface ResourceNodeOverride {
  position?: SaveVector3;
  resourceClass?: string;
  purity?: Purity;
}

export interface SplitterRule {
  outputIndex: number;
  itemClass?: string;
  rule: "item" | "any" | "anyUndefined" | "overflow" | "none";
}

export interface SaveState {
  saveName: string;
  sessionName?: string;
  playDurationSeconds?: number;
  creativeMode: {
    enabled?: boolean;
    noPower: boolean;
  };
  advancedGameSettings: {
    powerConsumptionMultiplier: number;
  };
  production: {
    producers: ProducerLine[];
    extractors: ExtractorLine[];
    generators: GeneratorLine[];
    batteries: BatteryLine[];
  };
  topology: {
    buildables: BuildableActor[];
    powerCircuits: SavePowerCircuit[];
  };
  resourceNodeOverrides: ResourceNodeOverride[];
}

export type ActorKind = "storage" | "producer" | "extractor" | "generator" | "building";

export interface ActorNode {
  instanceName: string;
  classKey: string;
  location?: SaveVector3;
  kind: ActorKind;
  producer?: ProducerLine;
  extractor?: ExtractorLine;
  generator?: GeneratorLine;
  battery?: BatteryLine;
}

export interface SaveFlowEdge {
  from: string;
  to: string;
  kind: "conveyor" | "pipe";
}

export interface SaveGraph {
  getActor(instanceName: string): ActorNode | undefined;
  actorsByKind(kind: ActorKind): ActorNode[];
  neighbours?(instanceName: string, kind?: "conveyor" | "pipe"): ActorNode[];
  powerCircuits(): SavePowerCircuit[];
  powerCircuitOf(instanceName: string): SavePowerCircuit | undefined;
  splitterRulesOf?(instanceName: string): SplitterRule[] | undefined;
  flowEdges?: () => Array<{ from: string; to: string; kind: "conveyor" | "pipe" }>;
}

export interface GameIngredientOrProduct {
  itemClassName: string;
  displayName: string;
  amount: number;
  perMinute: number;
  unit: "items" | "m³";
}

export interface GameRecipe {
  className: string;
  displayName: string;
  variablePower?: {
    min: number;
    max: number;
  };
  ingredients: GameIngredientOrProduct[];
  products: GameIngredientOrProduct[];
}

export interface GameItem {
  className: string;
  displayName: string;
  form?: string;
}

export interface GameBuilding {
  className: string;
  displayName: string;
  powerConsumption: number;
  maxPowerConsumption?: number;
  powerProduction?: number;
  variablePowerProduction?: boolean;
  conveyorSpeedPerMin?: number;
  pipeFlowPerMin?: number;
  extractionRatePerMin?: number;
}

export interface WorldResourceNode {
  id: string;
  kind: "resourceNode" | "frackingSatellite" | "frackingCore" | "geyser";
  resourceClass: string | null;
  purity: Purity | null;
  x: number;
  y: number;
  z: number;
}

export interface WorldLocations {
  resourceNodes: WorldResourceNode[];
}

export interface GameData {
  items: Record<string, GameItem>;
  resources: Record<string, GameItem>;
  recipes: Record<string, GameRecipe>;
  buildings: Record<string, GameBuilding>;
}

export type RateMap = Record<string, number>;

export interface FlowNodeInput {
  id: string;
  supply?: RateMap;
  demand?: RateMap;
}

export interface FlowEdgeInput {
  from: string;
  to: string;
  capacity: number;
  allow?: string[];
  deny?: string[];
  overflow?: boolean;
}

export interface FlowNetworkInput {
  nodes: FlowNodeInput[];
  edges: FlowEdgeInput[];
}

export interface FlowResultOutput {
  delivered: Record<string, RateMap>;
  throughput: Record<string, number>;
  cyclic: string[];
}

export interface FlowSolverModule {
  solveFlow: (network: FlowNetworkInput) => FlowResultOutput;
}

export interface ForemanPackages {
  parseSaveFile: (filePath: string, name: string) => unknown;
  normaliseSave: (
    parsed: unknown,
    parsedAt: string,
  ) => { state: SaveState; warnings: string[] };
  statMtimeMs: (filePath: string) => number;
  WATER_EXTRACTOR: RegExp;
  WATER_ITEM_CLASS: string;
  buildSaveGraph: (state: SaveState) => SaveGraph;
  loadDataset: (
    env?: NodeJS.ProcessEnv,
    dataDir?: string,
  ) => { gameData: GameData; world: WorldLocations; warning?: string };
  flowModule?: FlowSolverModule;
}

export interface SaveSourceDeps {
  loadForemanPackages: (foremanSrcDir: string) => Promise<ForemanPackages>;
  fileExists: (path: string) => Promise<boolean>;
}

export interface SaveSourceOptions {
  /** Каталог с файлами .sav (используется вместе с saveId). */
  saveDataDir?: string;
  /** Логический идентификатор сохранения (имя файла без .sav или с .sav). */
  saveId?: string;
  /** Явный путь к файлу .sav (имеет приоритет над saveDataDir + saveId). */
  saveFilePath?: string;
  /** Путь к локальному checkout FICSIT Foreman (по умолчанию FOREMAN_SRC или ~/Projects/foreman-src). */
  foremanSrcDir?: string;
  /** Режим источника: "save" (по умолчанию) или "saveEstimated". */
  sourceMode?: SaveDataSourceMode;
  /** Ожидаемая версия API вызывающего клиента для проверки API_VERSION_MISMATCH. */
  expectedApiVersion?: string;
  /** Инъекция зависимостей для модульных тестов без дискового/внешнего Foreman. */
  deps?: Partial<SaveSourceDeps>;
}
