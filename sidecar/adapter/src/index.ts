import { timingSafeEqual } from "node:crypto";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import express, { type Request, type Response } from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { loadConfig, mcpUrlFor, normalizerUrlFor, type Config } from "./config.js";
import { createLogger, safeUrl, type Logger } from "./log.js";
import { createNormalizerApp } from "./normalizer.js";
import { UpstreamMcp } from "./upstream.js";

/**
 * Каркас адаптера (P-3, задача #4).
 *
 * Чем он станет в S2 (#10): единственный `MCP_URL` Foreman, автоматический вход
 * в Foreman, сопоставление `saveId` с playthrough, API чата поверх SSE,
 * белый список инструментов и исходящий канал к моду. Здесь — только рама:
 * петлевой слушатель, проверка токена, MCP-эндпоинт без инструментов и
 * здоровье. Инструменты появятся из реестра операций (V-3), а не напишутся
 * здесь: описания генерируются из реестра (ARCHITECTURE §7.5, правило 2).
 */

const SERVER_NAME = "ficsitai-adapter";
const SERVER_VERSION = "0.0.1";

/**
 * Инструменты мода — из реестра операций (V-3), а не из `sf-mcp`. В v0 набор
 * пуст: канала мода ещё нет (S2).
 *
 * Он здесь, чтобы граница была в коде, а не в голове (граница доверия §7,
 * Co-29): проброс `sf-mcp` ниже до операций мода не дотягивается, потому что
 * имена из этого набора в него не попадают, и `sf-mcp` не может занять имя
 * инструмента мода — список фильтруется по тому же набору.
 */
const MOD_TOOL_NAMES = new Set<string>();

function tokenMatches(expected: string, given: unknown): boolean {
  if (typeof given !== "string") return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function createMcpServer(upstream: UpstreamMcp, log: Logger): Server {
  // Низкоуровневый Server, а не McpServer с сахаром: список инструментов должен
  // приходить из реестра операций (S2, V-3), а не собираться из регистраций в
  // коде адаптера. Возможность `tools` объявляется сразу и пустым списком —
  // иначе Foreman получает на `tools/list` ошибку -32601 «Method not found» и
  // чат падает ещё до обращения к провайдеру (проверено на P-3).
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  );

  // v0: инструменты игровых данных Foreman проходят насквозь — иначе модель
  // зовёт их по системному промпту Foreman, и ход обрывается без ответа.
  // Белый список и свои инструменты из реестра надеваются сверху в S2 и V-3.
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const passthrough = (await upstream.listTools()).filter((tool) => !MOD_TOOL_NAMES.has(tool.name));
    log.debug(
      `tools/list: инструментов мода ${MOD_TOOL_NAMES.size}, ` +
        `проброшено из sf-mcp ${passthrough.length}`,
    );
    return { tools: passthrough };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // Операции мода идут своим каналом и до `sf-mcp` не доходят.
    if (MOD_TOOL_NAMES.has(name)) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `инструмент мода «${name}» появится вместе с каналом мода (S2)`,
      );
    }

    try {
      return await upstream.callTool(name, args ?? {});
    } catch (err: unknown) {
      log.warn(`инструмент «${name}» не выполнен`, err);
      throw new McpError(
        ErrorCode.InternalError,
        `инструмент «${name}» недоступен: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  });

  return server;
}

export async function createApp(config: Config, log: Logger) {
  const upstream = new UpstreamMcp(config.sfMcpUrl, log);
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      name: SERVER_NAME,
      version: SERVER_VERSION,
      apiVersion: config.apiVersion,
      foremanBaseUrl: config.foremanBaseUrl,
      sfMcpUrl: config.sfMcpUrl,
      mod: { connected: false, reason: "канал мода появится в S2" },
    });
  });

  // Без управления сессиями: на каждый запрос — свой сервер и транспорт.
  // Это требование самого SDK (stateless-режим запрещает переиспользование
  // транспорта), а нам так и удобнее: состояние разговора держит Foreman,
  // адаптеру его дублировать нечем.
  app.post("/mcp", async (req: Request, res: Response) => {
    if (!tokenMatches(config.token, req.query.token)) {
      log.warn("отказ на /mcp: неверный токен", { method: req.method, ip: req.ip });
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    const server = createMcpServer(upstream, log);
    const transport = new StreamableHTTPServerTransport({});
    res.on("close", () => {
      void transport.close();
      void server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err: unknown) {
      log.error("ошибка обработки MCP-запроса", err);
      if (!res.headersSent) res.status(500).json({ error: "internal_error" });
    }
  });

  app.all("/mcp", (req: Request, res: Response) => {
    res.status(405).json({ error: "method_not_allowed", allow: "POST" });
    log.debug("не-POST на /mcp", { method: req.method });
  });

  return { app };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const log = createLogger(config.logLevel);
  const { app } = await createApp(config, log);

  const httpServer = app.listen(config.port, config.host);

  httpServer.on("listening", () => {
    const addr = httpServer.address();
    const port = typeof addr === "object" && addr !== null ? (addr as AddressInfo).port : config.port;
    log.info(`адаптер слушает http://${config.host}:${port} (только петля)`);
    log.info(`MCP_URL для Foreman: ${mcpUrlFor(config)}`); // токен в логе скрывается
  });

  // Без этого обработчика занятый порт выглядел как ошибка чтения address():
  // слушатель не поднялся, а падало на строке логирования (P-3, 10.11.2026).
  httpServer.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      log.error(`порт ${config.port} уже занят — остановите прежний адаптер (foreman-local.sh stop)`);
    } else {
      log.error("слушатель не поднялся", err);
    }
    process.exit(1);
  });

  // Нормализатор ответов провайдера (ADR-034): отдельный слушатель на петле в
  // этом же процессе — не новый исполняемый файл в архиве и не новая запись в
  // лаунчере, потому что каждый процесс в поставке проверяется у пилотного
  // тестера (R-11, ADR-015). Цена — связность: падает адаптер, падает и он.
  const normalizerUrl = normalizerUrlFor(config);
  const upstreamBaseUrl = config.llmUpstreamBaseUrl;
  let normalizerServer: HttpServer | undefined;
  if (upstreamBaseUrl !== undefined && normalizerUrl !== undefined) {
    const normalizer = createNormalizerApp(upstreamBaseUrl, log);
    normalizerServer = normalizer.listen(config.normalizerPort, config.host);
    normalizerServer.on("listening", () => {
      // Адрес провайдера — только схема, хост и путь: ключ ездит в строке
      // запроса, и в лог она не попадает (ревью Gs-11, п. 4).
      log.info(`нормализатор ответов слушает ${normalizerUrl} → ${safeUrl(upstreamBaseUrl)}`);
      log.info(`LLM_BASE_URL для Foreman: ${normalizerUrl}`);
    });
    normalizerServer.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        log.error(`порт нормализатора ${config.normalizerPort} занят — остановите прежний адаптер`);
      } else {
        log.error("нормализатор не поднялся", err);
      }
      process.exit(1);
    });
  } else {
    log.info("нормализатор ответов выключен: LLM_UPSTREAM_BASE_URL не задан");
  }

  const shutdown = (signal: string) => {
    log.info(`${signal}: останавливаюсь`);
    normalizerServer?.close();
    httpServer.close(() => process.exit(0));
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

function isEntrypoint(): boolean {
  const argv1 = process.argv[1];
  if (argv1 === undefined) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntrypoint()) {
  main().catch((err: unknown) => {
    console.error(`адаптер не запустился: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
