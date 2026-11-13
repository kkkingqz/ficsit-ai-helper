/** Ошибка в форме контракта — её источник бросает, сервер отдаёт как есть. */
export class SourceError extends Error {
    body;
    constructor(code, message, details) {
        super(message);
        this.name = "SourceError";
        this.body = details === undefined ? { code, message } : { code, message, details };
    }
}
//# sourceMappingURL=source.js.map