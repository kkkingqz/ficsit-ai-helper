import { type Transport } from "./transport.js";
/** Доступен ли мост: страница открыта в игре, а не в браузере. */
export declare function bridgeAvailable(): boolean;
export interface BridgeOptions {
    /**
     * Сколько ждать ответа моста. Мост отвечает за кадр (замер S8: медиана
     * 13 мс), поэтому молчание дольше секунд — это не медленно, а потеряно:
     * испорченный конверт мод отбрасывает без ответа. Без срока промис висел
     * бы вечно и экран замер бы молча.
     */
    timeoutMs?: number;
}
export declare function createBridgeTransport(options?: BridgeOptions): Transport;
