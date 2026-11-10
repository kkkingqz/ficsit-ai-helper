/**
 * Логи без секретов: V-7 требует этого прямо, а токен адаптера и ключ
 * LLM-провайдера проходят через те же пути, что и ошибки.
 */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
export type Level = keyof typeof LEVELS;

const SECRET_PATTERNS: RegExp[] = [
  /([?&](?:token|key|secret|api[-_]?key)=)[^&\s"']+/gi,
  /\b(sk-[A-Za-z0-9-_]{8,})\b/g,
  /(x-anthropic-api-key:\s*)\S+/gi,
  /\b(Bearer\s+)[A-Za-z0-9._-]{8,}/gi,
];

export function redact(input: unknown): string {
  let text = typeof input === "string" ? input : safeStringify(input);
  for (const re of SECRET_PATTERNS) text = text.replace(re, "$1<скрыто>");
  return text;
}

function safeStringify(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

export interface Logger {
  debug(msg: unknown, meta?: unknown): void;
  info(msg: unknown, meta?: unknown): void;
  warn(msg: unknown, meta?: unknown): void;
  error(msg: unknown, meta?: unknown): void;
}

export function createLogger(level: Level = "info"): Logger {
  const min = LEVELS[level];
  const emit = (l: Level, msg: unknown, meta?: unknown) => {
    if (LEVELS[l] < min) return;
    const line = `${new Date().toISOString()} ${l.toUpperCase()} ${redact(msg)}`;
    const tail = meta === undefined ? "" : ` ${redact(meta)}`;
    (l === "error" || l === "warn" ? console.error : console.log)(line + tail);
  };
  return {
    debug: (m, meta) => emit("debug", m, meta),
    info: (m, meta) => emit("info", m, meta),
    warn: (m, meta) => emit("warn", m, meta),
    error: (m, meta) => emit("error", m, meta),
  };
}
