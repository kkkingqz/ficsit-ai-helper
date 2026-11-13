import type { ApiErrorBody, ApiStatus, ListMetricsArgs, ListMetricsResult, ListScopesArgs, ListScopesResult, MetricSeries, MetricValue, QueryMetricArgs, QuerySeriesArgs } from "../types.js";
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
    /** Необязательная подписка: источник сам шлёт события API v0. */
    subscribe?(emit: (event: string, data: unknown) => void): () => void;
}
/** Ошибка в форме контракта — её источник бросает, сервер отдаёт как есть. */
export declare class SourceError extends Error {
    readonly body: ApiErrorBody;
    constructor(code: string, message: string, details?: Record<string, unknown>);
}
