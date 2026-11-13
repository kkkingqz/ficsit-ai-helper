import { bridgeAvailable, createBridgeTransport } from "./bridge.js";
import { createHttpTransport } from "./http.js";
import { API_VERSION, ApiError, } from "./types.js";
/** Мажорная часть версии: расходится мажор — AI-функции отключаются (§5.5). */
function major(version) {
    return version.split(".", 1)[0] ?? version;
}
export function createApi(options = {}) {
    const transport = options.transport ??
        (bridgeAvailable()
            ? createBridgeTransport()
            : createHttpTransport(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }));
    const checkVersion = options.checkApiVersion ?? true;
    const call = async (op, args) => {
        try {
            return (await transport.call(op, args));
        }
        catch (err) {
            // Единая форма наружу: страница ловит `ApiError` и читает `code`.
            if (err instanceof ApiError)
                throw err;
            const body = typeof err === "object" && err !== null && "code" in err
                ? err
                : { code: "TRANSPORT_UNAVAILABLE", message: String(err) };
            throw new ApiError({
                code: body.code,
                message: body.message ?? "",
                ...(body.details === undefined ? {} : { details: body.details }),
            });
        }
    };
    return {
        transport: transport.kind,
        async getStatus() {
            const status = await call("getStatus", {});
            if (checkVersion && major(status.apiVersion) !== major(API_VERSION)) {
                // Не бросаем: по §5.5 при несовпадении мажора ручные функции
                // продолжают работать, а видимое сообщение — дело экрана. Поэтому
                // расхождение возвращается в статусе, а не прячется в исключении.
                return {
                    ...status,
                    apiVersionMismatch: status.apiVersionMismatch === ""
                        ? `страница собрана на API ${API_VERSION}, мод отдаёт ${status.apiVersion}`
                        : status.apiVersionMismatch,
                };
            }
            return status;
        },
        async listMetrics(args = {}) {
            return await call("listMetrics", { ...args });
        },
        async listScopes(args) {
            return await call("listScopes", { ...args });
        },
        async queryMetric(args) {
            return await call("queryMetric", { ...args });
        },
        async querySeries(args) {
            return await call("querySeries", { ...args });
        },
        on(event, handler) {
            return transport.on(event, (data) => handler(data));
        },
        close() {
            transport.close();
        },
    };
}
//# sourceMappingURL=facade.js.map