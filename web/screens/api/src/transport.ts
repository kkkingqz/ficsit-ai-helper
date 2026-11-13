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
export function transportError(code: string, message: string): ApiErrorBody {
  return { code, message };
}

/** Разбирает что угодно в тело ошибки контракта. */
export function toErrorBody(value: unknown, fallbackCode: string): ApiErrorBody {
  if (typeof value === "object" && value !== null) {
    const raw = value as Record<string, unknown>;
    const code = typeof raw.code === "string" ? raw.code : fallbackCode;
    const message = typeof raw.message === "string" ? raw.message : String(value);
    const body: ApiErrorBody = { code, message };
    if (typeof raw.details === "object" && raw.details !== null) {
      body.details = raw.details as Record<string, unknown>;
    }
    return body;
  }
  return { code: fallbackCode, message: value instanceof Error ? value.message : String(value) };
}

/** Простая раздача событий по именам — общая для обоих транспортов. */
export class EventHub {
  private readonly listeners = new Map<string, Set<(data: unknown) => void>>();

  public on(event: string, handler: (data: unknown) => void): () => void {
    const set = this.listeners.get(event) ?? new Set();
    set.add(handler);
    this.listeners.set(event, set);
    return () => {
      set.delete(handler);
    };
  }

  public emit(event: string, data: unknown): void {
    for (const handler of this.listeners.get(event) ?? []) {
      try {
        handler(data);
      } catch {
        // Ошибка одного подписчика не должна глушить остальных и транспорт.
      }
    }
  }

  public clear(): void {
    this.listeners.clear();
  }
}
