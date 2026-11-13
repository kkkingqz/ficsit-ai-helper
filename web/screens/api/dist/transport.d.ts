import type { ApiErrorBody, ApiEventName } from "./types.js";
/**
 * Транспорт фасада: один вызов и подписка на события.
 *
 * Их два — мост в игре (`bridge.ts`) и HTTP в браузере (`http.ts`), — и оба
 * укладываются в этот интерфейс целиком. Это и есть смысл S6: страница не
 * знает, где она работает, а экран пишется один раз.
 */
export interface Transport {
    /** Выполняет запрос API v0. Ошибка приходит отказом промиса с `ApiErrorBody`. */
    call(op: string, args: Record<string, unknown>): Promise<unknown>;
    /** Подписка на событие; возвращает отписку. */
    on<K extends ApiEventName>(event: K, handler: (data: unknown) => void): () => void;
    /** Закрывает транспорт (HTTP — поток событий; мост — ничего). */
    close(): void;
    /** Имя транспорта для статуса и логов. */
    readonly kind: "bridge" | "http";
}
/** Ошибка транспорта в форме контракта: страница ловит всё одним способом. */
export declare function transportError(code: string, message: string): ApiErrorBody;
/** Разбирает что угодно в тело ошибки контракта. */
export declare function toErrorBody(value: unknown, fallbackCode: string): ApiErrorBody;
/** Простая раздача событий по именам — общая для обоих транспортов. */
export declare class EventHub {
    private readonly listeners;
    on(event: string, handler: (data: unknown) => void): () => void;
    emit(event: string, data: unknown): void;
    clear(): void;
}
