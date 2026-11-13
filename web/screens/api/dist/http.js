import { EventHub, toErrorBody, transportError } from "./transport.js";
export function createHttpTransport(options = {}) {
    const base = (options.baseUrl ?? "").replace(/\/+$/, "");
    const doFetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    const hub = new EventHub();
    let seq = 0;
    const prefix = Math.random().toString(36).slice(2, 8);
    let stream;
    if (options.events !== false) {
        const Source = globalThis.EventSource;
        if (Source !== undefined) {
            stream = new Source(`${base}/api/v0/events`);
            // Имена событий API v0 — это и есть имена событий потока.
            for (const name of ["metrics.snapshot", "mod.inert", "api.status"]) {
                stream.addEventListener(name, (event) => {
                    try {
                        hub.emit(name, JSON.parse(event.data ?? "null"));
                    }
                    catch {
                        hub.emit(name, undefined);
                    }
                });
            }
        }
    }
    return {
        kind: "http",
        async call(op, args) {
            seq += 1;
            const id = `${prefix}-${seq}`;
            let response;
            try {
                response = await doFetch(`${base}/api/v0`, {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ id, op, args }),
                });
            }
            catch (err) {
                // Источник не поднят или страница открыта не с dev-сервера.
                throw toErrorBody(err, "TRANSPORT_UNAVAILABLE");
            }
            let payload;
            try {
                payload = (await response.json());
            }
            catch (err) {
                throw toErrorBody(err, "TRANSPORT_UNAVAILABLE");
            }
            if (payload.error !== undefined) {
                throw toErrorBody(payload.error, "TRANSPORT_UNAVAILABLE");
            }
            if (!response.ok) {
                throw transportError("TRANSPORT_UNAVAILABLE", `dev-сервер ответил ${response.status}`);
            }
            return payload.body;
        },
        on(event, handler) {
            return hub.on(event, handler);
        },
        close() {
            stream?.close();
            hub.clear();
        },
    };
}
//# sourceMappingURL=http.js.map