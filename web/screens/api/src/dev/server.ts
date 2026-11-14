import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { watch, type FSWatcher } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
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
]);

/** Клиент горячей перезагрузки: страница подключает его одной строкой. */
const RELOAD_CLIENT = `// Горячая перезагрузка dev-сервера (S6). Подключается только в браузере.
const source = new EventSource("/api/v0/events");
source.addEventListener("reload", () => location.reload());
`;

export interface DevServerOptions {
  /** Каталог со страницами. */
  root: string;
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

    const { id, op } = envelope;
    const args = envelope.args ?? {};
    if (typeof op !== "string" || !OPERATIONS.has(op)) {
      sendJson(res, 200, {
        re: id,
        error: { code: "UNKNOWN_OP", message: `запрос «${String(op)}» не из API v0` },
      });
      return;
    }

    try {
      const source = options.source as unknown as Record<string, (a: unknown) => unknown>;
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

  const handleStatic = async (pathname: string, res: ServerResponse): Promise<void> => {
    // Выход за корень закрыт до любого обращения к диску: dev-сервер открыт
    // на петле, но каталог страниц — не весь диск.
    const relative = normalize(decodeURIComponent(pathname)).replace(/^(\.\.(\/|\\|$))+/, "");
    let file = join(root, relative);
    if (!file.startsWith(root + sep) && file !== root) {
      sendJson(res, 403, { error: { code: "INVALID_ARGUMENT", message: "путь вне каталога" } });
      return;
    }

    try {
      const info = await stat(file);
      if (info.isDirectory()) file = join(file, "index.html");
      const body = await readFile(file);
      res.writeHead(200, {
        "content-type": TYPES[extname(file)] ?? "application/octet-stream",
        // Горячая перезагрузка бессмысленна поверх кэша браузера.
        "cache-control": "no-store",
      });
      res.end(body);
    } catch {
      sendJson(res, 404, { error: { code: "SOURCE_UNAVAILABLE", message: `нет файла ${relative}` } });
    }
  };

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${host}`);
    void (async () => {
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
