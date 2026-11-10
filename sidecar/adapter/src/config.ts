import { z } from "zod";

/**
 * Конфигурация адаптера. Всё — из окружения: лаунчер генерирует секреты и
 * передаёт их процессу, в репозитории значений нет.
 *
 * Хост жёстко ограничен петлёй: критерий V-08 требует, чтобы брандмауэр не
 * спрашивал разрешений, а S2 — чтобы у Foreman был единственный MCP_URL на
 * 127.0.0.1. Поэтому не-loopback адрес не предупреждение, а отказ запуска.
 */
const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);

const schema = z.object({
  host: z
    .string()
    .default("127.0.0.1")
    .refine((h) => LOOPBACK.has(h), {
      message:
        "адаптер слушает только петлю (127.0.0.1, ::1): входящих соединений извне в схеме нет",
    }),
  port: z.coerce.number().int().min(1).max(65535).default(8730),
  /** Токен из query MCP_URL: Foreman передаёт его в строке запроса. */
  token: z.string().min(16, "ADAPTER_TOKEN короче 16 символов — генерирует лаунчер"),
  /** Куда адаптер ходит за чатом и playthrough. */
  foremanBaseUrl: z.string().url().default("http://127.0.0.1:8724"),
  /** MCP-сервер Foreman: наружу модели не выставляется, прячется белым списком. */
  sfMcpUrl: z.string().url().default("http://127.0.0.1:8723/mcp"),
  /** Версия публичного API мода, с которой адаптер совместим (docs/interfaces/public-api-v0.md). */
  apiVersion: z.string().default("0.1.0"),
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse({
    host: env.ADAPTER_HOST,
    port: env.ADAPTER_PORT,
    token: env.ADAPTER_TOKEN,
    foremanBaseUrl: env.FOREMAN_BASE_URL,
    sfMcpUrl: env.SF_MCP_URL,
    apiVersion: env.FICSITAI_API_VERSION,
    logLevel: env.ADAPTER_LOG_LEVEL,
  });

  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join(".") || "(корень)"}: ${i.message}`);
    throw new Error(`не настроено окружение адаптера:\n${lines.join("\n")}`);
  }
  return parsed.data;
}

/** Строка, которую лаунчер кладёт в MCP_URL Foreman. */
export function mcpUrlFor(config: Config): string {
  const host = config.host === "::1" ? "[::1]" : config.host;
  return `http://${host}:${config.port}/mcp?token=${config.token}`;
}
