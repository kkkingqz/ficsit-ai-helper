import { afterEach, describe, expect, it } from "vitest";
import { bridgeAvailable, createBridgeTransport } from "../src/bridge.js";
import { createApi } from "../src/facade.js";
import { API_VERSION, ApiError } from "../src/types.js";

/**
 * Мост в игре: конверт, корреляция и три правила, которые соблюдает фасад,
 * а не мод (`web-runtime-plugin.md`, раздел «Конверт — для фасада Co2»).
 */

interface Sent {
  channel: string;
  payload: { id: string; op: string; args: Record<string, unknown> };
}

const globals = globalThis as unknown as {
  blu_event?: (channel: string, payload: string) => void;
  __ficsitaiBridge?: { receive(message: unknown): void; stray: number };
};

function installMod(): Sent[] {
  const sent: Sent[] = [];
  globals.blu_event = (channel, payload) => {
    sent.push({ channel, payload: JSON.parse(payload) as Sent["payload"] });
  };
  return sent;
}

const answer = (id: string, body: unknown): void => globals.__ficsitaiBridge?.receive({ re: id, body });
const fail = (id: string, error: unknown): void => globals.__ficsitaiBridge?.receive({ re: id, error });

afterEach(() => {
  delete globals.blu_event;
  delete globals.__ficsitaiBridge;
});

describe("транспорт моста", () => {
  it("виден только в игре", () => {
    expect(bridgeAvailable()).toBe(false);
    installMod();
    expect(bridgeAvailable()).toBe(true);
  });

  it("шлёт конверт в свой канал и ждёт ответа по id", async () => {
    const sent = installMod();
    const transport = createBridgeTransport();

    const call = transport.call("queryMetric", { metricId: "power.production" });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.channel).toBe("ficsitai.bridge");
    expect(sent[0]?.payload.op).toBe("queryMetric");
    expect(sent[0]?.payload.args).toEqual({ metricId: "power.production" });

    answer(sent[0]?.payload.id as string, { kind: "value", value: 412.5 });
    expect(await call).toMatchObject({ value: 412.5 });
  });

  it("идентификаторы не повторяются и несут префикс страницы", async () => {
    const sent = installMod();
    const transport = createBridgeTransport();
    void transport.call("getStatus", {});
    void transport.call("getStatus", {});
    const [first, second] = sent.map((entry) => entry.payload.id);
    expect(first).not.toBe(second);
    // Префикс общий, счётчик разный: ответ прежней страницы в новую не попадёт.
    expect(first?.split("-")[0]).toBe(second?.split("-")[0]);
  });

  it("конверт больше 64 КиБ не уходит: мод отбросил бы его без ответа", async () => {
    installMod();
    const transport = createBridgeTransport();
    await expect(
      transport.call("queryMetric", { metricId: "x".repeat(70 * 1024) }),
    ).rejects.toMatchObject({ code: "TOO_LARGE" });
  });

  it("ответ с незнакомым re пропускается и ничего не ломает", async () => {
    const sent = installMod();
    const transport = createBridgeTransport();
    const call = transport.call("getStatus", {});

    // Счётчик живёт на странице, а не на фасаде: считаем прирост.
    const before = globals.__ficsitaiBridge?.stray ?? 0;
    globals.__ficsitaiBridge?.receive({ re: "чужой-7", body: { apiVersion: "0.4.0" } });
    expect((globals.__ficsitaiBridge?.stray ?? 0) - before).toBe(1);

    answer(sent[0]?.payload.id as string, { apiVersion: "0.4.0" });
    expect(await call).toMatchObject({ apiVersion: "0.4.0" });
  });

  it("ошибка мода приходит кодом контракта", async () => {
    const sent = installMod();
    const transport = createBridgeTransport();
    const call = transport.call("queryMetric", { metricId: "нет" });
    fail(sent[0]?.payload.id as string, { code: "UNKNOWN_METRIC", message: "нет такой" });
    await expect(call).rejects.toMatchObject({ code: "UNKNOWN_METRIC" });
  });

  it("молчание мода заканчивается ошибкой, а не вечным ожиданием", async () => {
    installMod();
    const transport = createBridgeTransport({ timeoutMs: 20 });
    await expect(transport.call("getStatus", {})).rejects.toMatchObject({
      code: "TRANSPORT_UNAVAILABLE",
    });
  });

  it("события мода доходят до подписчика", async () => {
    installMod();
    const transport = createBridgeTransport();
    const seen: unknown[] = [];
    transport.on("metrics.snapshot", (data) => seen.push(data));
    globals.__ficsitaiBridge?.receive({
      event: "metrics.snapshot",
      data: { sessionTimeSec: 10, changedMetricIds: ["power.production"], source: "live" },
    });
    expect(seen).toHaveLength(1);
  });
});

describe("фасад поверх моста", () => {
  it("выбирает мост сам, когда страница в игре", async () => {
    const sent = installMod();
    const api = createApi();
    expect(api.transport).toBe("bridge");

    const status = api.getStatus();
    answer(sent[0]?.payload.id as string, {
      apiVersion: "0.4.0",
      saveId: "s",
      source: "live",
      inert: false,
      lastSnapshotSessionTimeSec: 10,
      sidecarConnected: true,
      apiVersionMismatch: "",
      reason: "",
    });
    expect((await status).source).toBe("live");
    api.close();
  });

  it("чужой мажор API виден в статусе, а не падением", async () => {
    const sent = installMod();
    const api = createApi();
    const status = api.getStatus();
    answer(sent[0]?.payload.id as string, {
      apiVersion: "1.0.0",
      saveId: "s",
      source: "live",
      inert: false,
      lastSnapshotSessionTimeSec: 0,
      sidecarConnected: true,
      apiVersionMismatch: "",
      reason: "",
    });
    // По §5.5 ручные функции продолжают работать, поэтому расхождение —
    // это поле статуса, а не исключение: показать его решает экран.
    expect((await status).apiVersionMismatch).toContain(API_VERSION);
    api.close();
  });

  it("ошибка приходит как ApiError с кодом", async () => {
    const sent = installMod();
    const api = createApi();
    const call = api.queryMetric({ metricId: "нет" });
    fail(sent[0]?.payload.id as string, { code: "UNKNOWN_METRIC", message: "нет такой" });
    await expect(call).rejects.toBeInstanceOf(ApiError);
    await expect(call).rejects.toMatchObject({ code: "UNKNOWN_METRIC" });
    api.close();
  });
});

describe("замечания ревью Gs на #53", () => {
  it("два фасада на странице не забирают ответы друг у друга", async () => {
    const sent = installMod();
    const first = createApi({ checkApiVersion: false });
    const second = createApi({ checkApiVersion: false });

    const firstCall = first.getStatus();
    const secondCall = second.queryMetric({ metricId: "power.production" });
    expect(sent).toHaveLength(2);

    // Отвечаем в обратном порядке: диспетчер на странице один, и каждый
    // ответ должен найти своего ожидающего (раньше второй фасад подменял
    // приёмник, и запрос первого висел вечно).
    answer(sent[1]?.payload.id as string, { kind: "value", value: 7 });
    answer(sent[0]?.payload.id as string, { apiVersion: "0.5.0", source: "live" });

    expect((await secondCall).value).toBe(7);
    expect((await firstCall).source).toBe("live");
    first.close();
    second.close();
  });

  it("закрытие фасада завершает его ожидающие запросы", async () => {
    installMod();
    const api = createApi({ checkApiVersion: false });
    const call = api.getStatus();
    api.close();
    // Без этого страница ждала бы ответа, которого уже никто не примет.
    await expect(call).rejects.toMatchObject({ code: "TRANSPORT_UNAVAILABLE" });
  });

  it("расхождение версии видно и когда мод не прислал поле", async () => {
    const sent = installMod();
    const api = createApi();
    const status = api.getStatus();
    // Ответ без `apiVersionMismatch`: подстановка раньше срабатывала только
    // для пустой строки, и причина уезжала как undefined.
    answer(sent[0]?.payload.id as string, { apiVersion: "1.0.0", source: "live" });
    expect((await status).apiVersionMismatch).toContain("1.0.0");
    api.close();
  });
});
