import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { Logger } from "./log.js";
import { bearerToken, tokenMatches } from "./token.js";
import {
  chatCancelSchema,
  chatHistorySchema,
  chatSendSchema,
  TurnError,
  type ChatTurns,
  type TurnEvents,
} from "./turns.js";

/**
 * Канал мод ↔ адаптер, протокол 1
 * ([mod-adapter-channel.md](../../../docs/interfaces/mod-adapter-channel.md), Co-82).
 *
 * Одно соединение на всё: вызовы инструментов модели и чат идут одними и теми
 * же сообщениями. Почему не отдельный маршрут чата (как было в #50) — причины
 * в документе: запасной транспорт меняется в одном месте, состояние связи
 * одно, кадры чата получают номер и переживают короткий обрыв.
 *
 * Три входа основного транспорта:
 *
 * - `POST /mod/hello` — рукопожатие, открывает сессию;
 * - `GET  /mod/stream?session=…&ack=N` — долгий ответ, строчный JSON адаптер → мод;
 * - `POST /mod/send` — пачка сообщений мод → адаптер и подтверждение принятого.
 *
 * Сессия в каждый момент одна: процесс игры один. Каждое рукопожатие заводит
 * новую и закрывает прежнюю — это сделано вместо эпохи из Co-37, потому что
 * эпоха ловила только перезапуск адаптера, а не перезапуск игры при живом
 * адаптере.
 */

/** Версия протокола канала. Ломающая правка — вопросом к Co, не здесь. */
export const PROTOCOL = 1;

/**
 * Пределы, которые адаптер объявляет в рукопожатии. Источник чисел один —
 * README адаптера (Co-37): мод их не дублирует, а получает.
 */
export const LIMITS = {
  maxMessageBytes: 1_048_576,
  maxBatchMessages: 64,
  bufferMessages: 1024,
  pingSec: 15,
  toolDeadlineSec: 10,
  sessionIdleSec: 120,
} as const;

/** Второй предел буфера: 1024 коротких сообщения дешевле восьми мегабайт. */
const BUFFER_BYTES = 8 * 1024 * 1024;

const ADAPTER_VERSION = "0.1.0";

const toolSchema = z.object({
  name: z.string().min(1).max(128),
  description: z.string().max(4000).optional(),
  inputSchema: z.record(z.string(), z.unknown()).optional(),
});

const helloSchema = z.object({
  protocol: z.number().int(),
  apiVersion: z.string().min(1),
  modVersion: z.string().min(1).optional(),
  saveId: z.string().max(128).optional(),
  inert: z.boolean().optional(),
  tools: z.array(toolSchema).max(128).optional(),
});

const envelopeSchema = z.object({
  seq: z.number().int().min(1),
  type: z.string().min(1).max(64),
  id: z.string().min(1).max(64).optional(),
  re: z.string().min(1).max(64).optional(),
  body: z.unknown().optional(),
  error: z.unknown().optional(),
});

const sendSchema = z.object({
  session: z.string().min(1),
  ack: z.number().int().min(0).optional(),
  messages: z.array(envelopeSchema).optional(),
});

export type ForemanState = "ready" | "signingIn" | "unavailable";

interface Buffered {
  seq: number;
  line: string;
  bytes: number;
}

interface PendingCall {
  settle: (outcome: ToolOutcome) => void;
  timer: NodeJS.Timeout;
}

export type ToolOutcome =
  | { ok: true; text: string }
  | { ok: false; code: string; message: string };

interface StreamHandle {
  res: Response;
  ping: NodeJS.Timeout;
}

interface Session {
  id: string;
  tools: Tool[];
  saveId: string;
  inert: boolean;
  outSeq: number;
  /** Последний номер мода, принятый подряд. */
  inAck: number;
  buffer: Buffered[];
  bufferBytes: number;
  stream: StreamHandle | undefined;
  lastSeen: number;
  pending: Map<string, PendingCall>;
}

export interface ChannelDeps {
  turns: ChatTurns;
  token: string;
  /** Версия публичного API мода, с которой совместим адаптер. */
  apiVersion: string;
  /** Модель чата — для `adapter.status` и `chat.done` (§5). */
  model: string;
  log: Logger;
}

export class ModChannel {
  private session: Session | undefined;
  private foremanState: ForemanState = "signingIn";
  private foremanReason = "";

  public constructor(private readonly deps: ChannelDeps) {}

  /* ---------- состояние для остальных частей адаптера ---------- */

  /** Инструменты мода из рукопожатия. Нет сессии — набор пуст. */
  public modTools(): Tool[] {
    return this.session?.tools ?? [];
  }

  public get connected(): boolean {
    return this.session?.stream !== undefined;
  }

  public get sessionId(): string | undefined {
    return this.session?.id;
  }

  /** Состояние входа в Foreman: уходит моду сообщением при каждой смене. */
  public setForemanState(state: ForemanState, reason = ""): void {
    if (state === this.foremanState && reason === this.foremanReason) return;
    this.foremanState = state;
    this.foremanReason = reason;
    if (this.session !== undefined) this.emitStatus(this.session);
  }

  private emitStatus(session: Session): void {
    const body: Record<string, unknown> = { foreman: this.foremanState };
    if (this.deps.model !== "") body.model = this.deps.model;
    if (this.foremanReason !== "") body.reason = this.foremanReason;
    this.emit(session, "adapter.status", { body });
  }

  /* ---------- конверт и буфер ---------- */

  private emit(
    session: Session,
    type: string,
    parts: { body?: unknown; id?: string; re?: string; error?: unknown } = {},
  ): void {
    session.outSeq += 1;
    const envelope: Record<string, unknown> = { seq: session.outSeq, type };
    if (parts.id !== undefined) envelope.id = parts.id;
    if (parts.re !== undefined) envelope.re = parts.re;
    if (parts.error !== undefined) envelope.error = parts.error;
    else if (parts.body !== undefined) envelope.body = parts.body;

    const line = `${JSON.stringify(envelope)}\n`;
    const entry: Buffered = { seq: session.outSeq, line, bytes: Buffer.byteLength(line) };
    session.buffer.push(entry);
    session.bufferBytes += entry.bytes;

    // Переполнение буфера значит, что мод не подтверждает. Закрываем сессию:
    // отказ видимый (мод переподключится), а не тихая потеря сообщений.
    if (
      session.buffer.length > LIMITS.bufferMessages ||
      session.bufferBytes > BUFFER_BYTES
    ) {
      this.deps.log.warn("буфер канала переполнен — закрываю сессию");
      this.closeSession("superseded");
      return;
    }

    session.stream?.res.write(line);
  }

  private release(session: Session, ack: number): void {
    if (ack <= 0) return;
    while (session.buffer.length > 0 && (session.buffer[0] as Buffered).seq <= ack) {
      const entry = session.buffer.shift() as Buffered;
      session.bufferBytes -= entry.bytes;
    }
  }

  private closeStream(session: Session, reason: string): void {
    const stream = session.stream;
    if (stream === undefined) return;
    session.stream = undefined;
    clearInterval(stream.ping);
    // Служебная строка идёт без `seq`: она не буферизуется и не подтверждается.
    if (!stream.res.writableEnded) {
      stream.res.write(`${JSON.stringify({ type: "bye", reason })}\n`);
      stream.res.end();
    }
  }

  /** Закрывает сессию целиком: поток, буфер и всё, что ждало ответа. */
  public closeSession(reason: string): void {
    const session = this.session;
    if (session === undefined) return;
    this.closeStream(session, reason);
    for (const [, call] of session.pending) {
      clearTimeout(call.timer);
      call.settle({
        ok: false,
        code: "CHANNEL_RESET",
        message: "связь с игрой переустановлена, вызов потерян",
      });
    }
    session.pending.clear();
    session.buffer = [];
    session.bufferBytes = 0;
    this.session = undefined;
  }

  private alive(): Session | undefined {
    const session = this.session;
    if (session === undefined) return undefined;
    // Сессия без потока и без запросов живёт `sessionIdleSec`.
    if (
      session.stream === undefined &&
      Date.now() - session.lastSeen > LIMITS.sessionIdleSec * 1000
    ) {
      this.deps.log.info("сессия канала истекла по бездействию");
      this.closeSession("superseded");
      return undefined;
    }
    return session;
  }

  /* ---------- вызов инструмента мода ---------- */

  /**
   * Отправляет вызов моду и ждёт `tool.result` в пределах срока.
   *
   * `saveId` берётся у единственного идущего хода: иначе дочитываемый ход
   * сохранения A получил бы данные сохранения B, которое игрок успел
   * загрузить. Ходов несколько — отвечаем `AMBIGUOUS_TURN` сами, не спрашивая
   * мод; ходов нет (фоновый вызов) — `saveId` не передаём.
   */
  public async callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<ToolOutcome> {
    const session = this.alive();
    if (session === undefined || session.stream === undefined) {
      return { ok: false, code: "MOD_DISCONNECTED", message: "игра не подключена" };
    }

    const live = this.deps.turns.liveSaveIds();
    if (live.length > 1) {
      return {
        ok: false,
        code: "AMBIGUOUS_TURN",
        message: "идёт несколько ходов, вызов нельзя отнести к одному сохранению",
      };
    }

    const callId = `c-${randomUUID()}`;
    const body: Record<string, unknown> = {
      name,
      args,
      deadlineSec: LIMITS.toolDeadlineSec,
    };
    const saveId = live[0];
    if (saveId !== undefined) body.saveId = saveId;

    return await new Promise<ToolOutcome>((resolve) => {
      let settled = false;
      const settle = (outcome: ToolOutcome): void => {
        if (settled) return;
        settled = true;
        session.pending.delete(callId);
        signal?.removeEventListener("abort", onAbort);
        resolve(outcome);
      };

      const timer = setTimeout(() => {
        this.deps.log.warn(`мод не ответил на «${name}» за ${LIMITS.toolDeadlineSec} с`);
        this.emit(session, "tool.cancel", { body: { callId } });
        settle({ ok: false, code: "MOD_TIMEOUT", message: "мод не ответил в срок" });
      }, LIMITS.toolDeadlineSec * 1000);

      function onAbort(): void {
        clearTimeout(timer);
        settle({ ok: false, code: "MOD_TIMEOUT", message: "запрос отменён вызывающим" });
      }

      // Запрос к адаптеру закрыт раньше ответа — моду незачем доделывать работу.
      if (signal !== undefined) {
        signal.addEventListener("abort", () => {
          this.emit(session, "tool.cancel", { body: { callId } });
          onAbort();
        });
      }

      session.pending.set(callId, {
        timer,
        settle: (outcome) => {
          clearTimeout(timer);
          settle(outcome);
        },
      });
      this.emit(session, "tool.call", { id: callId, body });
    });
  }

  /* ---------- маршруты ---------- */

  public router(): Router {
    const router = Router();
    const { log, token } = this.deps;

    const authorized = (req: Request, res: Response): boolean => {
      if (tokenMatches(token, bearerToken(req.header("authorization")))) return true;
      log.warn("отказ на канале: неверный токен", { path: req.path, ip: req.ip });
      res.status(401).json({ error: "unauthorized" });
      return false;
    };

    router.post("/hello", (req: Request, res: Response) => {
      if (!authorized(req, res)) return;

      const parsed = helloSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ code: "INVALID_ARGUMENT", message: parsed.error.message });
        return;
      }
      if (parsed.data.protocol !== PROTOCOL) {
        res.status(409).json({ code: "PROTOCOL_MISMATCH", protocol: PROTOCOL });
        return;
      }
      if (major(parsed.data.apiVersion) !== major(this.deps.apiVersion)) {
        res.status(409).json({ code: "API_VERSION_MISMATCH", apiVersion: this.deps.apiVersion });
        return;
      }

      // Прежняя сессия уходит целиком: её поток получает `bye`, её
      // недоставленное отбрасывается, её незавершённые вызовы получают
      // `CHANNEL_RESET`.
      this.closeSession("superseded");

      const session: Session = {
        id: `s-${randomUUID()}`,
        tools: (parsed.data.tools ?? []).map((tool) => ({
          name: tool.name,
          description: tool.description ?? "",
          inputSchema: (tool.inputSchema ?? { type: "object" }) as Tool["inputSchema"],
        })),
        saveId: parsed.data.saveId ?? "",
        inert: parsed.data.inert ?? false,
        outSeq: 0,
        inAck: 0,
        buffer: [],
        bufferBytes: 0,
        stream: undefined,
        lastSeen: Date.now(),
        pending: new Map(),
      };
      this.session = session;
      log.info(`сессия канала открыта, инструментов мода ${session.tools.length}`);

      res.json({
        session: session.id,
        protocol: PROTOCOL,
        apiVersion: this.deps.apiVersion,
        adapterVersion: ADAPTER_VERSION,
        limits: LIMITS,
      });

      // Первое сообщение каждой сессии — состояние адаптера.
      this.emitStatus(session);
    });

    router.get("/stream", (req: Request, res: Response) => {
      if (!authorized(req, res)) return;

      const session = this.alive();
      const asked = typeof req.query.session === "string" ? req.query.session : "";
      if (session === undefined || asked !== session.id) {
        res.status(410).json({ code: "SESSION_UNKNOWN" });
        return;
      }

      const ack = Number.parseInt(String(req.query.ack ?? "0"), 10);
      if (Number.isNaN(ack) || ack < 0) {
        res.status(400).json({ code: "INVALID_ARGUMENT", message: "ack — целое от 0" });
        return;
      }
      this.release(session, Math.min(ack, session.outSeq));

      const oldest = session.buffer[0]?.seq ?? session.outSeq + 1;
      if (ack + 1 < oldest) {
        res.status(409).json({ code: "STREAM_LOST", oldest });
        return;
      }

      // Поток в сессии один: прежний закрывается строкой `bye`.
      this.closeStream(session, "replaced");

      res.writeHead(200, {
        "content-type": "application/x-ndjson; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      res.flushHeaders();

      const ping = setInterval(() => {
        if (!res.writableEnded) res.write(`${JSON.stringify({ type: "ping" })}\n`);
      }, LIMITS.pingSec * 1000);
      session.stream = { res, ping };
      session.lastSeen = Date.now();

      for (const entry of session.buffer) res.write(entry.line);

      res.on("close", () => {
        if (session.stream?.res === res) {
          clearInterval(ping);
          session.stream = undefined;
          session.lastSeen = Date.now();
          log.debug("поток канала закрыт модом");
        }
      });
    });

    router.post("/send", (req: Request, res: Response) => {
      if (!authorized(req, res)) return;

      const parsed = sendSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ code: "INVALID_ARGUMENT", message: parsed.error.message });
        return;
      }

      const session = this.alive();
      if (session === undefined || parsed.data.session !== session.id) {
        res.status(410).json({ code: "SESSION_UNKNOWN" });
        return;
      }
      session.lastSeen = Date.now();

      const messages = parsed.data.messages ?? [];
      if (messages.length > LIMITS.maxBatchMessages) {
        res.status(413).json({ code: "TOO_LARGE", message: "сообщений в пачке больше предела" });
        return;
      }
      for (const message of messages) {
        if (Buffer.byteLength(JSON.stringify(message)) > LIMITS.maxMessageBytes) {
          res.status(413).json({ code: "TOO_LARGE", message: "сообщение больше предела" });
          return;
        }
      }

      if (parsed.data.ack !== undefined) {
        this.release(session, Math.min(parsed.data.ack, session.outSeq));
      }

      const ordered = [...messages].sort((a, b) => a.seq - b.seq);
      for (const [index, message] of ordered.entries()) {
        // Повтор: подтверждён раньше, второй раз не обрабатываем.
        if (message.seq <= session.inAck) continue;
        if (message.seq > session.inAck + 1) {
          // Пропуск в начале пачки — отказ; дальше по пачке берём непрерывное
          // начало и отвечаем его `ack`, остальное мод пришлёт снова.
          if (index === 0) {
            res.status(409).json({ code: "SEQ_GAP", ack: session.inAck });
            return;
          }
          break;
        }
        session.inAck = message.seq;
        // Подтверждение — не выполнение: результат придёт отдельным сообщением.
        void this.handle(session, message);
      }

      res.json({ ack: session.inAck });
    });

    return router;
  }

  /* ---------- сообщения мода ---------- */

  private events(session: Session): TurnEvents {
    const emit = (type: string, body: Record<string, unknown>): void => {
      if (this.session === session) this.emit(session, type, { body });
    };
    return {
      text: (turnId, text) => emit("chat.text", { turnId, text }),
      tool: (turnId, name) => emit("chat.tool", { turnId, name }),
      done: (turnId, latencyMs) =>
        emit("chat.done", { turnId, model: this.deps.model, latencyMs }),
      failed: (turnId, code, message) => emit("chat.failed", { turnId, code, message }),
      cancelled: (turnId) => emit("chat.cancelled", { turnId }),
    };
  }

  private reply(session: Session, to: z.infer<typeof envelopeSchema>, body: unknown): void {
    if (to.id === undefined) return;
    this.emit(session, "reply", { re: to.id, body });
  }

  private replyError(
    session: Session,
    to: z.infer<typeof envelopeSchema>,
    code: string,
    message: string,
  ): void {
    if (to.id === undefined) {
      this.deps.log.debug(`ошибка «${code}» без id запроса — ответить некому`);
      return;
    }
    this.emit(session, "reply", { re: to.id, error: { code, message } });
  }

  private async handle(session: Session, message: z.infer<typeof envelopeSchema>): Promise<void> {
    const { log, turns } = this.deps;
    log.debug(`канал: ${message.type} seq=${message.seq}`);

    try {
      switch (message.type) {
        case "mod.status": {
          const body = z
            .object({ saveId: z.string().max(128).optional(), inert: z.boolean().optional() })
            .safeParse(message.body ?? {});
          if (body.success) {
            session.saveId = body.data.saveId ?? session.saveId;
            session.inert = body.data.inert ?? session.inert;
          }
          return;
        }

        case "chat.send": {
          const body = chatSendSchema.safeParse(message.body);
          if (!body.success) {
            this.replyError(session, message, "INVALID_ARGUMENT", body.error.message);
            return;
          }
          const turnId = await turns.start(body.data, this.events(session));
          this.reply(session, message, { turnId });
          return;
        }

        case "chat.cancel": {
          const body = chatCancelSchema.safeParse(message.body);
          if (!body.success) {
            this.replyError(session, message, "INVALID_ARGUMENT", body.error.message);
            return;
          }
          const state = await turns.cancel(body.data, this.events(session));
          this.reply(session, message, { state });
          return;
        }

        case "chat.history": {
          const body = chatHistorySchema.safeParse(message.body);
          if (!body.success) {
            this.replyError(session, message, "INVALID_ARGUMENT", body.error.message);
            return;
          }
          this.reply(session, message, { messages: await turns.history(body.data) });
          return;
        }

        case "tool.result": {
          const call = message.re === undefined ? undefined : session.pending.get(message.re);
          if (call === undefined) {
            // Поздний результат после срока — отбрасывается.
            log.debug("tool.result без ожидающего вызова — пропущен");
            return;
          }
          if (message.error !== undefined) {
            const error = z
              .object({ code: z.string().optional(), message: z.string().optional() })
              .safeParse(message.error);
            call.settle({
              ok: false,
              code: error.success ? (error.data.code ?? "MOD_ERROR") : "MOD_ERROR",
              message: error.success ? (error.data.message ?? "") : "ошибка мода",
            });
            return;
          }
          call.settle({ ok: true, text: JSON.stringify(message.body ?? null) });
          return;
        }

        default:
          // Незнакомый тип: с `id` — ошибка в ответ, без `id` — только лог.
          // Поэтому новое сообщение не требует нового `protocol`.
          this.replyError(
            session,
            message,
            "UNKNOWN_TYPE",
            `тип «${message.type}» этому адаптеру неизвестен`,
          );
          return;
      }
    } catch (err: unknown) {
      if (err instanceof TurnError) {
        this.replyError(session, message, err.code, err.message);
        return;
      }
      log.error(`обработка «${message.type}» сорвалась`, err);
      this.replyError(
        session,
        message,
        "FOREMAN_UNAVAILABLE",
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}

/** Мажорная часть версии: несовпадение мажора отключает AI-функции (§5.5). */
function major(version: string): string {
  return version.split(".", 1)[0] ?? version;
}
