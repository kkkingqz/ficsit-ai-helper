import { type Transport } from "./transport.js";
/**
 * Транспорт в браузере: HTTP к dev-серверу (S6, Screen Lab).
 *
 * Конверт тот же, что на мосту, — `{ id, op, args }` в теле `POST` и
 * `{ re, body }` либо `{ re, error }` в ответе. Одинаковый конверт выбран
 * нарочно: экран, отлаженный в браузере, не встречает в игре другой формы,
 * а разница между средами остаётся в одном файле на транспорт.
 *
 * События приходят потоком `text/event-stream`: `EventSource` есть в любом
 * браузере, и переподключение он делает сам.
 */
export interface HttpOptions {
    /** Корень dev-сервера. По умолчанию — тот, откуда открыта страница. */
    baseUrl?: string;
    /** Подписываться ли на поток событий. Для разовых проверок не нужно. */
    events?: boolean;
    fetchImpl?: typeof fetch;
}
export declare function createHttpTransport(options?: HttpOptions): Transport;
