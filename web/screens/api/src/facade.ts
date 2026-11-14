import { bridgeAvailable, createBridgeTransport } from "./bridge.js";
import { createHttpTransport } from "./http.js";
import type { Transport } from "./transport.js";
import {
  API_VERSION,
  ApiError,
  type ApiEventName,
  type ApiEvents,
  type ApiStatus,
  type ListMetricsArgs,
  type ListMetricsResult,
  type ListScopesArgs,
  type ListScopesResult,
  type MetricSeries,
  type MetricValue,
  type QueryMetricArgs,
  type QuerySeriesArgs,
} from "./types.js";

/**
 * Фасад API для экранов (S6, [#12](https://github.com/kkkingqz/ficsit-ai-helper/issues/12)).
 *
 * Один интерфейс поверх двух транспортов: мост к `FicsitAIApi` в игре и HTTP
 * к dev-серверу в браузере. Экран пишется один раз и отлаживается в браузере
 * (ARCHITECTURE §13, ADR-026, ADR-032).
 *
 * Чего фасад **не** делает, и это важнее того, что делает:
 *
 * - **не придумывает данные.** Нет ни кэша, ни значений по умолчанию, ни
 *   повторов запроса: ответ отдаётся как пришёл. Там, где экран показывает
 *   прочерк, прочерк и пришёл (`state: "notApplicable"`, §Gs-13);
 * - **не разбирает формы контракта.** Ответ типизирован, но не перекладывается
 *   в свои структуры: вторая форма — это вторая правда при каждой правке
 *   контракта;
 * - **не хранит состояние мода.** Статус запрашивается, события приходят;
 *   страница сама решает, что из этого показать.
 */

export interface FicsitAIApi {
  readonly transport: Transport["kind"];
  getStatus(): Promise<ApiStatus>;
  listMetrics(args?: ListMetricsArgs): Promise<ListMetricsResult>;
  listScopes(args: ListScopesArgs): Promise<ListScopesResult>;
  queryMetric(args: QueryMetricArgs): Promise<MetricValue>;
  querySeries(args: QuerySeriesArgs): Promise<MetricSeries>;
  /** Подписка на событие API v0; возвращает отписку. */
  on<K extends ApiEventName>(event: K, handler: (data: ApiEvents[K]) => void): () => void;
  close(): void;
}

export interface CreateApiOptions {
  /** Готовый транспорт. Без него выбирается по среде: мост в игре, HTTP в браузере. */
  transport?: Transport;
  /** Корень dev-сервера для HTTP-транспорта. */
  baseUrl?: string;
  /** Проверять ли мажорную версию API при первом `getStatus` (§5.5). */
  checkApiVersion?: boolean;
}

/** Мажорная часть версии: расходится мажор — AI-функции отключаются (§5.5). */
function major(version: string): string {
  return version.split(".", 1)[0] ?? version;
}

export function createApi(options: CreateApiOptions = {}): FicsitAIApi {
  const transport =
    options.transport ??
    (bridgeAvailable()
      ? createBridgeTransport()
      : createHttpTransport(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }));
  const checkVersion = options.checkApiVersion ?? true;

  const call = async <T>(op: string, args: Record<string, unknown>): Promise<T> => {
    try {
      return (await transport.call(op, args)) as T;
    } catch (err: unknown) {
      // Единая форма наружу: страница ловит `ApiError` и читает `code`.
      if (err instanceof ApiError) throw err;
      const body =
        typeof err === "object" && err !== null && "code" in err
          ? (err as { code: string; message?: string; details?: Record<string, unknown> })
          : { code: "TRANSPORT_UNAVAILABLE", message: String(err) };
      throw new ApiError({
        code: body.code,
        message: body.message ?? "",
        ...(body.details === undefined ? {} : { details: body.details }),
      });
    }
  };

  return {
    transport: transport.kind,

    async getStatus(): Promise<ApiStatus> {
      const status = await call<ApiStatus>("getStatus", {});
      if (checkVersion && major(status.apiVersion) !== major(API_VERSION)) {
        // Не бросаем: по §5.5 при несовпадении мажора ручные функции
        // продолжают работать, а видимое сообщение — дело экрана. Поэтому
        // расхождение возвращается в статусе, а не прячется в исключении.
        return {
          ...status,
          apiVersionMismatch:
            status.apiVersionMismatch === ""
              ? `страница собрана на API ${API_VERSION}, мод отдаёт ${status.apiVersion}`
              : status.apiVersionMismatch,
        };
      }
      return status;
    },

    async listMetrics(args: ListMetricsArgs = {}): Promise<ListMetricsResult> {
      return await call<ListMetricsResult>("listMetrics", { ...args });
    },

    async listScopes(args: ListScopesArgs): Promise<ListScopesResult> {
      return await call<ListScopesResult>("listScopes", { ...args });
    },

    async queryMetric(args: QueryMetricArgs): Promise<MetricValue> {
      return await call<MetricValue>("queryMetric", { ...args });
    },

    async querySeries(args: QuerySeriesArgs): Promise<MetricSeries> {
      return await call<MetricSeries>("querySeries", { ...args });
    },

    on<K extends ApiEventName>(event: K, handler: (data: ApiEvents[K]) => void): () => void {
      return transport.on(event, (data) => handler(data as ApiEvents[K]));
    },

    close(): void {
      transport.close();
    },
  };
}
