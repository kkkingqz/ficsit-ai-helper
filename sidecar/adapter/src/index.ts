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
import { ModChannel } from "./channel.js";
import { loadConfig, mcpUrlFor, normalizerUrlFor, type Config } from "./config.js";
import { ForemanSession, loadOrCreateAccount } from "./foreman.js";
import { createLogger, safeUrl, type Logger } from "./log.js";
import { createNormalizerApp } from "./normalizer.js";
import { tokenMatches } from "./token.js";
import { ChatTurns } from "./turns.js";
import { UpstreamMcp } from "./upstream.js";
import { applyWhitelist, hiddenCallRefusal, hiddenToolNames } from "./whitelist.js";

/**
 * Адаптер сайдкара: единственный `MCP_URL` Foreman и канал к моду (S2, #10).
 *
 * Собрано здесь, по одному файлу на часть: вход в Foreman и сопоставление
 * сохранения с playthrough (`foreman.ts`), ходы чата (`turns.ts`), канал мода
 * с рукопожатием и конвертом (`channel.ts`), белый список инструментов модели
 * (`whitelist.ts`), нормализатор ответов провайдера (`normalizer.ts`).
 *
 * Своих инструментов адаптер по-прежнему не пишет: они приходят от мода в
 * рукопожатии, сгенерированные из реестра операций (ARCHITECTURE §7.5,
 * правило 2).
 */

const SERVER_NAME = "ficsitai-adapter";
const SERVER_VERSION = "0.0.1";

export function createMcpServer(upstream: UpstreamMcp, channel: ModChannel, log: Logger): Server {
  // Низкоуровневый Server, а не McpServer с сахаром: список инструментов должен
  // приходить из реестра операций (S2, V-3), а не собираться из регистраций в
  // коде адаптера. Возможность `tools` объявляется сразу и пустым списком —
  // иначе Foreman получает на `tools/list` ошибку -32601 «Method not found» и
  // чат падает ещё до обращения к провайдеру (проверено на P-3).
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  );

  // Модель видит инструменты мода из рукопожатия канала и инструменты
  // игровых данных `sf-mcp`, кроме скрытых белым списком (`whitelist.ts`).
  // Пустой список отдавать нельзя: модель всё равно зовёт инструменты по
  // системному промпту, Foreman их не находит, и ход заканчивается без ответа.
  //
  // Граница доверия §7 видна здесь: имя, занятое инструментом мода,
  // вычёркивается из проброса, поэтому `sf-mcp` не может подменить операцию
  // мода. Набор больше не константа — он живёт ровно столько, сколько сессия
  // канала (протокол, §Рукопожатие).
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const modTools = channel.modTools();
    const modNames = new Set(modTools.map((tool) => tool.name));
    const all = (await upstream.listTools()).filter((tool) => !modNames.has(tool.name));
    const passthrough = applyWhitelist(all);
    log.debug(
      `tools/list: инструментов мода ${modTools.length}, ` +
        `проброшено из sf-mcp ${passthrough.length}, скрыто ${all.length - passthrough.length}`,
    );
    return { tools: [...modTools, ...passthrough] };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: args } = request.params;

    // Операции мода идут своим каналом и до `sf-mcp` не доходят. Проверка
    // стоит раньше белого списка: при совпадении имён побеждает мод (протокол,
    // §Рукопожатие), и инструмент мода не должен получить отказ за чужое имя.
    if (channel.modTools().some((tool) => tool.name === name)) {
      // `extra.signal` сообщает каналу, что ждать ответа больше некому:
      // тогда моду уходит `tool.cancel`, и он бросает работу.
      const outcome = await channel.callTool(
        name,
        (args ?? {}) as Record<string, unknown>,
        extra.signal,
      );
      if (outcome.ok) {
        return { content: [{ type: "text" as const, text: outcome.text }] };
      }
      // Ошибка инструмента — не ошибка протокола: модель должна прочитать
      // причину и сказать её игроку, а не получить обрыв хода.
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ code: outcome.code, message: outcome.message }),
          },
        ],
      };
    }

    // Скрытый инструмент модель по списку не видит, но может позвать по памяти
    // о чужом промпте. Отказ с причиной лучше тихого проброса: иначе белый
    // список выглядит соблюдённым, а данные всё равно уходят в ответ.
    const refusal = hiddenCallRefusal(name);
    if (refusal !== undefined) {
      log.warn(`вызов скрытого инструмента «${name}» отклонён`);
      throw new McpError(ErrorCode.InvalidRequest, refusal);
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
  // Аккаунт заводится при первом запуске: у сайдкара один пользователь — мод,
  // и спрашивать логин у игрока неоткуда (V-08). Пароль остаётся в файле с
  // правами 600, в логе его нет.
  const foreman = new ForemanSession(
    config.foremanBaseUrl,
    loadOrCreateAccount(config.accountPath),
    log,
  );
  const turns = new ChatTurns(foreman, log);
  const channel = new ModChannel({
    turns,
    token: config.token,
    apiVersion: config.apiVersion,
    model: config.model,
    log,
  });
  // Состояние входа в Foreman уходит моду сообщением `adapter.status`.
  foreman.onState = (state, reason) => channel.setForemanState(state, reason);

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
      foreman: { signedIn: foreman.authenticated },
      hiddenTools: hiddenToolNames(),
      mod: {
        connected: channel.connected,
        session: channel.sessionId ?? "",
        tools: channel.modTools().map((tool) => tool.name),
      },
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

    const server = createMcpServer(upstream, channel, log);
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

  // Канал мода: рукопожатие, поток и приём сообщений (протокол 1, Co-82).
  // Токен здесь в заголовке — обе стороны канала наши (§13), query-строка
  // остаётся только у Foreman, чей MCP-клиент заголовков не шлёт.
  app.use("/mod", channel.router());

  app.all("/mcp", (req: Request, res: Response) => {
    res.status(405).json({ error: "method_not_allowed", allow: "POST" });
    log.debug("не-POST на /mcp", { method: req.method });
  });

  return { app, foreman, channel };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const log = createLogger(config.logLevel);
  const { app, foreman, channel } = await createApp(config, log);

  const httpServer = app.listen(config.port, config.host);

  // Вход не блокирует запуск: лаунчер поднимает ff-server первым, но адаптер
  // не должен падать, если Foreman отстал или перезапускается. Первый запрос
  // мода войдёт сам.
  void foreman.authenticate().catch((err: unknown) => {
    log.warn("вход в Foreman при запуске не удался — повторю при первом запросе", err);
  });

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
    // Мод должен узнать об остановке строкой `bye`, а не тишиной в потоке.
    channel.closeSession("shutdown");
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
