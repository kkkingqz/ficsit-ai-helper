import { timingSafeEqual } from "node:crypto";

/**
 * Сравнение токена без утечки по времени. Живёт отдельным модулем, потому что
 * токен проверяют двое: MCP-эндпоинт для Foreman (токен в query — у его
 * MCP-клиента нет заголовков, §12 п. 2) и маршруты мода (токен в заголовке —
 * обе стороны канала наши, §13).
 */
export function tokenMatches(expected: string, given: unknown): boolean {
  if (typeof given !== "string") return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Токен из заголовка `Authorization: Bearer …`; иначе пустая строка. */
export function bearerToken(header: string | undefined): string {
  if (header === undefined) return "";
  const match = /^Bearer[ \t]+(\S+)$/i.exec(header.trim());
  return match?.[1] ?? "";
}
