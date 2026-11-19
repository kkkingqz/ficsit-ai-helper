import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDemoSource } from "../src/dev/demo-source.js";
import { startDevServer, type DevServer } from "../src/dev/server.js";
import type { DevSource } from "../src/dev/source.js";
import { createApi, type FicsitAIApi } from "../src/facade.js";
import { createHttpTransport, type EventSourceLike } from "../src/http.js";
import { API_EVENT_NAMES, ApiError, type ApiEventName } from "../src/types.js";

/**
 * Чат в фасаде (0.5.0): три запроса и пять событий.
 *
 * Проверки идут через настоящий dev-сервер и настоящий поток событий, потому
 * что предмет здесь — не вызовы функций, а поведение хода: один ход за раз,
 * отмена останавливает показ, но ответ всё равно ложится в историю.
 */

const servers: DevServer[] = [];
const apis: FicsitAIApi[] = [];

afterEach(async () => {
  while (apis.length > 0) apis.pop()?.close();
  while (servers.length > 0) await servers.pop()?.close();
});

/** Куски ответа в проверках идут без пауз: предмет — поведение, не скорость. */
const fastDemo = (): DevSource => createDemoSource({ chatChunkMs: 2 });

async function serve(source: DevSource = fastDemo()): Promise<DevServer> {
  const server = await startDevServer({
    root: mkdtempSync(join(tmpdir(), "ficsitai-chat-")),
    source,
    port: 0,
    watch: false,
    log: () => {},
  });
  servers.push(server);
  return server;
}

/** Поток событий dev-сервера поверх `fetch`: `EventSource` в Node нет. */
function createNodeEventSource(url: string): EventSourceLike {
  const handlers = new Map<string, ((event: { data?: string }) => void)[]>();
  const controller = new AbortController();

  void (async () => {
    try {
      const res = await fetch(url, { signal: controller.signal });
      const body = res.body;
      if (body === null) return;
      let buffer = "";
      for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
        buffer += Buffer.from(chunk).toString("utf8");
        let split = buffer.indexOf("\n\n");
        while (split !== -1) {
          const frame = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          const event = /^event: (.+)$/m.exec(frame)?.[1];
          const data = /^data: (.*)$/m.exec(frame)?.[1];
          if (event !== undefined) {
            const payload = data === undefined ? {} : { data };
            for (const handler of handlers.get(event) ?? []) handler(payload);
          }
          split = buffer.indexOf("\n\n");
        }
      }
    } catch {
      // Поток закрыт вместе с сервером — это конец проверки, а не ошибка.
    }
  })();

  return {
    addEventListener(type, handler) {
      handlers.set(type, [...(handlers.get(type) ?? []), handler]);
    },
    close() {
      controller.abort();
    },
  };
}

class NodeEventSource implements EventSourceLike {
  private readonly inner: EventSourceLike;

  public constructor(url: string) {
    this.inner = createNodeEventSource(url);
  }

  public addEventListener(type: string, handler: (event: { data?: string }) => void): void {
    this.inner.addEventListener(type, handler);
  }

  public close(): void {
    this.inner.close();
  }
}

function apiFor(server: DevServer, events = false): FicsitAIApi {
  const api = createApi({
    transport: createHttpTransport(
      events
        ? { baseUrl: server.url, eventSourceImpl: NodeEventSource }
        : { baseUrl: server.url, events: false },
    ),
  });
  apis.push(api);
  return api;
}

/** Ждёт событие с нужным именем или сдаётся по сроку. */
function waitFor<K extends ApiEventName>(
  api: FicsitAIApi,
  event: K,
  timeoutMs = 4000,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error(`событие «${event}» не пришло за ${timeoutMs} мс`));
    }, timeoutMs);
    const off = api.on(event, (data) => {
      clearTimeout(timer);
      off();
      resolve(data);
    });
  });
}

describe("запросы чата в фасаде", () => {
  it("ход отвечает turnId, а ответ приходит событиями и ложится в историю", async () => {
    const api = apiFor(await serve(), true);

    const text = waitFor(api, "chat.text");
    const done = waitFor(api, "chat.done");
    const sent = await api.chatSend({ text: "сколько у нас запаса по питанию?" });
    expect(sent.turnId).toMatch(/^t-\d+$/);

    expect(await text).toMatchObject({ turnId: sent.turnId });
    expect(await done).toMatchObject({ turnId: sent.turnId, model: "demo-echo" });

    const history = await api.chatHistory();
    expect(history.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(history.messages[0]?.text).toContain("запаса по питанию");
    // От старых к новым, как в контракте.
    const [first, second] = history.messages;
    expect((first?.createdAt ?? "") <= (second?.createdAt ?? "")).toBe(true);
  });

  it("отмена останавливает показ, но ответ всё равно оказывается в истории", async () => {
    const api = apiFor(await serve(), true);

    const cancelled = waitFor(api, "chat.cancelled");
    const sent = await api.chatSend({ text: "длинный вопрос про фабрику" });
    const result = await api.chatCancel({ turnId: sent.turnId });
    expect(result.state).toBe("cancelled");
    expect(await cancelled).toMatchObject({ turnId: sent.turnId });

    // Второй вызов отмены — не ошибка: ход тот же, состояние другое.
    expect((await api.chatCancel({ turnId: sent.turnId })).state).toBe("alreadyCancelled");

    await new Promise((done) => setTimeout(done, 300));
    const history = await api.chatHistory();
    expect(history.messages.at(-1)?.role).toBe("assistant");
  });

  it("второй ход отклоняется кодом хода, а не общей ошибкой", async () => {
    const api = apiFor(await serve());
    const sent = await api.chatSend({ text: "первый" });

    await expect(api.chatSend({ text: "второй" })).rejects.toMatchObject({
      code: "TURN_IN_PROGRESS",
    });

    await api.chatCancel({ turnId: sent.turnId });
    await expect(api.chatSend({ text: "третий" })).rejects.toMatchObject({
      code: "TURN_DRAINING",
    });
  });

  it("отмена чужого и несуществующего хода различается кодом", async () => {
    const api = apiFor(await serve());

    await expect(api.chatCancel({ turnId: "t-404" })).rejects.toMatchObject({ code: "NO_TURN" });

    const sent = await api.chatSend({ text: "вопрос" });
    await expect(api.chatCancel({ turnId: `${sent.turnId}-чужой` })).rejects.toMatchObject({
      code: "TURN_MISMATCH",
    });
  });

  it("пустой ход и limit вне диапазона отклоняются до источника данных", async () => {
    const api = apiFor(await serve());

    await expect(api.chatSend({ text: "   " })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(api.chatHistory({ limit: 0 })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(api.chatHistory({ limit: 101 })).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
    });
    await expect(api.chatHistory({ limit: 1.5 })).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
    });
  });

  it("limit отдаёт последние сообщения, а не первые", async () => {
    const api = apiFor(await serve());

    for (const text of ["первый", "второй"]) {
      const sent = await api.chatSend({ text });
      await api.chatCancel({ turnId: sent.turnId });
      await new Promise((done) => setTimeout(done, 300));
    }

    const all = await api.chatHistory();
    expect(all.messages.length).toBe(4);
    const tail = await api.chatHistory({ limit: 1 });
    expect(tail.messages).toEqual([all.messages.at(-1)]);
  });

  it("источник без ассистента отвечает SIDECAR_UNAVAILABLE, а не падением", async () => {
    const demo = fastDemo();
    const bare: DevSource = {
      name: "без чата",
      getStatus: () => demo.getStatus(),
      listMetrics: (args) => demo.listMetrics(args),
      listScopes: (args) => demo.listScopes(args),
      queryMetric: (args) => demo.queryMetric(args),
      querySeries: (args) => demo.querySeries(args),
    };
    const api = apiFor(await serve(bare));

    const failure = await api.chatSend({ text: "вопрос" }).catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ code: "SIDECAR_UNAVAILABLE" });

    // Остальная часть API того же источника продолжает работать: отсутствие
    // ассистента — не отказ источника.
    expect((await api.getStatus()).saveId).toBe("demo-save");
  });

  it("все события контракта подписаны в потоке, включая chat.*", () => {
    expect([...API_EVENT_NAMES]).toEqual([
      "metrics.snapshot",
      "mod.inert",
      "api.status",
      "chat.text",
      "chat.tool",
      "chat.done",
      "chat.failed",
      "chat.cancelled",
    ]);
  });
});
