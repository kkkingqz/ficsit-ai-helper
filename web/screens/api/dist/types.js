/**
 * Публичный API мода, версия 0 — формы для страниц.
 *
 * Это перевод замороженного контракта
 * [public-api-v0.md](../../../../docs/interfaces/public-api-v0.md) в типы
 * TypeScript, а не вторая его редакция. Если здесь и там расходится — прав
 * документ: формы задаёт Co, утверждает Gs.
 *
 * Канонические правила контракта, которые видно прямо в типах:
 *
 * - enum сериализуются строками в lowerCamelCase (`itemsPerMinute`, `last15Min`);
 * - у ответа `queryMetric` есть дискриминатор `kind`: `value` против `series`;
 * - `value` равен `null` тогда и только тогда, когда `state` — `notApplicable`;
 * - ошибка — `{ code, message, details? }`;
 * - время — секунды от начала сессии.
 */
export const API_VERSION = "0.4.0";
/** Ошибка API в виде исключения: страница ловит её одним `catch`. */
export class ApiError extends Error {
    code;
    details;
    constructor(body) {
        super(body.message);
        this.name = "ApiError";
        this.code = body.code;
        this.details = body.details;
    }
}
//# sourceMappingURL=types.js.map