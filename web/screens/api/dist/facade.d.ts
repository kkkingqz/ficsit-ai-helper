import type { Transport } from "./transport.js";
import { type ApiEventName, type ApiEvents, type ApiStatus, type ListMetricsArgs, type ListMetricsResult, type ListScopesArgs, type ListScopesResult, type MetricSeries, type MetricValue, type QueryMetricArgs, type QuerySeriesArgs } from "./types.js";
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
export declare function createApi(options?: CreateApiOptions): FicsitAIApi;
