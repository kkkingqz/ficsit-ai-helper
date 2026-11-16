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

/**
 * Версия контракта, на которой собран фасад.
 *
 * Поверхность запросов — вся поверхность API 0.5.0: статус, каталог, области,
 * значение, ряд и чат (`chatSend`, `chatCancel`, `chatHistory`) с событиями
 * `chat.*`.
 */
export const API_VERSION = "0.5.0";

export type DataSource = "live" | "save" | "saveEstimated" | "recorded" | "fixture" | "planned";

export type ValueState = "value" | "notApplicable";

/**
 * Состояние ассистента (0.5.0): `unavailable` — нет сайдкара или Foreman не
 * отвечает (причина в `reason`), `signingIn` — адаптер входит в Foreman,
 * `ready` — можно отправлять ход.
 *
 * Ровно три значения контракта (`EFicsitAIAssistantState`). Четвёртого,
 * `thinking`, в контракте нет: «ассистент думает» — это состояние хода, а не
 * состояние API, и экран берёт его из `chat.*` своего хода (повторное ревью
 * Gs на #53). Лишнее значение в типе — обещание страницам того, чего мод
 * никогда не пришлёт.
 */
export type AssistantState = "unavailable" | "signingIn" | "ready";

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
  // 0.5.0, чат: запрос без связи с сайдкаром и правила хода из протокола
  // канала. Отвечают сразу, ожидания нет.
  | "SIDECAR_UNAVAILABLE"
  | "TURN_IN_PROGRESS"
  | "TURN_DRAINING"
  | "NO_TURN"
  | "TURN_MISMATCH"
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
  /** С 0.5.0: состояние ассистента для строки состояния и экрана чата. */
  assistantState?: AssistantState;
  /** С 0.5.0: имя модели — его показывает строка состояния (§5). */
  assistantModel?: string;
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

/**
 * Чат (0.5.0). Это запросы к сайдкару через API, как Work Orders: экран знает
 * только API и ничего не знает ни про канал, ни про Foreman. Сохранение —
 * текущее, `saveId` клиент не передаёт.
 */
export type ChatMessageRole = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: ChatMessageRole;
  text: string;
  /** Метка создания сообщения, как её отдал мод. */
  createdAt: string;
}

export interface ChatSendArgs {
  text: string;
}

export interface ChatSendResult {
  /** Дальше придут события `chat.*` с этим `turnId`. */
  turnId: string;
}

export interface ChatCancelArgs {
  turnId: string;
}

export interface ChatCancelResult {
  /**
   * `cancelled` — вещание остановлено этим вызовом, `alreadyCancelled` — ход
   * уже был отменён. Ни то, ни другое не значит, что хода не было: Foreman
   * дочитывает его и ответ всё равно ложится в историю.
   */
  state: "cancelled" | "alreadyCancelled";
}

export interface ChatHistoryArgs {
  /** 1–100, по умолчанию 50. Вне диапазона — `INVALID_ARGUMENT` от мода. */
  limit?: number;
}

export interface ChatHistoryResult {
  /** От старых к новым. */
  messages: ChatMessage[];
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
    /** С 0.5.0. */
    assistantState?: AssistantState;
    /** С 0.5.0. */
    assistantModel?: string;
  };
  /**
   * Ход чата (0.5.0). Приходят только тому клиенту, который отправил ход, и
   * только с его `turnId` — отбор делает мод, фасад их просто доставляет.
   */
  "chat.text": { turnId: string; text: string };
  /** Ассистент вызвал инструмент; аргументов в событии нет нарочно. */
  "chat.tool": { turnId: string; name: string };
  "chat.done": { turnId: string; model: string; latencyMs: number };
  "chat.failed": { turnId: string; code: ApiErrorCode; message: string };
  /** Показ остановлен. Ответ Foreman всё равно окажется в истории. */
  "chat.cancelled": { turnId: string };
}

export type ApiEventName = keyof ApiEvents;

/**
 * Все имена событий API v0 одним списком.
 *
 * Нужен транспортам: мост доставляет событие с любым именем, а поток
 * `text/event-stream` подписывается поимённо, и забытое имя там означает
 * событие, которое до страницы просто не доходит — молча. Список и тип
 * сверяются компилятором, поэтому новое событие нельзя добавить в контракт и
 * забыть здесь.
 */
export const API_EVENT_NAMES = [
  "metrics.snapshot",
  "mod.inert",
  "api.status",
  "chat.text",
  "chat.tool",
  "chat.done",
  "chat.failed",
  "chat.cancelled",
] as const satisfies readonly ApiEventName[];

/** Имена запросов на мосту — lowerCamelCase, как в конверте (`op`). */
export type ApiOperation =
  | "getStatus"
  | "listMetrics"
  | "listScopes"
  | "queryMetric"
  | "querySeries"
  | "chatSend"
  | "chatCancel"
  | "chatHistory";
