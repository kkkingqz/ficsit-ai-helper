import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile, realpath, stat } from "node:fs/promises";
import { watch, type FSWatcher } from "node:fs";
import { extname, join, normalize, posix, resolve, sep } from "node:path";
import { SourceError, type DevSource } from "./source.js";
import type { ApiOperation } from "../types.js";

/**
 * Dev-сервер экранов (S6): раздаёт страницы, отдаёт API v0 и перезагружает
 * вкладку при правке файла.
 *
 * Он не повторяет адаптер и не заменяет игру. Его дело — чтобы экран,
 * написанный один раз, открывался в браузере на выбранном источнике: Fixture
 * и Recording от Gf2, Save от Cf3, демонстрационный — свой.
 *
 * Конверт запроса тот же, что на мосту в игре (`{ id, op, args }`), и это
 * сделано нарочно: разница между средами остаётся в транспорте фасада, а не
 * расползается в формы.
 */

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

const OPERATIONS: ReadonlySet<string> = new Set<ApiOperation>([
  "getStatus",
  "listMetrics",
  "listScopes",
  "queryMetric",
  "querySeries",
  "chatSend",
  "chatCancel",
  "chatHistory",
]);

/** Запросы чата: источник может их не реализовывать (`DevSource`). */
const CHAT_OPERATIONS: ReadonlySet<string> = new Set<ApiOperation>([
  "chatSend",
  "chatCancel",
  "chatHistory",
]);

/** Клиент горячей перезагрузки: страница подключает его одной строкой. */
const RELOAD_CLIENT = `// Горячая перезагрузка dev-сервера (S6). Подключается только в браузере.
const source = new EventSource("/api/v0/events");
source.addEventListener("reload", () => location.reload());
`;

export interface DevServerOptions {
  /** Каталог со страницами. */
  root: string;
  /**
   * Дополнительные каталоги: адресный префикс → каталог на диске.
   *
   * Нужны потому, что экран может ссылаться за пределы корня страниц:
   * «Статистика» просит uPlot из `third_party/` рядом с `web/`, и с одним
   * корнем либо он, либо `ui-kit/` неизбежно отдавал 404. Запуск с
   * `--mount /third_party=third_party` закрывает это, не перенося чужие
   * файлы и не правя чужую страницу.
   *
   * За изменениями в этих каталогах сервер не следит: там лежит вендор,
   * а горячая перезагрузка нужна для своего кода.
   */
  mounts?: Readonly<Record<string, string>>;
  source: DevSource;
  port?: number;
  host?: string;
  /** Следить ли за файлами и перезагружать вкладку. */
  watch?: boolean;
  log?: (message: string) => void;
}

export interface DevServer {
  readonly port: number;
  readonly url: string;
  close(): Promise<void>;
}

interface Listener {
  res: ServerResponse;
}

export async function startDevServer(options: DevServerOptions): Promise<DevServer> {
  const root = resolve(options.root);
  // Префиксы с самого длинного: `/third_party/uplot` должен победить
  // `/third_party`, если заданы оба.
  const mounts = Object.entries(options.mounts ?? {})
    .map(([prefix, dir]) => {
      // Пустой каталог — отказ до старта, а не `resolve("")`: тот даёт
      // каталог запуска, и статика молча расширялась до него (ревью Gs на
      // #66). Промах во флаге не должен открывать половину диска.
      if (dir.trim() === "") {
        throw new Error(`врезка «${prefix}» без каталога: --mount ждёт пару вида /префикс=каталог`);
      }
      return { prefix: `/${prefix.replace(/^\/+|\/+$/g, "")}`, dir: resolve(dir) };
    })
    .filter((mount) => mount.prefix !== "/")
    .sort((left, right) => right.prefix.length - left.prefix.length);
  const host = options.host ?? "127.0.0.1";
  const log = options.log ?? ((message: string) => console.log(message));
  const listeners = new Set<Listener>();

  const broadcast = (event: string, data: unknown): void => {
    const line = `event: ${event}\ndata: ${JSON.stringify(data ?? null)}\n\n`;
    for (const listener of listeners) {
      if (!listener.res.writableEnded) listener.res.write(line);
    }
  };

  const unsubscribe = options.source.subscribe?.((event, data) => broadcast(event, data));

  let watcher: FSWatcher | undefined;
  if (options.watch !== false) {
    let pending: NodeJS.Timeout | undefined;
    watcher = watch(root, { recursive: true }, (_event, file) => {
      // Правки приходят пачками: один файл — несколько событий.
      if (pending !== undefined) clearTimeout(pending);
      pending = setTimeout(() => {
        log(`изменился ${String(file)} — перезагружаю вкладки`);
        broadcast("reload", { file: String(file) });
      }, 50);
    });
  }

  const sendJson = (res: ServerResponse, status: number, body: unknown): void => {
    const text = JSON.stringify(body);
    res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "content-length": Buffer.byteLength(text),
    });
    res.end(text);
  };

  const handleApi = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);

    let envelope: { id?: string; op?: string; args?: Record<string, unknown> };
    try {
      envelope = JSON.parse(Buffer.concat(chunks).toString("utf8")) as typeof envelope;
    } catch {
      sendJson(res, 400, { error: { code: "INVALID_ARGUMENT", message: "тело не JSON" } });
      return;
    }

    // Форма конверта проверяется до обработки: тело `null` раньше давало 500
    // вместо кода контракта (ревью Gs на #53).
    if (envelope === null || typeof envelope !== "object" || Array.isArray(envelope)) {
      sendJson(res, 400, {
        error: { code: "INVALID_ARGUMENT", message: "конверт должен быть объектом" },
      });
      return;
    }

    // Конверт S8 — это `{ id, op, args }` целиком: без `id` ответ некому
    // соотнести с запросом, а `args: null` — не «нет аргументов», а битый
    // конверт. И то и другое раньше проходило до источника (повторное ревью
    // Gs на #53).
    const { id, op, args } = envelope;
    if (typeof id !== "string" || id === "") {
      sendJson(res, 400, {
        error: { code: "INVALID_ARGUMENT", message: "в конверте нужен непустой id" },
      });
      return;
    }
    if (typeof args !== "object" || args === null || Array.isArray(args)) {
      sendJson(res, 400, {
        re: id,
        error: { code: "INVALID_ARGUMENT", message: "args должен быть объектом" },
      });
      return;
    }
    if (typeof op !== "string" || !OPERATIONS.has(op)) {
      sendJson(res, 200, {
        re: id,
        error: { code: "UNKNOWN_OP", message: `запрос «${String(op)}» не из API v0` },
      });
      return;
    }

    const source = options.source as unknown as Record<
      string,
      ((a: unknown) => unknown) | undefined
    >;
    if (typeof source[op] !== "function") {
      // Чат у источника необязателен: набор Fixture, запись и сохранение
      // ассистента не содержат. Это не «запрос не из API» — по контракту
      // запрос чата без связи с сайдкаром отвечает `SIDECAR_UNAVAILABLE`
      // сразу, без ожидания, и экран показывает офлайн-состояние, а не ошибку
      // сборки.
      const unavailable = CHAT_OPERATIONS.has(op);
      sendJson(res, 200, {
        re: id,
        error: unavailable
          ? {
              code: "SIDECAR_UNAVAILABLE",
              message: `у источника «${options.source.name}» нет ассистента`,
            }
          : {
              code: "SOURCE_UNAVAILABLE",
              message: `источник «${options.source.name}» не отвечает на «${op}»`,
            },
      });
      return;
    }

    try {
      const body = await source[op]?.(args);
      sendJson(res, 200, { re: id, body });
    } catch (err: unknown) {
      if (err instanceof SourceError) {
        // Ошибка контракта — обычный ответ: экран читает код, а не падает.
        sendJson(res, 200, { re: id, error: err.body });
        return;
      }
      log(`источник «${options.source.name}» сорвался на «${op}»: ${String(err)}`);
      sendJson(res, 200, {
        re: id,
        error: {
          code: "SOURCE_UNAVAILABLE",
          message: err instanceof Error ? err.message : String(err),
        },
      });
    }
  };

  const handleEvents = (res: ServerResponse): void => {
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    });
    res.flushHeaders?.();
    const listener: Listener = { res };
    listeners.add(listener);
    res.write(`event: ready\ndata: ${JSON.stringify({ source: options.source.name })}\n\n`);
    res.on("close", () => listeners.delete(listener));
  };

  /**
   * Каталог и путь внутри него: сначала врезки, иначе корень страниц.
   *
   * Выбор идёт по **адресному** пути, а не по пути файловой системы:
   * `path.normalize` на Windows меняет прямые слеши на обратные, и
   * `/third_party/uplot/…` перестал бы совпадать с префиксом `/third_party`
   * — запрос uPlot уходил бы в корень страниц и получал 404 (ревью Gs на
   * #66). `posix.normalize` ведёт себя одинаково на всех системах.
   */
  const baseFor = (urlPath: string): { base: string; inside: string } => {
    const clean = posix.normalize(urlPath.startsWith("/") ? urlPath : `/${urlPath}`);
    for (const mount of mounts) {
      if (clean === mount.prefix || clean.startsWith(`${mount.prefix}/`)) {
        return { base: mount.dir, inside: clean.slice(mount.prefix.length) };
      }
    }
    return { base: root, inside: clean };
  };

  const handleStatic = async (pathname: string, res: ServerResponse): Promise<void> => {
    // Выход за корень закрыт до любого обращения к диску: dev-сервер открыт
    // на петле, но каталог страниц — не весь диск. Для врезки правило то же
    // и проверяется против её каталога, а не против корня.
    const { base, inside } = baseFor(decodeURIComponent(pathname));
    const relative = normalize(inside).replace(/^(\.\.(\/|\\|$))+/, "");
    let file = join(base, relative);
    if (!file.startsWith(base + sep) && file !== base) {
      sendJson(res, 403, { error: { code: "INVALID_ARGUMENT", message: "путь вне каталога" } });
      return;
    }

    try {
      const info = await stat(file);
      if (info.isDirectory()) file = join(file, "index.html");
      // Проверка строки пути не ловит символические ссылки: файл рядом с
      // корнем отдавался по ссылке из корня (ревью Gs на #53). Поэтому
      // смотрим фактический путь, уже разрешённый.
      const real = await realpath(file);
      const realRoot = await realpath(base);
      if (!real.startsWith(realRoot + sep) && real !== realRoot) {
        sendJson(res, 403, {
          error: { code: "INVALID_ARGUMENT", message: "путь вне каталога после разрешения ссылок" },
        });
        return;
      }
      const body = await readFile(real);
      res.writeHead(200, {
        "content-type": TYPES[extname(real)] ?? "application/octet-stream",
        // Горячая перезагрузка бессмысленна поверх кэша браузера.
        "cache-control": "no-store",
      });
      res.end(body);
    } catch {
      sendJson(res, 404, { error: { code: "SOURCE_UNAVAILABLE", message: `нет файла ${relative}` } });
    }
  };

  const server: Server = createServer((req, res) => {
    void (async () => {
      // Адрес разбирается внутри обработчика: сырой запрос вида `GET //[`
      // роняет `new URL`, и прежде это уносило весь процесс (повторное
      // ревью Gs на #53).
      let url: URL;
      try {
        url = new URL(req.url ?? "/", `http://${host}`);
      } catch {
        sendJson(res, 400, {
          error: { code: "INVALID_ARGUMENT", message: "некорректный адрес запроса" },
        });
        return;
      }
      try {
        if (url.pathname === "/api/v0" && req.method === "POST") {
          await handleApi(req, res);
          return;
        }
        if (url.pathname === "/api/v0/events" && req.method === "GET") {
          handleEvents(res);
          return;
        }
        if (url.pathname === "/api/v0/reload.js") {
          res.writeHead(200, { "content-type": TYPES[".js"] as string, "cache-control": "no-store" });
          res.end(RELOAD_CLIENT);
          return;
        }
        await handleStatic(url.pathname, res);
      } catch (err: unknown) {
        log(`ошибка обработки ${url.pathname}: ${String(err)}`);
        if (!res.headersSent) sendJson(res, 500, { error: { code: "SOURCE_UNAVAILABLE", message: "ошибка сервера" } });
      }
    })();
  });

  await new Promise<void>((done) => server.listen(options.port ?? 0, host, done));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : (options.port ?? 0);

  return {
    port,
    url: `http://${host}:${port}`,
    close: async () => {
      unsubscribe?.();
      watcher?.close();
      for (const listener of listeners) listener.res.end();
      listeners.clear();
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
}
