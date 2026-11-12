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
  /**
   * Версия публичного API мода, с которой адаптер совместим
   * (docs/interfaces/public-api-v0.md). Значение по умолчанию идёт за
   * контрактом: 0.4.0 с 10.11.2026 (Gs-13). Пока шло ревью Gs-11, контракт
   * уехал с 0.1.0 на 0.3.0 и затем на 0.4.0 — константа здесь дублирует
   * документ там, где это не видно глазами, поэтому проверка на совпадение
   * в CI попрошена у Gf2 (Co2-12). Проверку несовместимого мажора при
   * подключении делает S2, когда появится канал мода.
   */
  apiVersion: z.string().default("0.4.0"),
  /**
   * Настоящий адрес LLM-провайдера. Задан — поднимается нормализатор ответов
   * (ADR-034) на своём порту, и `LLM_BASE_URL` Foreman указывает на него.
   * Не задан — нормализатор не поднимается, Foreman ходит к провайдеру сам.
   */
  llmUpstreamBaseUrl: z.string().url().optional(),
  normalizerPort: z.coerce.number().int().min(1).max(65535).default(8731),
  /**
   * Файл с учётными данными локального аккаунта Foreman (S2). Создаётся
   * адаптером при первом запуске с правами 600 и лежит рядом с базой Foreman,
   * вне репозитория. Путь задаёт лаунчер: сам адаптер каталог данных не
   * выбирает, иначе их стало бы два.
   */
  accountPath: z.string().min(1).default(defaultAccountPath()),
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

/** `~/.local/share/ficsitai/foreman/adapter-account.json` по умолчанию XDG. */
function defaultAccountPath(): string {
  const base =
    process.env.XDG_DATA_HOME !== undefined && process.env.XDG_DATA_HOME.length > 0
      ? process.env.XDG_DATA_HOME
      : `${process.env.HOME ?? "."}/.local/share`;
  return `${base}/ficsitai/foreman/adapter-account.json`;
}

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse({
    host: env.ADAPTER_HOST,
    port: env.ADAPTER_PORT,
    token: env.ADAPTER_TOKEN,
    foremanBaseUrl: env.FOREMAN_BASE_URL,
    sfMcpUrl: env.SF_MCP_URL,
    apiVersion: env.FICSITAI_API_VERSION,
    llmUpstreamBaseUrl: env.LLM_UPSTREAM_BASE_URL,
    normalizerPort: env.NORMALIZER_PORT,
    accountPath: env.FOREMAN_ACCOUNT_PATH,
    logLevel: env.ADAPTER_LOG_LEVEL,
  });

  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join(".") || "(корень)"}: ${i.message}`);
    throw new Error(`не настроено окружение адаптера:\n${lines.join("\n")}`);
  }
  return parsed.data;
}

/** Строка, которую лаунчер кладёт в LLM_BASE_URL Foreman, когда нормализатор включён. */
export function normalizerUrlFor(config: Config): string | undefined {
  if (config.llmUpstreamBaseUrl === undefined) return undefined;
  const host = config.host === "::1" ? "[::1]" : config.host;
  return `http://${host}:${config.normalizerPort}`;
}

/** Строка, которую лаунчер кладёт в MCP_URL Foreman. */
export function mcpUrlFor(config: Config): string {
  const host = config.host === "::1" ? "[::1]" : config.host;
  return `http://${host}:${config.port}/mcp?token=${config.token}`;
}
