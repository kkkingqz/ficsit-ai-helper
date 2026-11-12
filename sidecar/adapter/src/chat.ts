import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { ForemanError, type ForemanSession } from "./foreman.js";
import type { Logger } from "./log.js";
import { encodeFrame, parseSse } from "./stream.js";
import { bearerToken, tokenMatches } from "./token.js";

/**
 * API чата для мода (S2, задача #10): поток, отмена, история.
 *
 * Поверх `POST /api/playthroughs/:id/chat` Foreman, который отвечает SSE.
 * Адаптер делает четыре вещи, которых в этом маршруте нет:
 *
 * 1. **Говорит с модом сохранением, а не playthrough.** Мод знает `saveId`
 *    текущей игры; playthrough вычисляется из него (`playthroughIdFor`) и
 *    заводится при первом обращении.
 * 2. **Отменяет ход.** Отмены у Foreman нет вообще: ни `AbortSignal`, ни
 *    `res.on('close')` в его маршруте, — проверено по исходникам 12.11.2026.
 *    Поэтому отмена наша: мод перестаёт получать события немедленно, а ход
 *    **доигрывается на стороне Foreman** — токены за него всё равно потрачены,
 *    и его ответ попадает в историю.
 *
 *    Соединение к Foreman при этом **не рвётся, а дочитывается**. Так было
 *    сначала, и живая проверка 12.11.2026 показала, чем это кончается: пока
 *    брошенный ход дописывал ответ, игрок успел задать следующий вопрос, и
 *    история легла в порядке «вопрос — вопрос — ответ — ответ». Foreman пишет
 *    сообщение игрока до начала потока, а ответ — после, и разорванное
 *    соединение этого не отменяет. Поэтому ход остаётся занятым до конца, а
 *    следующий дожидается его (см. {@link DRAIN_WAIT_MS}).
 * 3. **Держит по одному ходу на сохранение.** Foreman дописывает сообщение
 *    игрока в историю до начала потока, так что два одновременных хода
 *    перемешали бы разговор. Второй запрос получает 409.
 * 4. **Переводит формат.** Наружу — строчный JSON (см. `stream.ts`).
 */

/** Сколько сообщений истории отдаём по умолчанию и максимум (у Foreman — 500). */
const DEFAULT_HISTORY_LIMIT = 50;
const MAX_HISTORY_LIMIT = 500;

/**
 * Пауза между keep-alive кадрами. Цикл инструментов может молчать десятки
 * секунд, а чтение тела на стороне мода идёт через `HTTP` игры с собственным
 * таймаутом: тишина в канале неотличима от обрыва.
 */
const KEEPALIVE_MS = 15_000;

/**
 * Сколько новый ход ждёт, пока дочитается отменённый. Отмена для игрока
 * мгновенная, но следующий вопрос нельзя задать раньше, чем история допишется:
 * иначе модель получит разговор в перепутанном порядке. Обычно это секунды —
 * ровно остаток уже начатого ответа.
 */
const DRAIN_WAIT_MS = 30_000;

/**
 * Предел на дочитывание брошенного хода. Нужен не для нормального случая, а
 * для зависшего провайдера: без него занятым остался бы и слот, и сокет.
 */
const DRAIN_LIMIT_MS = 5 * 60_000;

const chatRequestSchema = z.object({
  message: z.string().min(1).max(8000),
  /** Человеческое имя сохранения — только для названия playthrough. */
  saveName: z.string().min(1).max(200).optional(),
});

const cancelRequestSchema = z.object({ turnId: z.string().min(1).optional() });

interface StoredMessage {
  id: string;
  role: string;
  content: string;
  createdAt: string;
}

interface Turn {
  id: string;
  controller: AbortController;
  /** Мод уже не слушает: кадры не отправляются, поток к Foreman дочитывается. */
  cancelled: boolean;
  /** Прекратить отдавать кадры моду и закрыть его поток. */
  stopRelay: (reason: string) => void;
  /** Исполнится, когда ход дочитан и слот свободен. */
  drained: Promise<void>;
}

export interface ChatDeps {
  foreman: ForemanSession;
  token: string;
  log: Logger;
}

export function createChatRouter(deps: ChatDeps): Router {
  const { foreman, token, log } = deps;
  const router = Router({ mergeParams: true });
  /** Идущие ходы по playthrough: не больше одного на сохранение. */
  const turns = new Map<string, Turn>();

  const authorized = (req: Request, res: Response): boolean => {
    if (tokenMatches(token, bearerToken(req.header("authorization")))) return true;
    log.warn("отказ на маршруте мода: неверный токен", { path: req.path, ip: req.ip });
    res.status(401).json({ error: "unauthorized" });
    return false;
  };

  /**
   * Playthrough по `saveId`. Ошибку Foreman отдаём как 502: для мода это
   * «сайдкар на месте, Foreman — нет», и это не его ошибка запроса.
   */
  const playthroughOr502 = async (
    req: Request,
    res: Response,
    saveName?: string,
  ): Promise<string | undefined> => {
    // Express 5 типизирует параметр как `string | string[]`: повтор в пути сюда
    // не дойдёт (он в маршруте один), но сузить тип всё равно надо.
    const raw = req.params.saveId;
    const saveId = typeof raw === "string" ? raw : "";
    if (saveId.length === 0) {
      res.status(400).json({ error: "bad_request", message: "saveId пустой" });
      return undefined;
    }
    try {
      return await foreman.resolvePlaythrough(saveId, saveName);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      log.error("не удалось получить playthrough", err);
      res.status(502).json({
        error: "foreman_unavailable",
        message,
        status: err instanceof ForemanError ? err.status : undefined,
      });
      return undefined;
    }
  };

  router.post("/:saveId/chat", async (req: Request, res: Response) => {
    if (!authorized(req, res)) return;

    const parsed = chatRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "bad_request", message: parsed.error.message });
      return;
    }

    const playthroughId = await playthroughOr502(req, res, parsed.data.saveName);
    if (playthroughId === undefined) return;

    const running = turns.get(playthroughId);
    if (running !== undefined) {
      if (!running.cancelled) {
        res.status(409).json({
          error: "turn_in_progress",
          message: "ход уже идёт: дождитесь done или отмените его",
          turnId: running.id,
        });
        return;
      }
      // Предыдущий ход отменён и дочитывается. Ждём его, а не отказываем:
      // отказ заставил бы игрока нажимать «отправить» ещё раз, а начать
      // раньше нельзя — ответ брошенного хода ещё не лёг в историю.
      const waited = await Promise.race([
        running.drained.then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), DRAIN_WAIT_MS)),
      ]);
      if (!waited) {
        res.status(409).json({
          error: "turn_draining",
          message: "отменённый ход всё ещё дописывается в историю",
          turnId: running.id,
        });
        return;
      }
    }

    let release = (): void => {};
    const turn: Turn = {
      id: randomUUID(),
      controller: new AbortController(),
      cancelled: false,
      stopRelay: () => {},
      drained: new Promise<void>((resolve) => {
        release = resolve;
      }),
    };
    turns.set(playthroughId, turn);

    res.writeHead(200, {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // Прокси между модом и адаптером нет, но заголовок стоит рядом с теми же
      // в Foreman: буферизация ломает поток молча, а цена строки нулевая.
      "x-accel-buffering": "no",
    });
    res.flushHeaders();

    // Писать можно, пока мод слушает и ход не отменён: после отмены поток к
    // Foreman живёт дальше, но моду он уже не адресован.
    const send = (event: string, data: unknown): void => {
      if (turn.cancelled || res.writableEnded || res.destroyed) return;
      res.write(encodeFrame(event, data));
    };

    send("accepted", { turnId: turn.id, playthroughId });

    const keepalive = setInterval(() => {
      send("ping", { at: new Date().toISOString() });
    }, KEEPALIVE_MS);

    // Брошенный ход не держим вечно: провайдер может молчать, а слот и сокет
    // заняты.
    const limit = setTimeout(() => turn.controller.abort(), DRAIN_LIMIT_MS);

    turn.stopRelay = (reason: string): void => {
      if (turn.cancelled) return;
      // Последний кадр моду — до того, как поток закроется: дальше он получает
      // тишину, а не обрыв без объяснения.
      res.write(
        encodeFrame("cancelled", {
          turnId: turn.id,
          reason,
          message: "ход отменён: Foreman его доигрывает, ответ появится в истории",
        }),
      );
      turn.cancelled = true;
      clearInterval(keepalive);
      res.end();
    };

    // Мод закрыл соединение — считаем это отменой: отдельного запроса на
    // отмену ждать неоткуда.
    res.on("close", () => {
      if (!res.writableEnded) turn.cancelled = true;
    });

    try {
      const upstream = await foreman.request(`/api/playthroughs/${playthroughId}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify({ message: parsed.data.message }),
        signal: turn.controller.signal,
      });

      if (!upstream.ok || upstream.body === null) {
        const text = upstream.body === null ? "" : await upstream.text().catch(() => "");
        log.warn(`чат Foreman ответил ${upstream.status}`);
        send("error", {
          message: `Foreman ответил ${upstream.status}`,
          detail: text.slice(0, 500),
        });
        return;
      }

      for await (const event of parseSse(upstream.body)) {
        // Поток дочитывается и после отмены: `send` сам промолчит, а история у
        // Foreman допишется в правильном порядке.
        let data: unknown = event.data;
        try {
          data = JSON.parse(event.data);
        } catch {
          // Оставляем как есть: своё событие важнее строгости разбора.
        }
        send(event.event, data);
      }
      if (turn.cancelled) log.info(`отменённый ход ${turn.id} дочитан`);
    } catch (err: unknown) {
      if (turn.controller.signal.aborted) {
        log.warn(`ход ${turn.id} брошен по пределу ожидания`);
      } else {
        log.error("ход чата сорвался", err);
        send("error", { message: err instanceof Error ? err.message : String(err) });
      }
    } finally {
      clearInterval(keepalive);
      clearTimeout(limit);
      turns.delete(playthroughId);
      release();
      res.end();
    }
  });

  router.post("/:saveId/chat/cancel", async (req: Request, res: Response) => {
    if (!authorized(req, res)) return;

    const parsed = cancelRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "bad_request", message: parsed.error.message });
      return;
    }

    const playthroughId = await playthroughOr502(req, res);
    if (playthroughId === undefined) return;

    const turn = turns.get(playthroughId);
    if (turn === undefined) {
      res.status(404).json({ error: "no_turn", message: "идущего хода нет" });
      return;
    }
    if (parsed.data.turnId !== undefined && parsed.data.turnId !== turn.id) {
      // Отмена «того хода» после того, как он уже закончился и начался
      // следующий, иначе оборвала бы чужой ответ.
      res.status(409).json({ error: "turn_mismatch", message: "идёт другой ход", turnId: turn.id });
      return;
    }
    if (turn.cancelled) {
      res.status(202).json({ turnId: turn.id, upstream: "уже отменён, дописывается в историю" });
      return;
    }
    turn.stopRelay("запрос мода");
    res.status(202).json({ turnId: turn.id, upstream: "продолжается, ответ попадёт в историю" });
  });

  router.get("/:saveId/history", async (req: Request, res: Response) => {
    if (!authorized(req, res)) return;

    const playthroughId = await playthroughOr502(req, res);
    if (playthroughId === undefined) return;

    const asked = Number.parseInt(String(req.query.limit ?? ""), 10);
    const limit = Number.isNaN(asked)
      ? DEFAULT_HISTORY_LIMIT
      : Math.min(Math.max(asked, 1), MAX_HISTORY_LIMIT);

    try {
      const upstream = await foreman.request(`/api/playthroughs/${playthroughId}/messages`);
      if (!upstream.ok) {
        res.status(502).json({ error: "foreman_unavailable", status: upstream.status });
        return;
      }
      const all = (await upstream.json()) as StoredMessage[];
      // Foreman отдаёт до 500 сообщений по возрастанию времени; моду нужен хвост.
      res.json({ playthroughId, messages: all.slice(-limit) });
    } catch (err: unknown) {
      log.error("история чата недоступна", err);
      res.status(502).json({
        error: "foreman_unavailable",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return router;
}
