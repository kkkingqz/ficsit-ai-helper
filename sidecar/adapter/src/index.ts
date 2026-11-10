import { timingSafeEqual } from "node:crypto";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import express, { type Request, type Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { loadConfig, mcpUrlFor, type Config } from "./config.js";
import { createLogger, type Logger } from "./log.js";

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

function tokenMatches(expected: string, given: unknown): boolean {
  if (typeof given !== "string") return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  // Инструментов нет намеренно: до белого списка и реестра операций (S2, V-3)
  // модели выставлять нечего, а пустой список — валидный ответ MCP.
  return server;
}

export async function createApp(config: Config, log: Logger) {
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

    const server = createMcpServer();
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

  const httpServer = app.listen(config.port, config.host, () => {
    const addr = httpServer.address() as AddressInfo;
    log.info(`адаптер слушает http://${config.host}:${addr.port} (только петля)`);
    log.info(`MCP_URL для Foreman: ${mcpUrlFor(config)}`); // токен в логе скрывается
  });

  const shutdown = (signal: string) => {
    log.info(`${signal}: останавливаюсь`);
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
