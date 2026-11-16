import { afterEach, describe, expect, it, vi } from "vitest";
import { bridgeAvailable, createBridgeTransport, OP_TIMEOUT_MS } from "../src/bridge.js";
import { createApi } from "../src/facade.js";
import { API_VERSION, ApiError, type ApiEvents } from "../src/types.js";

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
  __ficsitaiBridgeState?: unknown;
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
  // Состояние диспетчера живёт на странице, а не в модуле: без этого
  // ожидающие запросы одной проверки видны следующей.
  delete globals.__ficsitaiBridgeState;
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

  it("ожидание «chatSend» из протокола общим сроком не снимается", async () => {
    // Отправка сразу после Stop ждёт у мода до 30 с, пока отменённый ход
    // допишется в историю (протокол канала, «Ход чата»). Общие 10 с снимали
    // ожидание раньше мода: игрок видел ошибку, а ход уже шёл у Foreman, и
    // запоздалый ответ считался потерянным (ревью Gs на #62, P1-1).
    const sent = installMod();
    vi.useFakeTimers();
    try {
      const transport = createBridgeTransport({ timeoutMs: 10_000 });
      const rejected: string[] = [];
      const status = transport.call("getStatus", {});
      const send = transport.call("chatSend", { text: "привет" });
      void status.catch(() => rejected.push("getStatus"));
      void send.catch(() => rejected.push("chatSend"));

      // 15-я секунда: общий срок вышел, срок отправки — нет.
      await vi.advanceTimersByTimeAsync(15_000);
      expect(rejected).toEqual(["getStatus"]);

      // Мод отвечает позже общего срока — ответ всё ещё ждут.
      answer(sent[1]?.payload.id as string, { turnId: "t-7" });
      await expect(send).resolves.toMatchObject({ turnId: "t-7" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("срок у «chatSend» всё же есть: 35 с, с запасом над 30 с протокола", async () => {
    installMod();
    vi.useFakeTimers();
    try {
      const transport = createBridgeTransport();
      let settled = false;
      const result = transport.call("chatSend", { text: "привет" }).catch((err: unknown) => {
        settled = true;
        return err;
      });

      await vi.advanceTimersByTimeAsync(34_000);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(2_000);
      await expect(result).resolves.toMatchObject({ code: "TRANSPORT_UNAVAILABLE" });
      expect(OP_TIMEOUT_MS["chatSend"]).toBe(35_000);
    } finally {
      vi.useRealTimers();
    }
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

describe("повторное ревью Gs на #53", () => {
  it("две копии модуля на странице делят один диспетчер", async () => {
    const sent = installMod();
    // Второй импорт с другим URL — вторая копия модуля: так страница
    // собирается из экрана и виджета разных сборок. Раньше копии подменяли
    // приёмник друг друга, и запрос первой висел до срока.
    const second = `../src/bridge.js?copy=${2}`;
    const copy = (await import(second)) as typeof import("../src/bridge.js");
    // Это действительно вторая копия модуля, а не тот же экземпляр.
    expect(copy.createBridgeTransport).not.toBe(createBridgeTransport);
    const one = createApi({ transport: createBridgeTransport(), checkApiVersion: false });
    const two = createApi({ transport: copy.createBridgeTransport(), checkApiVersion: false });

    const status = one.getStatus();
    const value = two.queryMetric({ metricId: "power.production" });
    expect(sent).toHaveLength(2);

    answer(sent[1]?.payload.id as string, { kind: "value", value: 7 });
    answer(sent[0]?.payload.id as string, { apiVersion: "0.5.0", source: "live" });

    expect((await value).value).toBe(7);
    expect((await status).source).toBe("live");
    one.close();
    two.close();
  });

  it("подменённый приёмник восстанавливается со следующего запроса", async () => {
    const sent = installMod();
    const api = createApi({ checkApiVersion: false });
    // Чужой сценарий страницы поставил свой приёмник — README обещает
    // восстановление, и оно должно быть настоящим.
    globals.__ficsitaiBridge = { receive: () => {}, stray: 0 };

    const status = api.getStatus();
    answer(sent[0]?.payload.id as string, { apiVersion: "0.5.0", source: "live" });
    expect((await status).source).toBe("live");
    api.close();
  });

  it("ответ без body и без error — ошибка транспорта, а не пустой успех", async () => {
    const sent = installMod();
    const api = createApi({ checkApiVersion: false });
    const status = api.getStatus();
    globals.__ficsitaiBridge?.receive({ re: sent[0]?.payload.id });
    // Раньше это разрешалось как `undefined`, и страница падала сырым
    // `TypeError` на первом же поле статуса.
    await expect(status).rejects.toMatchObject({ code: "TRANSPORT_UNAVAILABLE" });
    api.close();
  });

  it("причина расхождения версий одна у чтения и у события", async () => {
    const sent = installMod();
    const api = createApi();
    const seen: ApiEvents["api.status"][] = [];
    api.on("api.status", (status) => seen.push(status));

    // Форма события из контракта: `apiVersion` оно не несёт — расхождение
    // находит мод, и фасаду остаётся не потерять причину.
    globals.__ficsitaiBridge?.receive({
      event: "api.status",
      data: {
        sidecarConnected: true,
        source: "live",
        inert: false,
        apiVersionMismatch: "мод отдаёт 1.0.0",
        reason: "",
      },
    });
    // Контракт (§События): причина лежит в обоих полях и у чтения, и у
    // события — источник один.
    expect(seen[0]?.reason).toBe("мод отдаёт 1.0.0");

    const status = api.getStatus();
    answer(sent[0]?.payload.id as string, { apiVersion: "1.0.0", apiVersionMismatch: "", reason: "" });
    expect((await status).reason).toContain(API_VERSION);
    api.close();
  });
});

describe("третий круг ревью Gs на #53", () => {
  it("body: null на мосту — ошибка транспорта", async () => {
    const sent = installMod();
    const api = createApi({ checkApiVersion: false });
    const status = api.getStatus();
    globals.__ficsitaiBridge?.receive({ re: sent[0]?.payload.id, body: null });
    await expect(status).rejects.toMatchObject({ code: "TRANSPORT_UNAVAILABLE" });
    api.close();
  });
});
