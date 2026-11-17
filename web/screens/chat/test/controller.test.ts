import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  type ApiEventName,
  type ApiEvents,
  type ApiStatus,
  type ChatHistoryResult,
  type FicsitAIApi,
} from "@ficsitai/screens-api";
import { createChatController, type ChatController } from "../src/controller.js";
import { DEFAULT_CHAT_STRINGS } from "../src/strings.js";
import type { ChatViewHandle, ChatViewModel } from "../src/types.js";

/**
 * Контроллер чата: состояние экрана против поведения хода.
 *
 * Фасад здесь поддельный, но формы и коды — настоящие, из контракта: предмет
 * проверки в том, что экран делает с `chat.*`, а не в том, как ходит HTTP.
 */

interface FakeApi {
  api: FicsitAIApi;
  emit<K extends ApiEventName>(event: K, data: ApiEvents[K]): void;
  sent: string[];
  cancelled: string[];
  setHistory(messages: ChatHistoryResult["messages"]): void;
  failNextSend(error: ApiError): void;
  failHistory(error: ApiError): void;
  /** Порядок вызовов фасада: `send:<текст>` и `history`. */
  calls: string[];
  /** Задержать ответ на отправку; вернувшаяся функция его отпускает. */
  holdSend(): () => void;
  /** Что делает мод в тот момент, когда принимает ход (Foreman дописал). */
  onSend(hook: () => void): void;
}

function createFakeApi(status: Partial<ApiStatus> = {}): FakeApi {
  const listeners = new Map<string, ((data: unknown) => void)[]>();
  const sent: string[] = [];
  const cancelled: string[] = [];
  let history: ChatHistoryResult["messages"] = [];
  let sendError: ApiError | null = null;
  let historyError: ApiError | null = null;
  let turns = 0;
  const calls: string[] = [];
  let gate: Promise<void> | null = null;
  let openGate: (() => void) | null = null;
  let sendHook: (() => void) | null = null;

  const api = {
    transport: "http" as const,
    getStatus: async (): Promise<ApiStatus> => ({
      apiVersion: "0.5.0",
      saveId: "test",
      source: "fixture",
      inert: false,
      lastSnapshotSessionTimeSec: 10,
      sidecarConnected: true,
      apiVersionMismatch: "",
      reason: "",
      assistantState: "ready",
      assistantModel: "demo-echo",
      ...status,
    }),
    listMetrics: vi.fn(),
    listScopes: vi.fn(),
    queryMetric: vi.fn(),
    querySeries: vi.fn(),
    chatSend: async ({ text }: { text: string }) => {
      calls.push(`send:${text}`);
      if (sendError !== null) {
        const err = sendError;
        sendError = null;
        throw err;
      }
      sent.push(text);
      turns += 1;
      const turnId = `t-${turns}`;
      // Ход принят: к этому моменту мод уже дождался, пока отменённый
      // допишется в историю, — здесь это и происходит.
      sendHook?.();
      if (gate !== null) await gate;
      return { turnId };
    },
    chatCancel: async ({ turnId }: { turnId: string }) => {
      cancelled.push(turnId);
      return { state: "cancelled" as const };
    },
    chatHistory: async (): Promise<ChatHistoryResult> => {
      calls.push("history");
      if (historyError !== null) throw historyError;
      return { messages: history };
    },
    on: (event: string, handler: (data: never) => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), handler as (data: unknown) => void]);
      return () => {
        listeners.set(
          event,
          (listeners.get(event) ?? []).filter((item) => item !== handler),
        );
      };
    },
    close: vi.fn(),
  } as unknown as FicsitAIApi;

  return {
    api,
    emit(event, data) {
      for (const handler of listeners.get(event) ?? []) handler(data);
    },
    sent,
    cancelled,
    setHistory(messages) {
      history = messages;
    },
    failNextSend(error) {
      sendError = error;
    },
    failHistory(error) {
      historyError = error;
    },
    calls,
    holdSend() {
      gate = new Promise<void>((resolve) => {
        openGate = resolve;
      });
      return () => {
        openGate?.();
        gate = null;
        openGate = null;
      };
    },
    onSend(hook) {
      sendHook = hook;
    },
  };
}

interface FakeView extends ChatViewHandle {
  readonly models: ChatViewModel[];
  readonly last: ChatViewModel;
  unmounted: boolean;
}

function createFakeView(): FakeView {
  const models: ChatViewModel[] = [];
  return {
    models,
    get last() {
      return models[models.length - 1] as ChatViewModel;
    },
    unmounted: false,
    update(model) {
      models.push(model);
    },
    handleBackAction() {
      return false;
    },
    unmount() {
      this.unmounted = true;
    },
  };
}

const controllers: ChatController[] = [];

function create(fake: FakeApi, view: FakeView): ChatController {
  const controller = createChatController({
    api: fake.api,
    view,
    now: () => new Date("2026-11-16T09:41:00Z"),
  });
  controllers.push(controller);
  return controller;
}

/** Даёт отработать промисам запуска: статус и история. */
const settle = (): Promise<void> => new Promise((done) => setTimeout(done, 0));

afterEach(() => {
  while (controllers.length > 0) controllers.pop()?.destroy();
});

describe("контроллер чата", () => {
  it("на старте читает статус и историю, пустую не путает с недоступной", async () => {
    const fake = createFakeApi();
    const view = createFakeView();
    const controller = create(fake, view);
    await settle();

    expect(controller.getModel().connected).toBe(true);
    expect(controller.getModel().history).toBe("empty");
    expect(view.models.length).toBeGreaterThan(0);
  });

  it("недоступная история остаётся недоступной, а не пустой", async () => {
    const fake = createFakeApi();
    fake.failHistory(new ApiError({ code: "SIDECAR_UNAVAILABLE", message: "нет связи" }));
    const controller = create(fake, createFakeView());
    await settle();

    expect(controller.getModel().history).toBe("unavailable");
    expect(controller.getModel().connected).toBe(false);
  });

  it("ход: вопрос и ответ появляются в ленте, текст дописывается событиями", async () => {
    const fake = createFakeApi();
    const controller = create(fake, createFakeView());
    await settle();

    controller.actions.send("сколько запаса?");
    await settle();

    expect(fake.sent).toEqual(["сколько запаса?"]);
    const model = controller.getModel();
    expect(model.streaming).toBe(true);
    expect(model.sending).toBe(false);
    expect(model.messages.map((m) => m.role)).toEqual(["operator", "assistant"]);
    expect(model.messages[1]?.text).toBe("");

    fake.emit("chat.text", { turnId: "t-1", text: "Запас " });
    fake.emit("chat.text", { turnId: "t-1", text: "281 МВт." });
    expect(controller.getModel().messages[1]?.text).toBe("Запас 281 МВт.");

    fake.emit("chat.done", { turnId: "t-1", model: "gemini-demo", latencyMs: 120 });
    expect(controller.getModel().streaming).toBe(false);
    expect(controller.getModel().assistant).toContainEqual({
      label: "Model",
      value: "gemini-demo",
    });
  });

  it("чужой turnId в ленту не попадает", async () => {
    const fake = createFakeApi();
    const controller = create(fake, createFakeView());
    await settle();
    controller.actions.send("вопрос");
    await settle();

    fake.emit("chat.text", { turnId: "t-чужой", text: "не моё" });
    expect(controller.getModel().messages[1]?.text).toBe("");
  });

  it("вызов инструмента виден пометкой, а не текстом ответа", async () => {
    const fake = createFakeApi();
    const controller = create(fake, createFakeView());
    await settle();
    controller.actions.send("вопрос");
    await settle();

    fake.emit("chat.tool", { turnId: "t-1", name: "query_metric" });
    expect(controller.getModel().messages[1]?.status).toContain("query_metric");
    expect(controller.getModel().messages[1]?.text).toBe("");
  });

  it("отмена помечает сообщение и перечитывает историю после принятия хода", async () => {
    const fake = createFakeApi();
    const controller = create(fake, createFakeView());
    await settle();
    controller.actions.send("вопрос");
    await settle();

    controller.actions.stop();
    await settle();
    expect(fake.cancelled).toEqual(["t-1"]);

    fake.emit("chat.cancelled", { turnId: "t-1" });
    expect(controller.getModel().streaming).toBe(false);
    expect(controller.getModel().messages[1]?.status).toBe(
      DEFAULT_CHAT_STRINGS.host.messageStatus.stopped,
    );

    // Foreman дочитал ход: в истории лежит полный ответ.
    fake.setHistory([
      { id: "h-1", role: "user", text: "вопрос", createdAt: "2026-11-16T09:41:00.000Z" },
      {
        id: "h-2",
        role: "assistant",
        text: "полный ответ из истории",
        createdAt: "2026-11-16T09:41:03.000Z",
      },
    ]);
    controller.actions.send("следующий");
    await settle();

    const texts = controller.getModel().messages.map((m) => m.text);
    expect(texts).toContain("полный ответ из истории");
    expect(texts).toContain("следующий");
    // Рубеж: история читается после принятия хода, а не до отправки.
    expect(fake.calls).toEqual(["history", "send:вопрос", "send:следующий", "history"]);
  });

  describe("замечания ревью Gs на #62", () => {
    /** Экран после отмены: ход помечен, история ждёт дочитывания. */
    const afterStop = async (fake: FakeApi): Promise<ChatController> => {
      const controller = create(fake, createFakeView());
      await settle();
      controller.actions.send("вопрос");
      await settle();
      controller.actions.stop();
      await settle();
      fake.emit("chat.cancelled", { turnId: "t-1" });
      return controller;
    };

    it("дочитанный ответ ищется в истории после рубежа принятия хода", async () => {
      const fake = createFakeApi();
      const controller = await afterStop(fake);

      // Foreman дописывает ход ровно в тот момент, когда мод принимает
      // следующий: до этого в истории обрубок, и чтение до отправки его бы и
      // вернуло.
      fake.onSend(() => {
        fake.setHistory([
          { id: "h-1", role: "user", text: "вопрос", createdAt: "2026-11-16T09:41:00.000Z" },
          {
            id: "h-2",
            role: "assistant",
            text: "дочитанный ответ",
            createdAt: "2026-11-16T09:41:03.000Z",
          },
        ]);
      });

      controller.actions.send("следующий");
      await settle();

      const texts = controller.getModel().messages.map((item) => item.text);
      expect(texts).toContain("дочитанный ответ");
      expect(texts.filter((text) => text === "следующий")).toHaveLength(1);
    });

    it("быстрый ответ из истории не удваивается (ревью Gs на #62)", async () => {
      const fake = createFakeApi();
      const controller = await afterStop(fake);

      // Мод записывает вопрос при отправке, а ответ — как только модель
      // ответила. При быстром ответе снимок истории содержит весь новый ход,
      // и прежде лента получала вопрос дважды, а ответ — из истории и
      // потоком.
      fake.onSend(() => {
        fake.setHistory([
          { id: "h-1", role: "user", text: "вопрос", createdAt: "2026-11-17T09:00:00.000Z" },
          {
            id: "h-2",
            role: "assistant",
            text: "дочитанный ответ",
            createdAt: "2026-11-17T09:00:01.000Z",
          },
          { id: "h-3", role: "user", text: "второй", createdAt: "2026-11-17T09:00:02.000Z" },
          {
            id: "h-4",
            role: "assistant",
            text: "быстрый ответ",
            createdAt: "2026-11-17T09:00:03.000Z",
          },
        ]);
      });

      controller.actions.send("второй");
      await settle();

      const texts = controller.getModel().messages.map((item) => item.text);
      expect(texts.filter((text) => text === "второй")).toHaveLength(1);
      expect(texts.filter((text) => text === "быстрый ответ")).toHaveLength(1);
      // Пустого сообщения под поток нет: ход уже закончен, дописывать некуда.
      expect(texts).not.toContain("");
      expect(controller.getModel().streaming).toBe(false);
    });

    it("вопрос записан, а ответа ещё нет — поток ждём, вопрос не удваиваем", async () => {
      const fake = createFakeApi();
      const controller = await afterStop(fake);

      fake.onSend(() => {
        fake.setHistory([
          { id: "h-1", role: "user", text: "вопрос", createdAt: "2026-11-17T09:00:00.000Z" },
          {
            id: "h-2",
            role: "assistant",
            text: "дочитанный ответ",
            createdAt: "2026-11-17T09:00:01.000Z",
          },
          { id: "h-3", role: "user", text: "второй", createdAt: "2026-11-17T09:00:02.000Z" },
        ]);
      });

      controller.actions.send("второй");
      await settle();

      const model = controller.getModel();
      expect(model.messages.filter((item) => item.text === "второй")).toHaveLength(1);
      expect(model.streaming).toBe(true);
      // Пустое сообщение под поток есть — туда придут куски ответа.
      fake.emit("chat.text", { turnId: "t-2", text: "кусок" });
      expect(controller.getModel().messages.at(-1)?.text).toBe("кусок");
    });

    it("два Enter подряд во время ожидания мода уходят одним ходом", async () => {
      const fake = createFakeApi();
      const controller = await afterStop(fake);

      // После отмены мод вправе держать отправку до 30 с. Замок до первого
      // `await` — единственное, что мешает уйти второму ходу.
      const release = fake.holdSend();
      controller.actions.send("второй");
      controller.actions.send("третий");
      await settle();
      expect(controller.getModel().sending).toBe(true);
      release();
      await settle();

      expect(fake.sent).toEqual(["вопрос", "второй"]);
      expect(controller.getModel().streaming).toBe(true);
    });

    it("отказ отправки не стирает ход, который ещё ждёт отмены", async () => {
      const fake = createFakeApi();
      const controller = create(fake, createFakeView());
      await settle();
      controller.actions.send("вопрос");
      await settle();
      controller.actions.stop();
      await settle();

      // `chat.cancelled` ещё в пути, а отправка уже получила отказ: мод не
      // дождался дочитывания. Номер отменённого хода стирать нельзя, иначе
      // его событие пройдёт мимо и пометка «остановлено» не появится.
      fake.failNextSend(new ApiError({ code: "TURN_DRAINING", message: "дописывается" }));
      controller.actions.send("следующий");
      await settle();
      fake.emit("chat.cancelled", { turnId: "t-1" });

      expect(controller.getModel().messages[1]?.status).toBe(
        DEFAULT_CHAT_STRINGS.host.messageStatus.stopped,
      );
      expect(controller.getModel().error?.text).toBe(DEFAULT_CHAT_STRINGS.host.turnFailed);
    });

    it("события, обогнавшие ответ на отправку, не теряются", async () => {
      const fake = createFakeApi();
      const controller = create(fake, createFakeView());
      await settle();

      // На HTTP ответ на `chatSend` и поток событий идут разными
      // соединениями: первый кусок и конец хода приходят раньше номера.
      const release = fake.holdSend();
      controller.actions.send("вопрос");
      await settle();
      fake.emit("chat.text", { turnId: "t-1", text: "ранний ответ" });
      fake.emit("chat.done", { turnId: "t-1", model: "demo-echo", latencyMs: 12 });
      release();
      await settle();

      const model = controller.getModel();
      expect(model.messages[1]?.text).toBe("ранний ответ");
      expect(model.streaming).toBe(false);
      expect(model.sending).toBe(false);
    });

    it("раннее событие чужого хода в ленту не попадает", async () => {
      const fake = createFakeApi();
      const controller = create(fake, createFakeView());
      await settle();

      const release = fake.holdSend();
      controller.actions.send("вопрос");
      await settle();
      fake.emit("chat.text", { turnId: "t-99", text: "чужой кусок" });
      release();
      await settle();

      expect(controller.getModel().messages[1]?.text).toBe("");
      expect(controller.getModel().streaming).toBe(true);
    });
  });

  it("второй ход не отправляется, пока идёт первый", async () => {
    const fake = createFakeApi();
    const controller = create(fake, createFakeView());
    await settle();

    controller.actions.send("первый");
    await settle();
    controller.actions.send("второй");
    await settle();

    expect(fake.sent).toEqual(["первый"]);
  });

  it("ошибка хода приходит словами экрана и разрешает повтор", async () => {
    const fake = createFakeApi();
    const controller = create(fake, createFakeView());
    await settle();

    fake.failNextSend(new ApiError({ code: "SOURCE_UNAVAILABLE", message: "нет снимка" }));
    controller.actions.send("вопрос");
    await settle();

    expect(controller.getModel().error).toEqual({
      text: DEFAULT_CHAT_STRINGS.host.turnFailed,
      canRetry: true,
    });

    controller.actions.retry();
    await settle();
    expect(fake.sent).toEqual(["вопрос"]);
  });

  it("инертный мод и расхождение версии повтором не лечатся", async () => {
    const fake = createFakeApi();
    const controller = create(fake, createFakeView());
    await settle();

    fake.failNextSend(new ApiError({ code: "MOD_INERT", message: "мультиплеер" }));
    controller.actions.send("вопрос");
    await settle();

    expect(controller.getModel().error?.canRetry).toBe(false);
    expect(controller.getModel().error?.text).toContain("мультиплеер");
  });

  it("предел частоты занимает отдельное поле, а не только ошибку", async () => {
    const fake = createFakeApi();
    const controller = create(fake, createFakeView());
    await settle();

    fake.failNextSend(
      new ApiError({ code: "RATE_LIMITED", message: "слишком часто", details: { retryAfterSec: 4 } }),
    );
    controller.actions.send("вопрос");
    await settle();

    expect(controller.getModel().rateLimit).toContain("4");
  });

  it("разрыв связи посреди хода оставляет показанные сообщения", async () => {
    const fake = createFakeApi();
    const controller = create(fake, createFakeView());
    await settle();
    controller.actions.send("вопрос");
    await settle();
    fake.emit("chat.text", { turnId: "t-1", text: "начало ответа" });

    fake.emit("api.status", {
      sidecarConnected: false,
      source: "fixture",
      inert: false,
      apiVersionMismatch: "",
      reason: "сайдкар остановлен",
      assistantState: "unavailable",
    });

    const model = controller.getModel();
    expect(model.connected).toBe(false);
    expect(model.streaming).toBe(false);
    expect(model.messages[1]?.text).toBe("начало ответа");
    expect(model.error).toEqual({
      text: DEFAULT_CHAT_STRINGS.host.sidecarUnavailable,
      canRetry: false,
    });
  });

  it("без связи ход не уходит в сеть вовсе", async () => {
    const fake = createFakeApi({ sidecarConnected: false, assistantState: "unavailable" });
    const controller = create(fake, createFakeView());
    await settle();

    controller.actions.send("вопрос");
    await settle();

    expect(fake.sent).toEqual([]);
    expect(controller.getModel().error?.text).toBe(DEFAULT_CHAT_STRINGS.host.sidecarUnavailable);
  });

  it("отмена хода, которого у мода уже нет, не ломает экран", async () => {
    const fake = createFakeApi();
    const controller = create(fake, createFakeView());
    await settle();
    controller.actions.send("вопрос");
    await settle();

    const failing = { ...fake.api, chatCancel: async () => {
      throw new ApiError({ code: "NO_TURN", message: "хода нет" });
    } };
    const stale = createChatController({ api: failing as FicsitAIApi, view: createFakeView() });
    controllers.push(stale);
    await settle();
    stale.actions.send("вопрос");
    await settle();
    stale.actions.stop();
    await settle();

    expect(stale.getModel().streaming).toBe(false);
    expect(stale.getModel().error).toBeNull();
  });

  it("destroy снимает подписки и представление", async () => {
    const fake = createFakeApi();
    const view = createFakeView();
    const controller = create(fake, view);
    await settle();
    controller.actions.send("вопрос");
    await settle();

    controller.destroy();
    const before = view.models.length;
    fake.emit("chat.text", { turnId: "t-1", text: "после смерти" });

    expect(view.unmounted).toBe(true);
    expect(view.models.length).toBe(before);
  });

  it("черновик хранится, но перерисовку не вызывает", async () => {
    const fake = createFakeApi();
    const view = createFakeView();
    const controller = create(fake, view);
    await settle();

    const before = view.models.length;
    controller.actions.draft("наб");
    controller.actions.draft("набираю");
    expect(view.models.length).toBe(before);

    controller.actions.send("набираю");
    await settle();
    expect(controller.getModel().draft).toBe("");
  });
});
