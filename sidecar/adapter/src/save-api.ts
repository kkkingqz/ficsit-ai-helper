import { Router, type Request, type Response } from "express";
import { createSaveSource, PUBLIC_API_VERSION } from "@ficsitai/save-source";
import type { Config } from "./config.js";
import type { Logger } from "./log.js";

/**
 * Чтения API v0 по файлу сохранения — источник Save (§8.5, ADR-025).
 *
 * Место выбрано не мной: архитектура называет адаптер прямо (§13, «выбор
 * источника данных: Fixture, Recording, **Save — через адаптер сайдкара**»;
 * §8.5, «Save — в адаптере сайдкара, без игры»). Отсюда экраны открываются
 * без игры: тот же конверт, что у моста и у dev-сервера, поэтому страница,
 * отлаженная в браузере, в игре не встречает другой формы.
 *
 * Чего здесь нет и не будет:
 *
 * - **правил контракта.** Пагинация, области, коды — всё в библиотеке Cf3.
 *   Вторая их копия разошлась бы с первой, и спорить было бы не с чем;
 * - **записи.** Поверхность только читает: сохранение — инструмент отладки,
 *   и менять мир через него нечему (§8.5);
 * - **чата и событий.** Ход чата идёт каналом мода, а у снимка событий не
 *   бывает: он один.
 *
 * Версию API библиотеке не объявляем. Она сверяет её строгим равенством, и
 * на нашей 0.5.0 отказала бы всему кодом `API_VERSION_MISMATCH`, хотя мажор
 * тот же и чтения не менялись (§5.5). Расхождение видно в статусе и в
 * предупреждении при запуске; поднять версию попрошено у Cf3 (Co2-71).
 */

/** Операции чтения API v0. Остальное этой поверхности не принадлежит. */
const READS = new Set(["getStatus", "listMetrics", "listScopes", "queryMetric", "querySeries"]);

/** Снимок один — событий не бывает. Поток держим, чтобы `EventSource` не ломился. */
const KEEPALIVE_MS = 15_000;

interface Envelope {
  id: string;
  op: string;
  args: Record<string, unknown>;
}

/** Разбор конверта: та же форма, что у моста (`{ id, op, args }`). */
function envelope(body: unknown): Envelope | undefined {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return undefined;
  const { id, op, args } = body as { id?: unknown; op?: unknown; args?: unknown };
  if (typeof id !== "string" || id.length === 0) return undefined;
  if (typeof op !== "string" || op.length === 0) return undefined;
  // `args: null` до источника доходить не должен: это не «пустые аргументы»,
  // а битый конверт (ревью Gs на #53, то же правило в dev-сервере).
  if (args !== undefined && (args === null || typeof args !== "object" || Array.isArray(args))) {
    return undefined;
  }
  return { id, op, args: (args ?? {}) as Record<string, unknown> };
}

function errorBody(err: unknown): { code: string; message: string; details?: unknown } {
  if (err instanceof Error && err.name === "FicsitAIApiError") {
    const api = err as Error & { code?: unknown; details?: unknown };
    if (typeof api.code === "string") {
      return api.details === undefined
        ? { code: api.code, message: err.message }
        : { code: api.code, message: err.message, details: api.details };
    }
  }
  // Чужая ошибка кодом контракта не притворяется: у системной тоже есть
  // `code` (`ENOENT`), и отдать его экрану значило бы соврать о причине.
  return {
    code: "SOURCE_UNAVAILABLE",
    message: err instanceof Error ? err.message : String(err),
  };
}

export interface SaveApiDeps {
  config: Config;
  log: Logger;
  /**
   * Подмена библиотеки — для проверок.
   *
   * Настоящая читает `.sav` пакетами Foreman из `FOREMAN_SRC`, и в проверках
   * её быть не должно: предмет здесь — конверт, отбор операций и перевод
   * ошибки, а разбор сохранения покрыт у Cf3.
   */
  createSource?: (options: Record<string, unknown>) => unknown;
}

export interface SaveApi {
  readonly router: Router;
  /** Версия API, которую объявляет библиотека: её показывает `/health`. */
  readonly libraryApiVersion: string;
  close(): void;
}

export function createSaveApi(deps: SaveApiDeps): SaveApi {
  const { config, log } = deps;
  const options: Record<string, unknown> = { sourceMode: config.saveSourceMode };
  if (config.saveDataDir !== undefined) options["saveDataDir"] = config.saveDataDir;
  if (config.saveId !== undefined) options["saveId"] = config.saveId;
  if (config.saveFilePath !== undefined) options["saveFilePath"] = config.saveFilePath;

  const create = deps.createSource ?? createSaveSource;
  const source = create(options) as Record<
    string,
    (args: Record<string, unknown>) => Promise<unknown>
  >;
  const timers = new Set<NodeJS.Timeout>();
  const router = Router();

  router.post("/", (req: Request, res: Response) => {
    void (async () => {
      const call = envelope(req.body);
      if (call === undefined) {
        res.status(400).json({
          error: { code: "INVALID_ARGUMENT", message: "конверт не в форме { id, op, args }" },
        });
        return;
      }

      if (!READS.has(call.op)) {
        // Отказ с причиной, а не 404: клиент читает код контракта. Запись и
        // чат сюда не относятся — у них свои пути.
        res.json({
          re: call.id,
          error: { code: "UNKNOWN_OP", message: `запрос «${call.op}» не из чтений API v0` },
        });
        return;
      }

      try {
        const answer = await source[call.op]?.(call.args);
        // Статус договаривается до 0.5.0 одним полем: чата у сохранения нет,
        // и экран чата обязан сказать это игроку, а не ждать с пустым полем
        // ввода. Та же правка в обёртке dev-сервера — расходиться им нельзя.
        const body =
          call.op === "getStatus" && answer !== null && typeof answer === "object"
            ? { ...(answer as Record<string, unknown>), assistantState: "unavailable" }
            : answer;
        if (body === undefined || body === null) {
          res.json({
            re: call.id,
            error: { code: "SOURCE_UNAVAILABLE", message: "источник Save ответил пустым телом" },
          });
          return;
        }
        res.json({ re: call.id, body });
      } catch (err: unknown) {
        const error = errorBody(err);
        if (error.code === "SOURCE_UNAVAILABLE") {
          log.warn(`источник Save сорвался на «${call.op}»`, err);
        } else {
          log.debug(`источник Save отказал на «${call.op}»: ${error.code}`);
        }
        res.json({ re: call.id, error });
      }
    })();
  });

  router.get("/events", (req: Request, res: Response) => {
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    });
    // Снимок один, присылать нечего. Но без этого пути `EventSource`
    // страницы ломился бы в 404 по кругу и засыпал консоль ошибками, а
    // разработчик решал бы, что сломан экран.
    res.write(`event: ready\ndata: ${JSON.stringify({ source: config.saveSourceMode })}\n\n`);
    const timer = setInterval(() => {
      if (!res.writableEnded) res.write(": keepalive\n\n");
    }, KEEPALIVE_MS);
    timer.unref();
    timers.add(timer);
    req.on("close", () => {
      clearInterval(timer);
      timers.delete(timer);
    });
  });

  return {
    router,
    libraryApiVersion: PUBLIC_API_VERSION,
    close(): void {
      for (const timer of timers) clearInterval(timer);
      timers.clear();
    },
  };
}
