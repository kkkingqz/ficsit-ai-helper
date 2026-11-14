/**
 * Публичный API мода, версия 0 — формы для страниц.
 *
 * Это перевод замороженного контракта
 * [public-api-v0.md](../../../../docs/interfaces/public-api-v0.md) в типы
 * TypeScript, а не вторая его редакция. Если здесь и там расходится — прав
 * документ: формы задаёт Co, утверждает Gs.
 *
 * Канонические правила контракта, которые видно прямо в типах:
 *
 * - enum сериализуются строками в lowerCamelCase (`itemsPerMinute`, `last15Min`);
 * - у ответа `queryMetric` есть дискриминатор `kind`: `value` против `series`;
 * - `value` равен `null` тогда и только тогда, когда `state` — `notApplicable`;
 * - ошибка — `{ code, message, details? }`;
 * - время — секунды от начала сессии.
 */

export const API_VERSION = "0.4.0";

export type DataSource = "live" | "save" | "saveEstimated" | "recorded" | "fixture" | "planned";

export type ValueState = "value" | "notApplicable";

export type Unit =
  | "itemsPerMinute"
  | "cubicMetersPerMinute"
  | "megawatt"
  | "megawattHour"
  | "percent"
  | "count"
  | "seconds";

export type MetricScope = "factory" | "powerNetwork" | "item" | "machineType" | "line";

export type SeriesWindow = "last5Min" | "last15Min" | "last60Min";

export type CostClass = "cheap" | "normal" | "heavy";

/**
 * Коды ошибок контракта плюс коды транспорта.
 *
 * Незнакомый код клиент обязан трактовать как общую ошибку — поэтому тип
 * открыт строкой: новый код в контракте не должен ломать сборку страницы.
 */
export type ApiErrorCode =
  | "MOD_INERT"
  | "API_VERSION_MISMATCH"
  | "UNKNOWN_METRIC"
  | "SCOPE_REQUIRED"
  | "SERIES_NOT_AVAILABLE"
  | "RATE_LIMITED"
  | "SCOPE_NOT_FOUND"
  | "SOURCE_UNAVAILABLE"
  | "INVALID_ARGUMENT"
  | "UNKNOWN_OP"
  | "TOO_LARGE"
  | "TRANSPORT_UNAVAILABLE"
  | (string & {});

export interface ApiErrorBody {
  code: ApiErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

/** Ошибка API в виде исключения: страница ловит её одним `catch`. */
export class ApiError extends Error {
  public readonly code: ApiErrorCode;
  public readonly details: Record<string, unknown> | undefined;

  public constructor(body: ApiErrorBody) {
    super(body.message);
    this.name = "ApiError";
    this.code = body.code;
    this.details = body.details;
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

export interface ApiStatus {
  apiVersion: string;
  saveId: string;
  source: DataSource;
  inert: boolean;
  lastSnapshotSessionTimeSec: number;
  sidecarConnected: boolean;
  apiVersionMismatch: string;
  reason: string;
}

export interface MetricValue {
  kind: "value";
  metricId: string;
  scopeId: string;
  state: ValueState;
  /** `null` ровно тогда, когда `state` — `notApplicable`. */
  value: number | null;
  unit: Unit;
  source: DataSource;
  sessionTimeSec: number;
  precisionDigits: number;
}

export interface MetricSeries {
  kind: "series";
  metricId: string;
  scopeId: string;
  window: SeriesWindow;
  unit: Unit;
  source: DataSource;
  /** Номинальный шаг сетки, а не гарантия равномерности. */
  intervalSec: number;
  values: number[];
  /**
   * Время каждой точки, той же длины, что `values`. Единственный источник
   * времени точки: по `intervalSec` его восстанавливать нельзя — пропуски
   * в ряду есть, а подставленных значений нет (Gs-3.3, Gs-5.3).
   */
  timestamps: number[];
  firstPointSessionTimeSec: number;
  /** Сессия короче запрошенного окна — экран обязан сказать это игроку. */
  windowIncomplete: boolean;
}

export interface ListMetricsArgs {
  metricId?: string;
  scope?: MetricScope;
  filter?: string;
  /** Только вместе с `metricId`, иначе `INVALID_ARGUMENT`. */
  scopeFilter?: string;
  pageSize?: number;
  cursor?: string;
  /** Только вместе с `metricId`. Курсор областей и курсор метрик не взаимозаменяемы. */
  scopeCursor?: string;
}

export interface ListMetricsResult {
  metrics: MetricDescriptor[];
  nextCursor: string;
  nextScopeCursor?: string;
}

export interface ListScopesArgs {
  metricId: string;
  scopeFilter?: string;
  pageSize?: number;
  cursor?: string;
}

export interface ListScopesResult {
  scopes: ScopeRef[];
  nextCursor: string;
}

export interface QueryMetricArgs {
  metricId: string;
  scopeId?: string;
}

export interface QuerySeriesArgs {
  metricId: string;
  window: SeriesWindow;
  scopeId?: string;
}

/** События API v0. Данные приходят как есть из контракта. */
export interface ApiEvents {
  "metrics.snapshot": {
    sessionTimeSec: number;
    changedMetricIds: string[];
    source: DataSource;
  };
  "mod.inert": { inert: boolean; reason: string };
  "api.status": {
    sidecarConnected: boolean;
    source: DataSource;
    inert: boolean;
    apiVersionMismatch: string;
    reason: string;
  };
}

export type ApiEventName = keyof ApiEvents;

/** Имена запросов на мосту — lowerCamelCase, как в конверте (`op`). */
export type ApiOperation =
  | "getStatus"
  | "listMetrics"
  | "listScopes"
  | "queryMetric"
  | "querySeries";
