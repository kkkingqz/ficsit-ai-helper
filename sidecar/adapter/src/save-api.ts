import { Router, type Request, type Response } from "express";
import { z } from "zod";
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
 * - **правил контракта.** Пагинация, границы `pageSize`, зависимость
 *   `scopeFilter` от `metricId`, состав областей, коды — всё в библиотеке
 *   Cf3. Вторая их копия разошлась бы с первой. Проверяются только **типы**
 *   аргументов, и это другое: число вместо строки — испорченный запрос, а не
 *   правило предметной области (ревью Gs на #67, п. 5);
 * - **записи.** Поверхность только читает: сохранение — инструмент отладки,
 *   и менять мир через него нечему (§8.5);
 * - **чата и событий.** Ход чата идёт каналом мода, а у снимка событий не
 *   бывает: он один.
 *
 * Версию API библиотеке объявляем — с 18.11.2026. Прежде не объявляли:
 * библиотека сверяла её строгим равенством и на нашей 0.5.0 отказала бы
 * всему кодом `API_VERSION_MISMATCH`, хотя мажор тот же и чтения не
 * менялись. По моему замечанию (Co2-71) Cf3 поднял версию до 0.5.0 и свёл
 * проверку к мажору, как требует §5.5, — и теперь объявить её полезно:
 * расхождение мажора станет громким отказом, а не тихо другой формой
 * ответа. Минорная разница по-прежнему ничего не ломает, и это не слово, а
 * проверка: тест библиотеки гоняет 0.5.1 и 0.4.0 против 0.5.0 (PR #75,
 * принят в Co2-89). Первый раз объявление сняли откатом `0adb592`, потому
 * что сверка была строгим равенством.
 */

/** Операции чтения API v0. Остальное этой поверхности не принадлежит. */
const READS = new Set(["getStatus", "listMetrics", "listScopes", "queryMetric", "querySeries"]);

/** Снимок один — событий не бывает. Поток держим, чтобы `EventSource` не ломился. */
const KEEPALIVE_MS = 15_000;

/**
 * Причина в статусе, когда ассистента нет.
 *
 * Контракт отводит `reason` именно под причину недоступности («Unavailable —
 * нет сайдкара или Foreman не отвечает, причина в Reason»), и пустым его
 * оставлять нельзя: экран показывал бы «ассистент недоступен» и молчал о
 * том, почему (ревью Gs на #66 — та же правка в обёртке dev-сервера,
 * расходиться им нельзя).
 */
const NO_ASSISTANT = "чата у источника Save нет: это снимок сохранения, а не живая игра";

/**
 * Имя пакета библиотеки — строкой, и это важно.
 *
 * Импорт **динамический и по переменной**: `tsc` не разрешает нелитеральный
 * специфатор, поэтому сборка адаптера не зависит от того, собрана ли
 * библиотека. Со статическим импортом чистая установка ломалась: `npm ci`
 * ставит ссылку на пакет, но его `dist` не собирает, и сборка адаптера
 * падала с `TS2307` даже у того, кто Save не включал (ревью Gs на #67,
 * п. 1). Теперь не собранная библиотека ломает только эту поверхность — а
 * она и так выключена по умолчанию.
 */
const LIBRARY = "@ficsitai/save-source";

/**
 * То, что нужно от библиотеки. Структурно, без импорта её типов: пакет
 * подключается в рантайме, а формы ответов у нас общие — из одного контракта.
 */
interface SaveSourceLike {
  getStatus(args: Record<string, unknown>): Promise<unknown>;
  listMetrics(args: Record<string, unknown>): Promise<unknown>;
  listScopes(args: Record<string, unknown>): Promise<unknown>;
  queryMetric(args: Record<string, unknown>): Promise<unknown>;
  querySeries(args: Record<string, unknown>): Promise<unknown>;
}

export interface SaveSourceModule {
  createSaveSource(options: Record<string, unknown>): SaveSourceLike;
  PUBLIC_API_VERSION?: string;
}

/**
 * Типы аргументов чтений — не их правила.
 *
 * `looseObject`: незнакомые поля проходят к библиотеке нетронутыми, иначе
 * добавление минорной версии молча терялось бы здесь. Границы и зависимости
 * полей проверяет библиотека, и дублировать их нельзя.
 */
const ARGS = {
  getStatus: z.looseObject({}),
  listMetrics: z.looseObject({
    metricId: z.string().optional(),
    scope: z.string().optional(),
    filter: z.string().optional(),
    scopeFilter: z.string().optional(),
    pageSize: z.number().optional(),
    cursor: z.string().optional(),
    scopeCursor: z.string().optional(),
  }),
  // Поля сверены с контрактом по одному (`web/screens/api/src/types.ts`):
  // у `listScopes` фильтр называется `scopeFilter`, а я написал `filter` — и
  // `scopeFilter: 42` уходил в библиотеку, падал там на `.trim` и возвращался
  // как `SOURCE_UNAVAILABLE` с её внутренним сообщением (ревью Gs на #67).
  listScopes: z.looseObject({
    metricId: z.string(),
    scopeFilter: z.string().optional(),
    pageSize: z.number().optional(),
    cursor: z.string().optional(),
  }),
  queryMetric: z.looseObject({
    metricId: z.string(),
    scopeId: z.string().optional(),
  }),
  // `window` у ряда обязателен по контракту — без него это `queryMetric`.
  querySeries: z.looseObject({
    metricId: z.string(),
    window: z.string(),
    scopeId: z.string().optional(),
  }),
};

interface Envelope {
  id: string;
  op: string;
  args: Record<string, unknown>;
}

/** `id` конверта, если его можно прочитать: ответ должен нести свой `re`. */
function envelopeId(body: unknown): string | undefined {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return undefined;
  const { id } = body as { id?: unknown };
  return typeof id === "string" && id.length > 0 ? id : undefined;
}

/** Разбор конверта: та же форма, что у моста (`{ id, op, args }`). */
function envelope(body: unknown): { call: Envelope } | { problem: string } {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { problem: "тело запроса не объект" };
  }
  const { id, op, args } = body as { id?: unknown; op?: unknown; args?: unknown };
  if (typeof id !== "string" || id.length === 0) return { problem: "нет `id`" };
  if (typeof op !== "string" || op.length === 0) return { problem: "нет `op`" };
  // `args` обязателен и обязан быть объектом. `null` — не «пустые
  // аргументы», а битый конверт; пропущенный — тоже, и прежде он проходил
  // (ревью Gs на #67, п. 5). То же правило в dev-сервере.
  if (args === null || typeof args !== "object" || Array.isArray(args)) {
    return { problem: "нет `args` или это не объект" };
  }
  return { call: { id, op, args: args as Record<string, unknown> } };
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
   * Настоящая читает `.sav` пакетами Foreman и в проверках её быть не
   * должно: предмет здесь — стык, а разбор сохранения покрыт у Cf3.
   */
  createSource?: (options: Record<string, unknown>) => SaveSourceLike;
}

export interface SaveApi {
  readonly router: Router;
  /** Версия API, которую объявляет библиотека; пусто — она не загрузилась. */
  readonly libraryApiVersion: string;
  /** Почему библиотека не загрузилась; пусто — загрузилась. */
  readonly loadError: string;
  close(): void;
}

/**
 * Разрешённые значения заголовка `Host`.
 *
 * Проверка обязательна, и вот почему: браузер отправляет запрос на любое
 * имя, которое разрешается в 127.0.0.1, и чужая страница может навести своё
 * имя на петлю (DNS rebinding). Без проверки сервер отдавал реальные числа
 * сохранения на запрос с чужим `Host` (ревью Gs на #67, п. 3). Петля —
 * единственная защита остальных маршрутов, и здесь она должна быть такой же.
 */
export function allowedHosts(config: Config): ReadonlySet<string> {
  const port = String(config.port);
  return new Set([
    `127.0.0.1:${port}`,
    `[::1]:${port}`,
    `localhost:${port}`,
    `${config.host}:${port}`,
  ]);
}

export async function createSaveApi(deps: SaveApiDeps): Promise<SaveApi> {
  const { config, log } = deps;
  const options: Record<string, unknown> = {
    sourceMode: config.saveSourceMode,
    // Версия, с которой совместим адаптер. Библиотека сверяет мажор (§5.5).
    expectedApiVersion: config.apiVersion,
  };
  if (config.saveDataDir !== undefined) options["saveDataDir"] = config.saveDataDir;
  if (config.saveId !== undefined) options["saveId"] = config.saveId;
  if (config.saveFilePath !== undefined) options["saveFilePath"] = config.saveFilePath;

  let source: SaveSourceLike | undefined;
  let libraryApiVersion = "";
  let loadError = "";
  if (deps.createSource !== undefined) {
    source = deps.createSource(options);
  } else {
    try {
      // Специфатор переменной, а не литерал: сборка адаптера не должна
      // зависеть от того, собрана ли библиотека (ревью Gs на #67, п. 1).
      const specifier: string = LIBRARY;
      const module = (await import(specifier)) as Partial<SaveSourceModule>;
      if (typeof module.createSaveSource !== "function") {
        throw new Error(`пакет «${LIBRARY}» не экспортирует createSaveSource()`);
      }
      source = module.createSaveSource(options);
      libraryApiVersion = module.PUBLIC_API_VERSION ?? "";
    } catch (err: unknown) {
      // Не повод не запуститься: поверхность выключена по умолчанию, а
      // падение адаптера из-за неё задело бы и тех, кто Save не включал.
      loadError = err instanceof Error ? err.message : String(err);
      log.error(
        `библиотека «${LIBRARY}» не загрузилась — чтения по сохранению отвечают ` +
          `SOURCE_UNAVAILABLE. Соберите её: npm --prefix sidecar/save-source run build`,
        err,
      );
    }
  }

  const hosts = allowedHosts(config);
  const origins = new Set(config.saveAllowOrigins);
  const timers = new Set<NodeJS.Timeout>();
  const streams = new Set<Response>();
  const router = Router();

  /** Отказ по `Host`: правило общее для всех путей поверхности, включая preflight. */
  const refuseByHost = (req: Request): string | undefined => {
    const host = req.headers.host ?? "";
    return hosts.has(host) ? undefined : `запрос с чужим Host «${host}»`;
  };

  /** Отказ по `Host` или `Origin`; `undefined` — запрос можно обслуживать. */
  const refuseByOrigin = (req: Request): string | undefined => {
    const byHost = refuseByHost(req);
    if (byHost !== undefined) return byHost;
    const origin = req.headers.origin;
    if (origin === undefined || origin === "") return undefined;
    if (origins.has(origin)) return undefined;
    return `запрос со стороннего origin «${origin}»`;
  };

  /** Заголовки доступа для разрешённого origin; без него — ничего. */
  const allowOrigin = (req: Request, res: Response): void => {
    const origin = req.headers.origin;
    if (origin !== undefined && origins.has(origin)) {
      res.setHeader("access-control-allow-origin", origin);
      res.setHeader("vary", "origin");
    }
  };

  const refuse = (res: Response, status: number, id: string | undefined, message: string): void => {
    const error = { code: "INVALID_ARGUMENT", message };
    res.status(status).json(id === undefined ? { error } : { re: id, error });
  };

  // Предполётный запрос браузера. Express отвечал бы на него 200 без
  // заголовков доступа — вид разрешения без разрешения (ревью Gs на #67,
  // п. 3). Отвечаем честно: разрешён origin — заголовки, иначе отказ.
  router.options("/", (req: Request, res: Response) => {
    // Проверка `Host` общая для всех путей поверхности, включая предполётный:
    // прежде он отвечал 204 на запрос с чужим `Host` и разрешённым origin, то
    // есть подтверждал доступ, которого нет (ревью Gs на #67). Origin ниже
    // проверяется отдельно — у него свой текст с подсказкой про флаг.
    const blocked = refuseByHost(req);
    if (blocked !== undefined) {
      log.warn(`предполётный запрос по сохранению: ${blocked}`);
      res.status(403).json({ error: { code: "INVALID_ARGUMENT", message: blocked } });
      return;
    }
    const origin = req.headers.origin;
    if (origin === undefined || !origins.has(origin)) {
      res.status(403).json({
        error: {
          code: "INVALID_ARGUMENT",
          message:
            origin === undefined
              ? "предполётный запрос без origin"
              : `origin «${origin}» не разрешён: добавьте его в FICSITAI_SAVE_ALLOW_ORIGIN`,
        },
      });
      return;
    }
    allowOrigin(req, res);
    res.setHeader("access-control-allow-methods", "POST, OPTIONS");
    res.setHeader("access-control-allow-headers", "content-type");
    res.setHeader("access-control-max-age", "600");
    res.status(204).end();
  });

  router.post("/", (req: Request, res: Response) => {
    void (async () => {
      const id = envelopeId(req.body);
      const blocked = refuseByOrigin(req);
      if (blocked !== undefined) {
        log.warn(`чтения по сохранению: ${blocked}`);
        refuse(res, 403, id, blocked);
        return;
      }
      allowOrigin(req, res);

      const parsed = envelope(req.body);
      if ("problem" in parsed) {
        // `re` сохраняем, если `id` прочитался: иначе клиент не свяжет ответ
        // со своим запросом и покажет ошибку транспорта вместо причины
        // (ревью Gs на #67, п. 5).
        refuse(res, 400, id, `конверт не в форме { id, op, args }: ${parsed.problem}`);
        return;
      }
      const call = parsed.call;

      if (!READS.has(call.op)) {
        // Отказ с причиной, а не 404: клиент читает код контракта. Запись и
        // чат сюда не относятся — у них свои пути.
        res.json({
          re: call.id,
          error: { code: "UNKNOWN_OP", message: `запрос «${call.op}» не из чтений API v0` },
        });
        return;
      }

      const shape = ARGS[call.op as keyof typeof ARGS].safeParse(call.args);
      if (!shape.success) {
        const first = shape.error.issues[0];
        const where = first === undefined ? "" : first.path.join(".");
        res.status(400).json({
          re: call.id,
          error: {
            code: "INVALID_ARGUMENT",
            message: `аргумент${where === "" ? "" : ` «${where}»`} не того типа: ${
              first?.message ?? "не разобран"
            }`,
          },
        });
        return;
      }

      if (source === undefined) {
        res.json({
          re: call.id,
          error: {
            code: "SOURCE_UNAVAILABLE",
            message: `библиотека источника Save не загружена: ${loadError}`,
          },
        });
        return;
      }

      try {
        const answer = await source[call.op as keyof SaveSourceLike](call.args);
        // Статус договаривается до 0.5.0 одним полем: чата у сохранения нет,
        // и экран чата обязан сказать это игроку, а не ждать с пустым полем
        // ввода. Та же правка в обёртке dev-сервера — расходиться им нельзя.
        const body =
          call.op === "getStatus" && answer !== null && typeof answer === "object"
            ? {
                ...(answer as Record<string, unknown>),
                assistantState: "unavailable",
                // Причину источника, если он её назвал, не затираем: его
                // важнее нашей.
                reason:
                  (answer as { reason?: unknown }).reason === "" ||
                  (answer as { reason?: unknown }).reason === undefined
                    ? NO_ASSISTANT
                    : (answer as { reason?: unknown }).reason,
              }
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
    const blocked = refuseByOrigin(req);
    if (blocked !== undefined) {
      log.warn(`поток событий по сохранению: ${blocked}`);
      res.status(403).json({ error: { code: "INVALID_ARGUMENT", message: blocked } });
      return;
    }
    allowOrigin(req, res);
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
    streams.add(res);
    const forget = (): void => {
      clearInterval(timer);
      timers.delete(timer);
      streams.delete(res);
    };
    req.on("close", forget);
    res.on("close", forget);
  });

  return {
    router,
    libraryApiVersion,
    loadError,
    close(): void {
      for (const timer of timers) clearInterval(timer);
      timers.clear();
      // Открытый поток держит соединение, и `server.close()` не доходит до
      // своего callback, пока клиент сам не отключится: адаптер висел на
      // остановке (ревью Gs на #67, п. 4). Закрываем ответы сами.
      for (const stream of streams) {
        if (!stream.writableEnded) stream.end();
      }
      streams.clear();
    },
  };
}
