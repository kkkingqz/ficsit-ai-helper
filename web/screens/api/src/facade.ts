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

/** Непустая строка: пустая в контракте значит «поля нет». */
function filled(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

/**
 * Приводит в согласие два поля расхождения версий.
 *
 * Контракт (§События): причина лежит и в `apiVersionMismatch`, и в `reason`,
 * и у чтения, и у события — источник один, поэтому подписавшийся после
 * перехода получает её первым же чтением. Раньше заполнялось только первое
 * поле и только у чтения, и статус с пустым `reason` приходил на экран без
 * согласованной причины (повторное ревью Gs на #53).
 *
 * У события поля `apiVersion` нет (`api.status` его не несёт): расхождение
 * там находит мод, а фасаду остаётся не потерять причину.
 */
function alignVersionReason<T extends Partial<ApiStatus>>(status: T): T {
  const stated = filled(status.apiVersionMismatch) ? status.apiVersionMismatch : undefined;
  const computed =
    filled(status.apiVersion) && major(status.apiVersion) !== major(API_VERSION)
      ? `страница собрана на API ${API_VERSION}, мод отдаёт ${status.apiVersion}`
      : undefined;
  const mismatch = stated ?? computed;
  if (mismatch === undefined) return status;
  return {
    ...status,
    apiVersionMismatch: mismatch,
    reason: filled(status.reason) ? status.reason : mismatch,
  };
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
      const body = await transport.call(op, args);
      // Все формы API v0 — объекты. `body: null` транспорт считал успехом, и
      // страница падала сырым `TypeError` на первом же поле вместо кода
      // (третий круг ревью Gs на #53). Проверка стоит здесь, а не только в
      // транспортах: экран может принести свой `transport`.
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        throw new ApiError({
          code: "TRANSPORT_UNAVAILABLE",
          message: `ответ на «${op}» не похож на форму API: ${typeof body}`,
        });
      }
      return body as T;
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
      // Не бросаем: по §5.5 при несовпадении мажора ручные функции продолжают
      // работать, а видимое сообщение — дело экрана. Поэтому расхождение
      // возвращается в статусе, а не прячется в исключении.
      return checkVersion ? alignVersionReason(status) : status;
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
      return transport.on(event, (data) => {
        // `api.status` — тот же статус, что у чтения, и причина расхождения
        // должна быть той же (§События).
        const payload =
          checkVersion && event === "api.status" && typeof data === "object" && data !== null
            ? alignVersionReason(data as Partial<ApiStatus>)
            : data;
        handler(payload as ApiEvents[K]);
      });
    },

    close(): void {
      transport.close();
    },
  };
}
