import { EventHub, toErrorBody, transportError, type Transport } from "./transport.js";
import type { ApiEventName } from "./types.js";

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
  /**
   * Своя реализация `EventSource`. В браузере она своя и ничего задавать не
   * надо; в Node её нет вовсе, поэтому поток событий иначе не проверить.
   */
  eventSourceImpl?: new (url: string) => EventSourceLike;
}

export interface EventSourceLike {
  addEventListener(type: string, handler: (event: { data?: string }) => void): void;
  close(): void;
}

export function createHttpTransport(options: HttpOptions = {}): Transport {
  const base = (options.baseUrl ?? "").replace(/\/+$/, "");
  const doFetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const hub = new EventHub();
  let seq = 0;
  const prefix = Math.random().toString(36).slice(2, 8);
  let stream: EventSourceLike | undefined;

  if (options.events !== false) {
    const Source =
      options.eventSourceImpl ??
      (globalThis as { EventSource?: new (url: string) => EventSourceLike }).EventSource;
    if (Source !== undefined) {
      stream = new Source(`${base}/api/v0/events`);
      // Имена событий API v0 — это и есть имена событий потока.
      for (const name of ["metrics.snapshot", "mod.inert", "api.status"]) {
        stream.addEventListener(name, (event) => {
          try {
            hub.emit(name, JSON.parse(event.data ?? "null"));
          } catch {
            hub.emit(name, undefined);
          }
        });
      }
    }
  }

  return {
    kind: "http",

    async call(op: string, args: Record<string, unknown>): Promise<unknown> {
      seq += 1;
      const id = `${prefix}-${seq}`;
      let response: Response;
      try {
        response = await doFetch(`${base}/api/v0`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id, op, args }),
        });
      } catch (err: unknown) {
        // Источник не поднят или страница открыта не с dev-сервера.
        throw toErrorBody(err, "TRANSPORT_UNAVAILABLE");
      }

      let payload: { re?: string; body?: unknown; error?: unknown };
      try {
        payload = (await response.json()) as typeof payload;
      } catch (err: unknown) {
        throw toErrorBody(err, "TRANSPORT_UNAVAILABLE");
      }

      if (payload.error !== undefined) {
        throw toErrorBody(payload.error, "TRANSPORT_UNAVAILABLE");
      }
      if (!response.ok) {
        throw transportError("TRANSPORT_UNAVAILABLE", `dev-сервер ответил ${response.status}`);
      }
      return payload.body;
    },

    on<K extends ApiEventName>(event: K, handler: (data: unknown) => void): () => void {
      return hub.on(event, handler);
    },

    close(): void {
      stream?.close();
      hub.clear();
    },
  };
}
