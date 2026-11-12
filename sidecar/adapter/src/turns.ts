import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ForemanError, type ForemanSession } from "./foreman.js";
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
}

interface StoredMessage {
  id: string;
  role: string;
  content: string;
  createdAt: string;
}

interface Turn {
  id: string;
  saveId: string;
  playthroughId: string;
  controller: AbortController;
  /** Мод уже не слушает: события не разносятся, поток к Foreman дочитывается. */
  cancelled: boolean;
  /** Исполнится, когда ход дочитан и сохранение свободно. */
  drained: Promise<void>;
}

export class ChatTurns {
  /** Идущие ходы по playthrough: не больше одного на сохранение. */
  private readonly turns = new Map<string, Turn>();

  public constructor(
    private readonly foreman: ForemanSession,
    private readonly log: Logger,
  ) {}

  /**
   * Сохранения, у которых прямо сейчас есть ход — идущий или дочитываемый.
   * По нему канал решает, кому адресован вызов инструмента: одно сохранение —
   * его `saveId`, несколько — `AMBIGUOUS_TURN` (протокол, §Вызов инструмента).
   */
  public liveSaveIds(): string[] {
    return [...new Set([...this.turns.values()].map((turn) => turn.saveId))];
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
  ): Promise<string> {
    const playthroughId = await this.playthroughFor(args.saveId, args.saveName);

    const running = this.turns.get(playthroughId);
    if (running !== undefined) {
      if (!running.cancelled) {
        throw new TurnError("TURN_IN_PROGRESS", "ход уже идёт: дождитесь конца или отмените");
      }
      // Предыдущий ход отменён и дочитывается. Ждём его, а не отказываем:
      // начать раньше нельзя — ответ брошенного хода ещё не лёг в историю.
      const freed = await Promise.race([
        running.drained.then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), DRAIN_WAIT_MS)),
      ]);
      if (!freed) {
        throw new TurnError("TURN_DRAINING", "отменённый ход всё ещё дописывается в историю");
      }
    }

    let release = (): void => {};
    const turn: Turn = {
      id: `t-${randomUUID()}`,
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

      for await (const event of parseSse(upstream.body)) {
        // Поток дочитывается и после отмены, но наружу больше ничего не идёт.
        if (turn.cancelled) continue;
        this.relay(turn, event.event, event.data, events, started);
      }
      if (turn.cancelled) this.log.info(`отменённый ход ${turn.id} дочитан`);
    } catch (err: unknown) {
      if (turn.controller.signal.aborted) {
        this.log.warn(`ход ${turn.id} брошен по пределу ожидания`);
      } else {
        this.log.error("ход чата сорвался", err);
        if (!turn.cancelled) {
          events.failed(turn.id, "FOREMAN_ERROR", err instanceof Error ? err.message : String(err));
        }
      }
    } finally {
      clearTimeout(limit);
      this.turns.delete(turn.playthroughId);
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
    const playthroughId = await this.playthroughFor(args.saveId);
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

  /** История разговора: от старых к новым, хвостом нужной длины. */
  public async history(args: z.infer<typeof chatHistorySchema>): Promise<HistoryMessage[]> {
    const playthroughId = await this.playthroughFor(args.saveId);
    const limit = args.limit ?? DEFAULT_HISTORY_LIMIT;

    let response: Response;
    try {
      response = await this.foreman.request(`/api/playthroughs/${playthroughId}/messages`);
    } catch (err: unknown) {
      throw new TurnError(
        "FOREMAN_UNAVAILABLE",
        `история недоступна: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (!response.ok) {
      throw new TurnError("FOREMAN_UNAVAILABLE", `история недоступна: ${response.status}`);
    }

    // Foreman отдаёт до 500 сообщений по возрастанию времени; моду нужен хвост.
    const all = (await response.json()) as StoredMessage[];
    return all.slice(-limit).map((message) => ({
      id: message.id,
      role: message.role,
      text: message.content,
      createdAt: message.createdAt,
    }));
  }
}
