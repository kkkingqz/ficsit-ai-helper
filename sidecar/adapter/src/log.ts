/**
 * Логи без секретов: V-7 требует этого прямо, а токен адаптера и ключ
 * LLM-провайдера проходят через те же пути, что и ошибки.
 */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
export type Level = keyof typeof LEVELS;

const SECRET_PATTERNS: RegExp[] = [
  // Любой параметр запроса, в имени которого есть key/token/secret/password/
  // signature/auth. Прежний список перечислял имена целиком, и `x-goog-api-key`
  // в строке запроса оставался открытым — ревью Gs-11, п. 4.
  /([?&][\w.-]*(?:token|key|secret|password|signature|auth)[\w.-]*=)[^&\s"']+/gi,
  /\b(sk-[A-Za-z0-9-_]{8,})\b/g,
  /((?:x-anthropic-api-key|x-goog-api-key|api-key|authorization):\s*)\S+/gi,
  /\b(Bearer\s+)[A-Za-z0-9._-]{8,}/gi,
];

export function redact(input: unknown): string {
  let text = typeof input === "string" ? input : safeStringify(input);
  for (const re of SECRET_PATTERNS) text = text.replace(re, "$1<скрыто>");
  return text;
}

/**
 * Безопасная часть адреса: схема, хост, путь. Строка запроса и данные входа
 * отбрасываются целиком, а не маскируются по именам параметров.
 *
 * Почему целиком: ключ провайдера ездит именно в query, а список имён его один
 * раз уже пропустил (Gs-11, п. 4). Маскировка выше осталась сетью под теми
 * адресами, которые попадают в лог не через эту функцию, — например внутри
 * текста ошибки от библиотеки.
 */
export function safeUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return "<адрес не разобран>";
  }
}

/**
 * Отличает «на том конце ещё никто не слушает» от настоящей ошибки.
 *
 * `fetch` в Node отдаёт на отказ соединения `TypeError: fetch failed`, а
 * причину прячет в `cause.code`. В логе это выглядит как сбой, хотя при
 * холодном старте это норма: лаунчер поднимает три процесса подряд и ждёт
 * порты только после этого, поэтому адаптер успевает постучаться в ff-server
 * раньше, чем тот начал слушать (Co2-54). Строка, которая должна значить
 * беду, не должна появляться там, где беды нет.
 */
export function isConnectionRefused(value: unknown): boolean {
  const codes = new Set(["ECONNREFUSED", "ENOTFOUND", "EHOSTUNREACH", "ECONNRESET", "UND_ERR_SOCKET"]);
  let current: unknown = value;
  for (let depth = 0; depth < 5 && current !== null && typeof current === "object"; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && codes.has(code)) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
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
