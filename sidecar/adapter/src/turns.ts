import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ForemanError, playthroughIdFor, type ForemanSession } from "./foreman.js";
import type { Logger } from "./log.js";
import { parseSse } from "./stream.js";

/**
 * Ходы чата: поток, отмена, история (S2, задача #10).
 *
 * Поверх `POST /api/playthroughs/:id/chat` Foreman, который отвечает SSE.
 * Здесь только машина ходов, без транспорта: наружу она смотрит через
 * {@link TurnEvents}, а кто их разносит — канал мода (`channel.ts`) — её не
 * касается. Так протокол канала (`docs/interfaces/mod-adapter-channel.md`)
 * меняет входы, не трогая смысл хода.
 *
 * Чего в этой машине нет и почему:
 *
 * - **Отмены у Foreman.** Ни `AbortSignal`, ни `res.on('close')` в его
 *   маршруте — проверено по исходникам 12.11.2026. Поэтому отмена наша: мод
 *   перестаёт получать события сразу, а поток к Foreman **дочитывается**.
 *   Живая проверка 12.11.2026 показала, зачем: Foreman пишет сообщение игрока
 *   до начала потока, а ответ — после, и брошенный ход дописывал ответ уже
 *   после следующего вопроса. История складывалась «вопрос — вопрос — ответ —
 *   ответ», и следующий ход уходил к модели с перепутанным разговором.
 * - **Двух ходов на сохранение.** Второй запрос получает `TURN_IN_PROGRESS`.
 */

/** Сколько новый ход ждёт, пока дочитается отменённый (протокол, §Ход чата). */
const DRAIN_WAIT_MS = 30_000;

/** Предел на дочитывание брошенного хода: страховка от молчащего провайдера. */
const DRAIN_LIMIT_MS = 5 * 60_000;

/** Длина текста хода — предел из README адаптера, его же отдаёт рукопожатие. */
export const MAX_CHAT_TEXT = 8000;

/**
 * Сколько связей «запись → ход» помнить на playthrough.
 *
 * Связь живёт в памяти адаптера и переживает конец хода, но не перезапуск
 * процесса: у Foreman этих номеров нет, он их не хранит и не возвращает.
 * Предел — чтобы долгий разговор не рос без границ; вытесняются самые старые,
 * а они и так уже уехали за хвост истории.
 */
const MAX_TURN_LINKS = 200;

/**
 * Срок на чтение записей для связывания.
 *
 * Своего срока у `request()` нет, а чтение «что было до хода» стоит перед
 * отправкой: без предела молчащий Foreman подвесил бы ход целиком, и игрок
 * не увидел бы даже первого слова. Номер записи дешевле хода, поэтому срок
 * короткий и его истечение — не ошибка, а «номера не будет».
 */
const LINK_READ_MS = 2000;

/** История: до 100 сообщений (протокол), по умолчанию 50. */
export const MAX_HISTORY_LIMIT = 100;
export const DEFAULT_HISTORY_LIMIT = 50;

export const chatSendSchema = z.object({
  saveId: z.string().min(1).max(128),
  saveName: z.string().min(1).max(200).optional(),
  text: z.string().min(1).max(MAX_CHAT_TEXT),
});

export const chatCancelSchema = z.object({
  saveId: z.string().min(1).max(128),
  turnId: z.string().min(1).max(64),
});

export const chatHistorySchema = z.object({
  saveId: z.string().min(1).max(128),
  limit: z.coerce.number().int().min(1).max(MAX_HISTORY_LIMIT).optional(),
});

export type TurnErrorCode =
  | "CHANNEL_RESET"
  | "TURN_IN_PROGRESS"
  | "TURN_DRAINING"
  | "NO_TURN"
  | "TURN_MISMATCH"
  | "FOREMAN_UNAVAILABLE"
  | "INVALID_ARGUMENT";

export class TurnError extends Error {
  public constructor(
    public readonly code: TurnErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TurnError";
  }
}

/**
 * Кто попросил ход. Нужен, чтобы ход остался привязан к своей сессии канала:
 * запрос вытесненной сессии не должен ни начинать ход, ни отдавать её
 * сохранение в вызов инструмента следующей сессии (ревью Gs на #51).
 */
export interface TurnOwner {
  id: string;
  /** Жива ли ещё сессия, от имени которой начат ход. */
  active(): boolean;
}

/** Что ход сообщает наружу. Имена событий Foreman сюда не доходят. */
export interface TurnEvents {
  text(turnId: string, text: string): void;
  tool(turnId: string, name: string): void;
  done(turnId: string, latencyMs: number): void;
  failed(turnId: string, code: string, message: string): void;
  cancelled(turnId: string): void;
}

export interface HistoryMessage {
  id: string;
  role: string;
  text: string;
  createdAt: string;
  /**
   * Ход, которому принадлежит запись, — если адаптер его знает.
   *
   * Необязательное по протоколу (`chat.history`, добавлено Co-129). Номера
   * нет у записей, сделанных до запуска адаптера, и у записей, пришедших в
   * playthrough мимо хода: лучше честное «номера нет», чем угаданный.
   */
  turnId?: string;
}

interface StoredMessage {
  id: string;
  role: string;
  content: string;
  createdAt: string;
}

interface Turn {
  id: string;
  /** Сессия канала, которой принадлежит ход; пусто — ход без канала. */
  ownerId: string;
  saveId: string;
  playthroughId: string;
  controller: AbortController;
  /** Мод уже не слушает: события не разносятся, поток к Foreman дочитывается. */
  cancelled: boolean;
  /** Исполнится, когда ход дочитан и сохранение свободно. */
  drained: Promise<void>;
  /**
   * Идентификаторы записей истории, бывшие до хода.
   *
   * По ним в конце хода видно, какие записи он добавил. Foreman не
   * возвращает идентификатор при записи (его `appendMessage` отдаёт их
   * только в базу), а связывать ход с записью по тексту нельзя — это и есть
   * указание Co-129. Чтение не удалось — номера у записей этого хода не
   * будет, и это правильнее догадки.
   */
  idsBefore?: ReadonlySet<string> | undefined;
}

export class ChatTurns {
  /** Идущие ходы по playthrough: не больше одного на сохранение. */
  private readonly turns = new Map<string, Turn>();

  /**
   * Запись истории → ход, который её добавил: `playthroughId` → `id` → `turnId`.
   *
   * Источник номера — адаптер, по ходу, который он сам ведёт (Co-129). Связь
   * ставится по идентификаторам записей, появившихся за время хода, и только
   * когда их состав совпадает с ожидаемым: вопрос игрока и, если модель
   * ответила, её ответ. Всё остальное — чужая запись в тот же playthrough, и
   * тогда номер не ставится никому.
   */
  private readonly linkedTurns = new Map<string, Map<string, string>>();

  public constructor(
    private readonly foreman: ForemanSession,
    private readonly log: Logger,
  ) {}

  /**
   * Ходы, которые прямо сейчас идут или дочитываются, — вместе с сессией, в
   * которой начались. По ним канал решает, кому адресован вызов инструмента:
   * один ход — его `saveId`, несколько — `AMBIGUOUS_TURN` (протокол, §Вызов
   * инструмента).
   *
   * Сессия здесь обязательна и не фильтруется (повторное ревью Gs на #51):
   * ход живёт до своего конца, а канал под ним может смениться, и вызов
   * начатого хода нельзя отдавать новой сессии — она ответит числом из
   * другого мира.
   */
  public liveTurns(): { saveId: string; ownerId: string }[] {
    const seen = new Set<string>();
    const live: { saveId: string; ownerId: string }[] = [];
    for (const turn of this.turns.values()) {
      if (seen.has(turn.saveId)) continue;
      seen.add(turn.saveId);
      live.push({ saveId: turn.saveId, ownerId: turn.ownerId });
    }
    return live;
  }

  private async playthroughFor(saveId: string, saveName?: string): Promise<string> {
    try {
      return await this.foreman.resolvePlaythrough(saveId, saveName);
    } catch (err: unknown) {
      const detail = err instanceof ForemanError ? err.message : String(err);
      throw new TurnError("FOREMAN_UNAVAILABLE", `Foreman недоступен: ${detail}`);
    }
  }

  /**
   * Начинает ход и возвращает его идентификатор. Остальное приходит событиями:
   * ответ модели идёт потоком, и ждать его здесь нечему.
   */
  public async start(
    args: z.infer<typeof chatSendSchema>,
    events: TurnEvents,
    owner?: TurnOwner,
  ): Promise<string> {
    const playthroughId = await this.playthroughFor(args.saveId, args.saveName);

    // Слот занимается сразу после ожидания и с повторной проверкой: два
    // запроса, ждавших один и тот же `drained`, иначе просыпались вместе и
    // оба занимали один слот (ревью Gs на #50 и #51).
    const deadline = Date.now() + DRAIN_WAIT_MS;
    for (;;) {
      const running = this.turns.get(playthroughId);
      if (running === undefined) break;

      if (!running.cancelled) {
        throw new TurnError("TURN_IN_PROGRESS", "ход уже идёт: дождитесь конца или отмените");
      }
      // Предыдущий ход отменён и дочитывается. Ждём его, а не отказываем:
      // начать раньше нельзя — ответ брошенного хода ещё не лёг в историю.
      const left = deadline - Date.now();
      const freed =
        left > 0 &&
        (await Promise.race([
          running.drained.then(() => true),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), left)),
        ]));
      if (!freed) {
        throw new TurnError("TURN_DRAINING", "отменённый ход всё ещё дописывается в историю");
      }
    }

    // Пока мы ждали Foreman и слот, сессия могла уехать. Ход вытесненной
    // сессии не начинаем вовсе: иначе он пойдёт в Foreman, а его вызов
    // инструмента уедет в следующую сессию с чужим сохранением.
    if (owner !== undefined && !owner.active()) {
      throw new TurnError("CHANNEL_RESET", "связь с игрой переустановлена, ход не начат");
    }

    let release = (): void => {};
    const turn: Turn = {
      id: `t-${randomUUID()}`,
      ownerId: owner?.id ?? "",
      saveId: args.saveId,
      playthroughId,
      controller: new AbortController(),
      cancelled: false,
      drained: new Promise<void>((resolve) => {
        release = resolve;
      }),
    };
    this.turns.set(playthroughId, turn);

    void this.run(turn, args.text, events, release);
    return turn.id;
  }

  private async run(
    turn: Turn,
    text: string,
    events: TurnEvents,
    release: () => void,
  ): Promise<void> {
    const started = Date.now();
    // Брошенный ход не держим вечно: провайдер может молчать, а сохранение
    // остаётся занятым.
    const limit = setTimeout(() => turn.controller.abort(), DRAIN_LIMIT_MS);

    // Запись игрока Foreman делает до начала потока, поэтому читать «что
    // было» нужно до отправки. Слот уже занят, и чужой ход в этот зазор не
    // влезет.
    turn.idsBefore = await this.idsBefore(turn.playthroughId);

    try {
      const upstream = await this.foreman.request(
        `/api/playthroughs/${turn.playthroughId}/chat`,
        {
          method: "POST",
          headers: { "content-type": "application/json", accept: "text/event-stream" },
          body: JSON.stringify({ message: text }),
          signal: turn.controller.signal,
        },
      );

      if (!upstream.ok || upstream.body === null) {
        const detail = upstream.body === null ? "" : await upstream.text().catch(() => "");
        this.log.warn(`чат Foreman ответил ${upstream.status}`);
        if (!turn.cancelled) {
          events.failed(
            turn.id,
            "FOREMAN_ERROR",
            `Foreman ответил ${upstream.status}${detail === "" ? "" : `: ${detail.slice(0, 300)}`}`,
          );
        }
        return;
      }

      let finished = false;
      for await (const event of parseSse(upstream.body)) {
        if (event.event === "done" || event.event === "error") finished = true;
        // Поток дочитывается и после отмены, но наружу больше ничего не идёт.
        if (turn.cancelled) continue;
        this.relay(turn, event.event, event.data, events, started);
      }
      if (turn.cancelled) {
        this.log.info(`отменённый ход ${turn.id} дочитан`);
      } else if (!finished) {
        // Поток кончился без `done` и без `error`: мод остался бы с ходом
        // без конца и ждал бы его вечно (ревью Gs на #50).
        this.log.warn(`поток чата оборвался без конца хода (${turn.id})`);
        events.failed(turn.id, "FOREMAN_ERROR", "Foreman закрыл поток, не закончив ход");
      }
    } catch (err: unknown) {
      if (turn.controller.signal.aborted) {
        this.log.warn(`ход ${turn.id} брошен по пределу ожидания`);
        if (!turn.cancelled) {
          events.failed(
            turn.id,
            "FOREMAN_ERROR",
            "ход прерван: Foreman не закончил его за отведённое время",
          );
        }
      } else {
        this.log.error("ход чата сорвался", err);
        if (!turn.cancelled) {
          events.failed(turn.id, "FOREMAN_ERROR", err instanceof Error ? err.message : String(err));
        }
      }
    } finally {
      clearTimeout(limit);
      // Связываем после дочитывания, и для отменённого хода тоже — ради него
      // это и нужно: его ответ лёг в историю, а в ленте остался обрубок, и
      // экрану нужно знать, какая запись его заменяет.
      await this.linkTurn(turn);
      // Снимаем только свою запись: чужой ход, занявший слот, не наш.
      if (this.turns.get(turn.playthroughId) === turn) this.turns.delete(turn.playthroughId);
      release();
    }
  }

  /**
   * Перевод событий Foreman в события канала. Имена Foreman наружу не выходят
   * (§3.3 п. 3: изменения его API гасятся в одном месте).
   */
  private relay(
    turn: Turn,
    name: string,
    raw: string,
    events: TurnEvents,
    started: number,
  ): void {
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      // Тело не JSON: для `text` это всё равно кусок ответа, остальное пропустим.
    }

    switch (name) {
      case "text": {
        const delta = typeof data.delta === "string" ? data.delta : "";
        if (delta !== "") events.text(turn.id, delta);
        return;
      }
      case "tool_use": {
        const tool = typeof data.name === "string" ? data.name : "";
        if (tool !== "") events.tool(turn.id, tool);
        return;
      }
      case "done":
        events.done(turn.id, Date.now() - started);
        return;
      case "error": {
        const message = typeof data.message === "string" ? data.message : raw;
        events.failed(turn.id, "FOREMAN_ERROR", message);
        return;
      }
      case "work_order":
        // Экран Work Orders — Milestone 2; в v0.1 заказ только в логе.
        this.log.info(`Foreman выдал work order в ходе ${turn.id}`);
        return;
      default:
        this.log.debug(`неизвестное событие Foreman «${name}» пропущено`);
    }
  }

  /** Останавливает вещание хода. Foreman его доигрывает (см. шапку файла). */
  public async cancel(
    args: z.infer<typeof chatCancelSchema>,
    events: TurnEvents,
  ): Promise<"cancelled" | "alreadyCancelled"> {
    // Отмена не зависит от Foreman: идентификатор считается из `saveId`, а
    // идущий ход лежит в памяти. Раньше здесь был запрос к Foreman, и при
    // его недоступности отмена отвечала ошибкой, оставляя поток открытым
    // (ревью Gs на #50).
    const playthroughId = playthroughIdFor(args.saveId);
    const turn = this.turns.get(playthroughId);
    if (turn === undefined) {
      throw new TurnError("NO_TURN", "идущего хода нет");
    }
    if (turn.id !== args.turnId) {
      // Отмена «того хода» после того, как он кончился и начался следующий,
      // иначе оборвала бы чужой ответ.
      throw new TurnError("TURN_MISMATCH", `идёт другой ход: ${turn.id}`);
    }
    if (turn.cancelled) return "alreadyCancelled";

    turn.cancelled = true;
    this.log.info(`ход ${turn.id} отменён`);
    events.cancelled(turn.id);
    return "cancelled";
  }

  /**
   * Записи истории playthrough, как их отдаёт Foreman.
   *
   * Отдельный метод, потому что читают двое: история для мода и связывание
   * записей с ходом. Форма одна, и второй её копии быть не должно.
   */
  private async storedMessages(playthroughId: string, timeoutMs?: number): Promise<StoredMessage[]> {
    const response = await this.foreman.request(
      `/api/playthroughs/${playthroughId}/messages`,
      timeoutMs === undefined ? {} : { signal: AbortSignal.timeout(timeoutMs) },
    );
    if (!response.ok) {
      throw new TurnError("FOREMAN_UNAVAILABLE", `история недоступна: ${response.status}`);
    }
    return (await response.json()) as StoredMessage[];
  }

  /** Идентификаторы записей до хода; `undefined` — прочитать не удалось. */
  private async idsBefore(playthroughId: string): Promise<ReadonlySet<string>| undefined> {
    try {
      const stored = await this.storedMessages(playthroughId, LINK_READ_MS);
      return new Set(stored.map((message) => message.id));
    } catch (err: unknown) {
      // Не повод валить ход: без этого чтения у его записей просто не будет
      // номера. Ход важнее номера.
      this.log.warn("не прочитал записи до хода — номера у его записей не будет", err);
      return undefined;
    }
  }

  /**
   * Связывает записи, появившиеся за время хода, с его номером.
   *
   * Ожидаемый состав — вопрос игрока и, если модель ответила, её ответ
   * (`routes/chat.ts` Foreman пишет первый до потока, второй после). Любой
   * другой состав значит, что в playthrough писал кто-то ещё, и тогда номер
   * не ставится никому: по Co-129 лучше честное «номера нет».
   */
  private async linkTurn(turn: Turn): Promise<void> {
    const before = turn.idsBefore;
    if (before === undefined) return;

    let added: StoredMessage[];
    try {
      const stored = await this.storedMessages(turn.playthroughId, LINK_READ_MS);
      added = stored.filter((message) => !before.has(message.id));
    } catch (err: unknown) {
      this.log.warn(`не прочитал записи после хода ${turn.id} — номера у них не будет`, err);
      return;
    }

    const roles = added.map((message) => message.role);
    const expected =
      (roles.length === 1 && roles[0] === "user") ||
      (roles.length === 2 && roles[0] === "user" && roles[1] === "assistant");
    if (!expected) {
      this.log.warn(
        `записи хода ${turn.id} не опознаны (${roles.join(", ") || "ни одной"}): ` +
          `в playthrough писал кто-то ещё, номера не ставлю`,
      );
      return;
    }

    let links = this.linkedTurns.get(turn.playthroughId);
    if (links === undefined) {
      links = new Map<string, string>();
      this.linkedTurns.set(turn.playthroughId, links);
    }
    for (const message of added) links.set(message.id, turn.id);
    // Вытесняем самые старые: Map хранит порядок вставки.
    while (links.size > MAX_TURN_LINKS) {
      const oldest = links.keys().next();
      if (oldest.done === true) break;
      links.delete(oldest.value);
    }
    this.log.debug(`ход ${turn.id}: связано записей ${added.length}`);
  }

  /** История разговора: от старых к новым, хвостом нужной длины. */
  public async history(args: z.infer<typeof chatHistorySchema>): Promise<HistoryMessage[]> {
    const playthroughId = await this.playthroughFor(args.saveId);
    const limit = args.limit ?? DEFAULT_HISTORY_LIMIT;

    let all: StoredMessage[];
    try {
      all = await this.storedMessages(playthroughId);
    } catch (err: unknown) {
      if (err instanceof TurnError) throw err;
      throw new TurnError(
        "FOREMAN_UNAVAILABLE",
        `история недоступна: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Foreman отдаёт до 500 сообщений по возрастанию времени; моду нужен хвост.
    const links = this.linkedTurns.get(playthroughId);
    return all.slice(-limit).map((message) => {
      const turnId = links?.get(message.id);
      return {
        id: message.id,
        role: message.role,
        text: message.content,
        createdAt: message.createdAt,
        // Поле необязательное: у записей до запуска адаптера и у записей
        // мимо хода номера нет, и пустую строку вместо него ставить нельзя —
        // экран прочитал бы её как «ход с пустым номером».
        ...(turnId === undefined ? {} : { turnId }),
      };
    });
  }
}
