import type {
  ApiErrorBody,
  ApiStatus,
  ChatCancelArgs,
  ChatCancelResult,
  ChatHistoryArgs,
  ChatHistoryResult,
  ChatSendArgs,
  ChatSendResult,
  ListMetricsArgs,
  ListMetricsResult,
  ListScopesArgs,
  ListScopesResult,
  MetricSeries,
  MetricValue,
  QueryMetricArgs,
  QuerySeriesArgs,
} from "../types.js";

/**
 * Источник данных для dev-сервера: ровно запросы API v0 и ничего сверх.
 *
 * Наборы Fixture и проигрыватель Recording — работа Gf2, источник Save —
 * пакет Cf3 (`sidecar/save-source/`). Dev-сервер их не содержит, он их
 * подключает: источник — это объект с пятью методами, а откуда он взялся,
 * серверу всё равно.
 */
export interface DevSource {
  readonly name: string;
  getStatus(): Promise<ApiStatus> | ApiStatus;
  listMetrics(args: ListMetricsArgs): Promise<ListMetricsResult> | ListMetricsResult;
  listScopes(args: ListScopesArgs): Promise<ListScopesResult> | ListScopesResult;
  queryMetric(args: QueryMetricArgs): Promise<MetricValue> | MetricValue;
  querySeries(args: QuerySeriesArgs): Promise<MetricSeries> | MetricSeries;
  /**
   * Чат (0.5.0) — необязательная часть источника. У наборов Fixture, записи и
   * сохранения ассистента нет, и это не пробел, а правда: без связи с
   * сайдкаром контракт требует отвечать `SIDECAR_UNAVAILABLE` сразу. Сервер
   * так и отвечает за источник, который этих методов не реализует.
   */
  chatSend?(args: ChatSendArgs): Promise<ChatSendResult> | ChatSendResult;
  chatCancel?(args: ChatCancelArgs): Promise<ChatCancelResult> | ChatCancelResult;
  chatHistory?(args: ChatHistoryArgs): Promise<ChatHistoryResult> | ChatHistoryResult;
  /** Необязательная подписка: источник сам шлёт события API v0. */
  subscribe?(emit: (event: string, data: unknown) => void): () => void;
}

/** Ошибка в форме контракта — её источник бросает, сервер отдаёт как есть. */
export class SourceError extends Error {
  public readonly body: ApiErrorBody;

  public constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "SourceError";
    this.body = details === undefined ? { code, message } : { code, message, details };
  }
}
