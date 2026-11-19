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

/**
 * Диспетчер, поставленный на страницу. `shared` — общее состояние всех копий
 * модуля: по нему копия узнаёт свой диспетчер и подключается к нему вместо
 * того, чтобы его подменять.
 */
interface Dispatcher {
  receive(message: BridgeInbound): void;
  readonly stray: number;
  readonly shared?: SharedState;
}

interface BridgeGlobals {
  blu_event?: (channel: string, payload: string) => void;
  __ficsitaiBridge?: Dispatcher;
  __ficsitaiBridgeState?: SharedState;
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
   *
   * Операции, которым этого срока мало по протоколу, перечислены в
   * {@link OP_TIMEOUT_MS} и общий срок на них не распространяется.
   */
  timeoutMs?: number;
  /** Сроки отдельных операций — поверх {@link OP_TIMEOUT_MS}. Для проверок. */
  opTimeoutMs?: Readonly<Record<string, number>>;
}

/**
 * Операции, у которых ожидание заложено в протокол.
 *
 * `chatSend` после отмены ждёт у мода до 30 с, пока отменённый ход
 * допишется в историю ([протокол канала](../../../../docs/interfaces/mod-adapter-channel.md#ход-чата),
 * «следующий ход ждёт… до 30 с»). Это согласованное ожидание, а не потеря:
 * мод сам ответит `TURN_DRAINING`, когда срок выйдет. Снять ожидание
 * раньше нельзя — игрок увидел бы ошибку, хотя ход у Foreman уже начался, и
 * повторная отправка ушла бы вторым ходом (ревью Gs на #62, P1-1). Запас
 * поверх 30 с — на дорогу запроса и ответа через мост.
 */
export const OP_TIMEOUT_MS: Readonly<Record<string, number>> = { chatSend: 35_000 };

/**
 * Один диспетчер ответов на страницу.
 *
 * `window.__ficsitaiBridge.receive` в странице ровно один, и второй фасад
 * раньше его подменял: ответы первого уходили в никуда, а его промисы висели
 * вечно (ревью Gs на #53).
 *
 * Состояние диспетчера живёт **на странице**, а не в модуле (повторное ревью
 * Gs на #53): страницу можно собрать так, что модуль загрузится дважды —
 * двумя импортами с разными URL, экраном и виджетом из разных сборок. Копии
 * модуля — разные, страница одна, и ожидающие запросы у них должны быть
 * общие, иначе ответ находит не ту таблицу и запрос висит до срока.
 */
interface Waiting {
  resolve: (value: unknown) => void;
  reject: (error: ApiErrorBody) => void;
  timer: ReturnType<typeof setTimeout>;
  owner: object;
}

interface SharedState {
  pending: Map<string, Waiting>;
  hubs: Set<EventHub>;
  stray: number;
}

/** Общее состояние страницы: первая копия модуля его заводит, остальные берут. */
function shared(): SharedState {
  const existing = globals.__ficsitaiBridgeState;
  if (existing !== undefined) return existing;
  const fresh: SharedState = { pending: new Map(), hubs: new Set(), stray: 0 };
  globals.__ficsitaiBridgeState = fresh;
  return fresh;
}

function receive(message: BridgeInbound): void {
  if (message === null || typeof message !== "object") return;
  const state = shared();

  if (typeof message.re === "string") {
    const waiting = state.pending.get(message.re);
    if (waiting === undefined) {
      // Ответ после перезагрузки страницы или после срока — не ошибка.
      state.stray += 1;
      return;
    }
    state.pending.delete(message.re);
    clearTimeout(waiting.timer);
    if (message.error !== undefined) {
      waiting.reject(toErrorBody(message.error, "TRANSPORT_UNAVAILABLE"));
    } else if (message.body === undefined || message.body === null) {
      // Ни `body`, ни `error` — битый конверт, а не пустой успех. `null` в
      // корне — тоже не форма API (третий круг ревью Gs на #53).
      waiting.reject(transportError("TRANSPORT_UNAVAILABLE", "ответ моста без body и без error"));
    } else {
      waiting.resolve(message.body);
    }
    return;
  }

  if (typeof message.event === "string") {
    for (const hub of state.hubs) hub.emit(message.event, message.data);
  }
}

/**
 * Ставит диспетчер, если на странице нет нашего.
 *
 * «Наш» — тот, у кого то же общее состояние: диспетчер другой копии модуля
 * подходит, и подменять его нечем. Чужой приёмник (его мог поставить другой
 * сценарий страницы) заменяется — состояние при этом сохраняется, поэтому
 * ожидающие запросы не теряются. Вызывается и при каждом запросе: отсюда
 * обещанное README восстановление «со следующего запроса».
 */
function install(): void {
  const state = shared();
  if (globals.__ficsitaiBridge?.shared === state) return;
  globals.__ficsitaiBridge = {
    receive,
    get stray() {
      return state.stray;
    },
    shared: state,
  };
}

export function createBridgeTransport(options: BridgeOptions = {}): Transport {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const opTimeout = (op: string): number =>
    options.opTimeoutMs?.[op] ?? OP_TIMEOUT_MS[op] ?? timeoutMs;
  const prefix = Math.random().toString(36).slice(2, 8);
  const hub = new EventHub();
  const owner = {};
  let seq = 0;
  let closed = false;

  install();
  shared().hubs.add(hub);

  return {
    kind: "bridge",

    async call(op: string, args: Record<string, unknown>): Promise<unknown> {
      if (closed) {
        throw transportError("TRANSPORT_UNAVAILABLE", "фасад закрыт");
      }
      // Приёмник мог подменить другой сценарий страницы — ставим свой снова.
      install();
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

      const state = shared();
      const limit = opTimeout(op);
      return await new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => {
          state.pending.delete(id);
          reject(
            transportError("TRANSPORT_UNAVAILABLE", `мод не ответил на «${op}» за ${limit} мс`),
          );
        }, limit);
        state.pending.set(id, { resolve, reject, timer, owner });
        send(CHANNEL, text);
      });
    },

    on<K extends ApiEventName>(event: K, handler: (data: unknown) => void): () => void {
      return hub.on(event, handler);
    },

    close(): void {
      closed = true;
      const state = shared();
      state.hubs.delete(hub);
      hub.clear();
      // Свои ожидающие запросы завершаем отказом: иначе страница ждала бы
      // ответа, которого уже никто не примет. Чужие — не трогаем: таблица
      // общая на страницу.
      for (const [id, waiting] of [...state.pending]) {
        if (waiting.owner !== owner) continue;
        state.pending.delete(id);
        clearTimeout(waiting.timer);
        waiting.reject(transportError("TRANSPORT_UNAVAILABLE", "фасад закрыт до ответа"));
      }
    },
  };
}

/** Сколько ответов пришло не к своему запросу — видно в отладке страницы. */
export function strayResponses(): number {
  return shared().stray;
}
