/** Ошибка транспорта в форме контракта: страница ловит всё одним способом. */
export function transportError(code, message) {
    return { code, message };
}
/** Разбирает что угодно в тело ошибки контракта. */
export function toErrorBody(value, fallbackCode) {
    if (typeof value === "object" && value !== null) {
        const raw = value;
        const code = typeof raw.code === "string" ? raw.code : fallbackCode;
        const message = typeof raw.message === "string" ? raw.message : String(value);
        const body = { code, message };
        if (typeof raw.details === "object" && raw.details !== null) {
            body.details = raw.details;
        }
        return body;
    }
    return { code: fallbackCode, message: value instanceof Error ? value.message : String(value) };
}
/** Простая раздача событий по именам — общая для обоих транспортов. */
export class EventHub {
    listeners = new Map();
    on(event, handler) {
        const set = this.listeners.get(event) ?? new Set();
        set.add(handler);
        this.listeners.set(event, set);
        return () => {
            set.delete(handler);
        };
    }
    emit(event, data) {
        for (const handler of this.listeners.get(event) ?? []) {
            try {
                handler(data);
            }
            catch {
                // Ошибка одного подписчика не должна глушить остальных и транспорт.
            }
        }
    }
    clear() {
        this.listeners.clear();
    }
}
//# sourceMappingURL=transport.js.map