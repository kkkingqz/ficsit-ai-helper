import { EventHub, toErrorBody, transportError, type Transport } from "./transport.js";
import type { ApiErrorBody, ApiEventName } from "./types.js";

/**
 * Транспорт в игре: мост страница ↔ мод
 * ([web-runtime-plugin.md](../../../../docs/interfaces/web-runtime-plugin.md#конверт--для-фасада-co2)).
 *
 * - Страница → мод: `blu_event("ficsitai.bridge", JSON)` с конвертом `{ id, op, args }`.
 * - Мод → страница: вызов `window.__ficsitaiBridge.receive(конверт)`;
 *   ответ — `{ re, body }` или `{ re, error }`, событие — `{ event, data }`.
 *
 * Три правила моста, которые соблюдает именно фасад, а не мод:
 *
 * 1. **`id` уникален на странице** — случайный префикс плюс счётчик. После
 *    перезагрузки ответ прежней страницы не попадёт в новую.
 * 2. **Предел 64 КиБ проверяем сами.** Конверт больше мод отбрасывает
 *    молча, без ответа, поэтому запрос не должен уходить: иначе промис
 *    висит вечно. Отказ — `TOO_LARGE`, локально.
 * 3. **Ответ с незнакомым `re` пропускается.** Это не ошибка: так выглядят
 *    ответы, пришедшие после перезагрузки страницы или после таймаута.
 */

const MAX_REQUEST_BYTES = 64 * 1024;

/** Имя канала `blu_event`, на которое подписан плагин. */
const CHANNEL = "ficsitai.bridge";

interface BridgeInbound {
  re?: string;
  body?: unknown;
  error?: unknown;
  event?: string;
  data?: unknown;
}

interface BridgeGlobals {
  blu_event?: (channel: string, payload: string) => void;
  __ficsitaiBridge?: { receive(message: BridgeInbound): void; stray: number };
}

const globals = globalThis as unknown as BridgeGlobals;

/** Доступен ли мост: страница открыта в игре, а не в браузере. */
export function bridgeAvailable(): boolean {
  return typeof globals.blu_event === "function";
}

export interface BridgeOptions {
  /**
   * Сколько ждать ответа моста. Мост отвечает за кадр (замер S8: медиана
   * 13 мс), поэтому молчание дольше секунд — это не медленно, а потеряно:
   * испорченный конверт мод отбрасывает без ответа. Без срока промис висел
   * бы вечно и экран замер бы молча.
   */
  timeoutMs?: number;
}

/**
 * Один диспетчер ответов на страницу.
 *
 * `window.__ficsitaiBridge.receive` в странице ровно один, и второй фасад
 * раньше его подменял: ответы первого уходили в никуда, а его промисы висели
 * вечно (ревью Gs на #53). Поэтому диспетчер живёт в модуле, а фасады к нему
 * подключаются и отключаются.
 */
interface Waiting {
  resolve: (value: unknown) => void;
  reject: (error: ApiErrorBody) => void;
  timer: ReturnType<typeof setTimeout>;
  owner: object;
}

const pending = new Map<string, Waiting>();
const hubs = new Set<EventHub>();
let stray = 0;

function receive(message: BridgeInbound): void {
  if (message === null || typeof message !== "object") return;

  if (typeof message.re === "string") {
    const waiting = pending.get(message.re);
    if (waiting === undefined) {
      // Ответ после перезагрузки страницы или после срока — не ошибка.
      stray += 1;
      return;
    }
    pending.delete(message.re);
    clearTimeout(waiting.timer);
    if (message.error !== undefined) {
      waiting.reject(toErrorBody(message.error, "TRANSPORT_UNAVAILABLE"));
    } else {
      waiting.resolve(message.body);
    }
    return;
  }

  if (typeof message.event === "string") {
    for (const hub of hubs) hub.emit(message.event, message.data);
  }
}

/**
 * Ставит диспетчер, если его нет или он чужой. Проверка по самой функции, а
 * не по флагу: страницу мог перезаписать другой сценарий, и тогда ответы
 * уходили бы в никуда молча.
 */
function install(): void {
  if (globals.__ficsitaiBridge?.receive === receive) return;
  globals.__ficsitaiBridge = {
    receive,
    get stray() {
      return stray;
    },
  };
}

export function createBridgeTransport(options: BridgeOptions = {}): Transport {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const prefix = Math.random().toString(36).slice(2, 8);
  const hub = new EventHub();
  const owner = {};
  let seq = 0;
  let closed = false;

  install();
  hubs.add(hub);

  return {
    kind: "bridge",

    async call(op: string, args: Record<string, unknown>): Promise<unknown> {
      if (closed) {
        throw transportError("TRANSPORT_UNAVAILABLE", "фасад закрыт");
      }
      const send = globals.blu_event;
      if (typeof send !== "function") {
        throw transportError("TRANSPORT_UNAVAILABLE", "мост недоступен: страница открыта не в игре");
      }

      seq += 1;
      const id = `${prefix}-${seq}`;
      const text = JSON.stringify({ id, op, args });
      if (new TextEncoder().encode(text).length > MAX_REQUEST_BYTES) {
        throw transportError("TOO_LARGE", "запрос больше 64 КиБ: мост отбросит его без ответа");
      }

      return await new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(
            transportError("TRANSPORT_UNAVAILABLE", `мод не ответил на «${op}» за ${timeoutMs} мс`),
          );
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer, owner });
        send(CHANNEL, text);
      });
    },

    on<K extends ApiEventName>(event: K, handler: (data: unknown) => void): () => void {
      return hub.on(event, handler);
    },

    close(): void {
      closed = true;
      hubs.delete(hub);
      hub.clear();
      // Свои ожидающие запросы завершаем отказом: иначе страница ждала бы
      // ответа, которого уже никто не примет.
      for (const [id, waiting] of [...pending]) {
        if (waiting.owner !== owner) continue;
        pending.delete(id);
        clearTimeout(waiting.timer);
        waiting.reject(transportError("TRANSPORT_UNAVAILABLE", "фасад закрыт до ответа"));
      }
    },
  };
}

/** Сколько ответов пришло не к своему запросу — видно в отладке страницы. */
export function strayResponses(): number {
  return stray;
}
