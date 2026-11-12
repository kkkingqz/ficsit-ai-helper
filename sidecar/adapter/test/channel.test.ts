import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { ModChannel } from "../src/channel.js";
import { loadConfig } from "../src/config.js";
import { playthroughIdFor } from "../src/foreman.js";
import { createApp } from "../src/index.js";
import type { Logger } from "../src/log.js";

/**
 * Канал мод ↔ адаптер, протокол 1 (`docs/interfaces/mod-adapter-channel.md`).
 *
 * Проверки идут через настоящий слушатель адаптера и настоящий HTTP до
 * поддельного Foreman: предмет проверки — рукопожатие, номера, буфер и
 * потоковое поведение, а оно живёт в сокетах, а не в вызовах функций.
 */

const silent: Logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

// Только латиница: заголовок HTTP — ByteString, кириллица в него не пролезает.
const TOKEN = "adapter-token-for-tests-0123456789";
const MODEL = "gemini-3.5-flash-lite";
const SAVE_ID = "Сейв игрока 1";
const OTHER_SAVE = "Сейв игрока 2";

interface Seen {
  method: string;
  url: string;
  body: string;
  closedEarly: boolean;
}

interface Held {
  send: (event: string, data: unknown) => void;
  end: () => void;
}

interface Fake {
  port: number;
  seen: Seen[];
  held: () => Held | undefined;
  close: () => Promise<void>;
}

type Handler = (req: IncomingMessage, res: ServerResponse, hold: (held: Held) => void) => void;

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (closers.length > 0) await closers.pop()?.();
});

/** Поддельный Foreman: вход, playthrough и всё, что задаст тест. */
async function fakeForeman(handler: Handler): Promise<Fake> {
  const seen: Seen[] = [];
  let holding: Held | undefined;
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const record: Seen = {
        method: req.method ?? "",
        url: req.url ?? "",
        body: Buffer.concat(chunks).toString("utf8"),
        closedEarly: false,
      };
      seen.push(record);
      // Отмену на нашей стороне видно здесь: своей отмены у Foreman нет.
      res.on("close", () => {
        record.closedEarly = !res.writableEnded;
      });

      if (req.url === "/api/auth/sign-in/email") {
        res.writeHead(200, { "set-cookie": "better-auth.session_token=live; Path=/" });
        res.end("{}");
        return;
      }
      handler(req, res, (held) => {
        holding = held;
      });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as AddressInfo).port,
    seen,
    held: () => holding,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** Поток SSE, как его отдаёт маршрут чата Foreman. */
function sse(res: ServerResponse): Held {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  return {
    send: (event: string, data: unknown): void => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    end: (): void => {
      res.end();
    },
  };
}

const playthroughJson = (req: IncomingMessage, res: ServerResponse): boolean => {
  if (req.method === "GET" && !req.url?.endsWith("/messages")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "playthrough" }));
    return true;
  }
  return false;
};

/** Foreman, который отвечает одним ходом и ждёт, пока тест его отпустит. */
const holdingForeman = () =>
  fakeForeman((req, res, hold) => {
    if (playthroughJson(req, res)) return;
    const stream = sse(res);
    stream.send("text", { delta: "начал" });
    hold(stream);
  });

interface Adapter {
  base: string;
  channel: ModChannel;
}

async function adapterFor(fake: Fake): Promise<Adapter> {
  const accountPath = join(mkdtempSync(join(tmpdir(), "ficsitai-channel-")), "account.json");
  const config = loadConfig({
    ADAPTER_TOKEN: TOKEN,
    FOREMAN_BASE_URL: `http://127.0.0.1:${fake.port}`,
    FOREMAN_ACCOUNT_PATH: accountPath,
    LLM_MODEL: MODEL,
  } as NodeJS.ProcessEnv);
  const { app, channel } = await createApp(config, silent);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", () => resolve()));
  closers.push(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  closers.push(fake.close);
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, channel };
}

const auth = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };

interface Envelope {
  seq?: number;
  type: string;
  id?: string;
  re?: string;
  body?: Record<string, unknown>;
  error?: { code: string; message: string };
  reason?: string;
}

/** Поддельный мод: рукопожатие, чтение потока и отправка пачек. */
class ModClient {
  public session = "";
  public limits: Record<string, number> = {};
  public readonly lines: Envelope[] = [];
  private seq = 0;
  private reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

  public constructor(private readonly base: string) {}

  public async hello(overrides: Record<string, unknown> = {}): Promise<Response> {
    const response = await fetch(`${this.base}/mod/hello`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        protocol: 1,
        apiVersion: "0.4.0",
        modVersion: "0.1.0",
        saveId: SAVE_ID,
        inert: false,
        tools: [{ name: "query_metric", description: "метрика", inputSchema: { type: "object" } }],
        ...overrides,
      }),
    });
    if (response.ok) {
      const body = (await response.clone().json()) as {
        session: string;
        limits: Record<string, number>;
      };
      this.session = body.session;
      this.limits = body.limits;
    }
    return response;
  }

  public async openStream(ack = 0): Promise<Response> {
    const response = await fetch(`${this.base}/mod/stream?session=${this.session}&ack=${ack}`, {
      headers: { authorization: auth.authorization },
    });
    if (response.ok) {
      this.reader = (response.body as ReadableStream<Uint8Array>).getReader();
      void this.pump();
    }
    return response;
  }

  private async pump(): Promise<void> {
    const decoder = new TextDecoder();
    let buffer = "";
    const reader = this.reader;
    if (reader === undefined) return;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        let newline = buffer.indexOf("\n");
        while (newline >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf("\n");
          if (line.length > 0) this.lines.push(JSON.parse(line) as Envelope);
        }
      }
    } catch {
      // Поток закрыт — читать больше нечего.
    }
  }

  /** Ждёт сообщение нужного типа (и, если задан, с нужным `re`). */
  public async wait(type: string, re?: string, timeoutMs = 2000): Promise<Envelope> {
    const until = Date.now() + timeoutMs;
    for (;;) {
      const found = this.lines.find(
        (line) => line.type === type && (re === undefined || line.re === re),
      );
      if (found !== undefined) return found;
      if (Date.now() > until) {
        throw new Error(`не дождался «${type}»; пришло: ${this.lines.map((l) => l.type).join(",")}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  public get lastSeq(): number {
    return this.lines.filter((line) => line.seq !== undefined).at(-1)?.seq ?? 0;
  }

  public async send(messages: Envelope[], ack?: number): Promise<Response> {
    return await fetch(`${this.base}/mod/send`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        session: this.session,
        ...(ack === undefined ? {} : { ack }),
        messages,
      }),
    });
  }

  /** Сообщение со следующим номером и, если нужен ответ, с `id`. */
  public next(type: string, body: Record<string, unknown>, id?: string): Envelope {
    this.seq += 1;
    return { seq: this.seq, type, ...(id === undefined ? {} : { id }), body };
  }
}

describe("рукопожатие", () => {
  it("без токена не пускает", async () => {
    const { base } = await adapterFor(await fakeForeman((_req, res) => res.end("{}")));
    const response = await fetch(`${base}/mod/hello`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ protocol: 1, apiVersion: "0.4.0" }),
    });
    expect(response.status).toBe(401);
  });

  it("открывает сессию и объявляет пределы", async () => {
    const { base } = await adapterFor(await fakeForeman((_req, res) => res.end("{}")));
    const mod = new ModClient(base);
    const response = await mod.hello();
    expect(response.status).toBe(200);
    expect(mod.session).toMatch(/^s-/);
    expect(mod.limits).toMatchObject({ pingSec: 15, toolDeadlineSec: 10, maxBatchMessages: 64 });
  });

  it("чужая версия протокола — 409 PROTOCOL_MISMATCH", async () => {
    const { base } = await adapterFor(await fakeForeman((_req, res) => res.end("{}")));
    const response = await new ModClient(base).hello({ protocol: 2 });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "PROTOCOL_MISMATCH", protocol: 1 });
  });

  it("чужой мажор API — отказ, чужой минор — нет", async () => {
    const { base } = await adapterFor(await fakeForeman((_req, res) => res.end("{}")));
    const mismatch = await new ModClient(base).hello({ apiVersion: "1.0.0" });
    expect(mismatch.status).toBe(409);
    expect(await mismatch.json()).toMatchObject({ code: "API_VERSION_MISMATCH" });

    // Минорная версия добавляет поля и запросы — отключать функции незачем.
    const minor = await new ModClient(base).hello({ apiVersion: "0.3.0" });
    expect(minor.status).toBe(200);
  });

  it("первым сообщением сессии идёт состояние адаптера", async () => {
    const { base } = await adapterFor(await fakeForeman((_req, res) => res.end("{}")));
    const mod = new ModClient(base);
    await mod.hello();
    await mod.openStream();
    const status = await mod.wait("adapter.status");
    expect(status.seq).toBe(1);
    expect(status.body).toMatchObject({ model: MODEL });
  });

  it("новое рукопожатие закрывает прежнюю сессию строкой bye", async () => {
    const { base } = await adapterFor(await fakeForeman((_req, res) => res.end("{}")));
    const first = new ModClient(base);
    await first.hello();
    await first.openStream();
    await first.wait("adapter.status");

    const second = new ModClient(base);
    await second.hello();

    const bye = await first.wait("bye");
    expect(bye.reason).toBe("superseded");
    expect(second.session).not.toBe(first.session);

    // Прежняя сессия больше не существует.
    const stale = await first.send([first.next("mod.status", { inert: true })]);
    expect(stale.status).toBe(410);
    expect(await stale.json()).toMatchObject({ code: "SESSION_UNKNOWN" });
  });
});

describe("поток и номера", () => {
  it("незнакомая сессия — 410", async () => {
    const { base } = await adapterFor(await fakeForeman((_req, res) => res.end("{}")));
    const response = await fetch(`${base}/mod/stream?session=s-нет&ack=0`, {
      headers: { authorization: auth.authorization },
    });
    expect(response.status).toBe(410);
  });

  it("переоткрытый поток доносит непринятое, а прежний получает bye", async () => {
    const { base } = await adapterFor(await fakeForeman((_req, res) => res.end("{}")));
    const mod = new ModClient(base);
    await mod.hello();
    await mod.openStream();
    await mod.wait("adapter.status");

    const again = new ModClient(base);
    again.session = mod.session;
    await again.openStream(0);

    expect((await mod.wait("bye")).reason).toBe("replaced");
    // Буфер не освобождён (ack = 0), поэтому состояние пришло заново.
    const status = await again.wait("adapter.status");
    expect(status.seq).toBe(1);
  });

  it("подтверждённое из буфера уходит, и повторно его не отдают", async () => {
    const { base } = await adapterFor(await fakeForeman((_req, res) => res.end("{}")));
    const mod = new ModClient(base);
    await mod.hello();
    await mod.openStream();
    await mod.wait("adapter.status");

    const again = new ModClient(base);
    again.session = mod.session;
    const response = await again.openStream(1);
    expect(response.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(again.lines.filter((line) => line.type === "adapter.status")).toHaveLength(0);
  });

  it("вытесненный номер — 409 STREAM_LOST", async () => {
    const { base } = await adapterFor(await fakeForeman((_req, res) => res.end("{}")));
    const mod = new ModClient(base);
    await mod.hello();
    await mod.openStream();
    await mod.wait("adapter.status");

    // Подтвердили первое сообщение — из буфера оно ушло.
    await mod.send([], 1);

    const again = new ModClient(base);
    again.session = mod.session;
    const response = await again.openStream(0);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "STREAM_LOST", oldest: 2 });
  });
});

describe("приём сообщений", () => {
  const quiet = () => fakeForeman((_req, res) => res.end("{}"));

  it("пропуск в начале пачки — 409 SEQ_GAP", async () => {
    const { base } = await adapterFor(await quiet());
    const mod = new ModClient(base);
    await mod.hello();
    const response = await mod.send([{ seq: 3, type: "mod.status", body: { inert: true } }]);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "SEQ_GAP", ack: 0 });
  });

  it("пропуск в середине: берётся непрерывное начало", async () => {
    const { base } = await adapterFor(await quiet());
    const mod = new ModClient(base);
    await mod.hello();
    const response = await mod.send([
      { seq: 1, type: "mod.status", body: { inert: false } },
      { seq: 2, type: "mod.status", body: { inert: true } },
      { seq: 4, type: "mod.status", body: { inert: false } },
    ]);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ack: 2 });
  });

  it("повтор подтверждённого не обрабатывается заново", async () => {
    const { base } = await adapterFor(await quiet());
    const mod = new ModClient(base);
    await mod.hello();
    await mod.openStream();
    const first = await mod.send([{ seq: 1, type: "что-то.своё", id: "m-1", body: {} }]);
    expect(await first.json()).toMatchObject({ ack: 1 });
    await mod.wait("reply", "m-1");

    const repeat = await mod.send([{ seq: 1, type: "что-то.своё", id: "m-1", body: {} }]);
    expect(await repeat.json()).toMatchObject({ ack: 1 });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(mod.lines.filter((line) => line.re === "m-1")).toHaveLength(1);
  });

  it("пачка больше предела — 413", async () => {
    const { base } = await adapterFor(await quiet());
    const mod = new ModClient(base);
    await mod.hello();
    const many = Array.from({ length: 65 }, (_unused, index) => ({
      seq: index + 1,
      type: "mod.status",
      body: {},
    }));
    const response = await mod.send(many);
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ code: "TOO_LARGE" });
  });

  it("незнакомый тип: с id — ошибка в ответ, без id — тишина", async () => {
    const { base } = await adapterFor(await quiet());
    const mod = new ModClient(base);
    await mod.hello();
    await mod.openStream();
    await mod.send([
      { seq: 1, type: "будущее.сообщение", id: "m-1", body: {} },
      { seq: 2, type: "будущее.событие", body: {} },
    ]);
    const reply = await mod.wait("reply", "m-1");
    expect(reply.error?.code).toBe("UNKNOWN_TYPE");
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(mod.lines.filter((line) => line.type === "reply")).toHaveLength(1);
  });
});

describe("чат по каналу", () => {
  const answering = () =>
    fakeForeman((req, res) => {
      if (playthroughJson(req, res)) return;
      const stream = sse(res);
      stream.send("text", { delta: "Сначала " });
      stream.send("tool_use", { name: "get_recipe" });
      stream.send("work_order", { id: "wo-1" });
      stream.send("text", { delta: "потом." });
      stream.send("done", { ok: true });
      stream.end();
    });

  it("ход доходит до Foreman и возвращается сообщениями канала", async () => {
    const fake = await answering();
    const { base } = await adapterFor(fake);
    const mod = new ModClient(base);
    await mod.hello();
    await mod.openStream();

    await mod.send([mod.next("chat.send", { saveId: SAVE_ID, text: "что строить?" }, "m-1")]);
    const reply = await mod.wait("reply", "m-1");
    const turnId = (reply.body as { turnId: string }).turnId;
    expect(turnId).toMatch(/^t-/);

    const done = await mod.wait("chat.done");
    const text = mod.lines
      .filter((line) => line.type === "chat.text")
      .map((line) => (line.body as { text: string }).text)
      .join("");
    expect(text).toBe("Сначала потом.");
    expect(mod.lines.find((line) => line.type === "chat.tool")?.body).toMatchObject({
      name: "get_recipe",
    });
    expect(done.body).toMatchObject({ turnId, model: MODEL });
    expect((done.body as { latencyMs: number }).latencyMs).toBeGreaterThanOrEqual(0);

    // Имена событий Foreman наружу не выходят, work order в v0.1 не передаётся.
    expect(mod.lines.some((line) => ["text", "tool_use", "work_order"].includes(line.type))).toBe(
      false,
    );

    const chat = fake.seen.find((entry) => entry.url.endsWith("/chat"));
    expect(JSON.parse(chat?.body ?? "{}")).toEqual({ message: "что строить?" });
  });

  it("второй ход на то же сохранение — TURN_IN_PROGRESS", async () => {
    const { base } = await adapterFor(await holdingForeman());
    const mod = new ModClient(base);
    await mod.hello();
    await mod.openStream();

    await mod.send([mod.next("chat.send", { saveId: SAVE_ID, text: "первый" }, "m-1")]);
    await mod.wait("reply", "m-1");
    await mod.send([mod.next("chat.send", { saveId: SAVE_ID, text: "второй" }, "m-2")]);
    const reply = await mod.wait("reply", "m-2");
    expect(reply.error?.code).toBe("TURN_IN_PROGRESS");
  });

  it("отмена закрывает вещание, Foreman дочитывается", async () => {
    const fake = await holdingForeman();
    const { base } = await adapterFor(fake);
    const mod = new ModClient(base);
    await mod.hello();
    await mod.openStream();

    await mod.send([mod.next("chat.send", { saveId: SAVE_ID, text: "долгий" }, "m-1")]);
    const turnId = ((await mod.wait("reply", "m-1")).body as { turnId: string }).turnId;
    await mod.wait("chat.text");

    await mod.send([mod.next("chat.cancel", { saveId: SAVE_ID, turnId }, "m-2")]);
    expect((await mod.wait("reply", "m-2")).body).toMatchObject({ state: "cancelled" });
    expect((await mod.wait("chat.cancelled")).body).toMatchObject({ turnId });

    // Связь с Foreman жива: ход дописывает ответ, и в историю он ляжет раньше
    // следующего вопроса (живая проверка 12.11.2026).
    const chat = fake.seen.find((entry) => entry.url.endsWith("/chat"));
    expect(chat?.closedEarly).toBe(false);

    // После отмены сообщений с этим ходом больше нет.
    const after = mod.lines.length;
    fake.held()?.send("text", { delta: "хвост после отмены" });
    fake.held()?.send("done", { ok: true });
    fake.held()?.end();
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(mod.lines.length).toBe(after);
  });

  it("отмена чужого хода — TURN_MISMATCH, без хода — NO_TURN", async () => {
    const { base } = await adapterFor(await holdingForeman());
    const mod = new ModClient(base);
    await mod.hello();
    await mod.openStream();

    await mod.send([mod.next("chat.cancel", { saveId: SAVE_ID, turnId: "t-нет" }, "m-1")]);
    expect((await mod.wait("reply", "m-1")).error?.code).toBe("NO_TURN");

    await mod.send([mod.next("chat.send", { saveId: SAVE_ID, text: "долгий" }, "m-2")]);
    await mod.wait("reply", "m-2");
    await mod.send([mod.next("chat.cancel", { saveId: SAVE_ID, turnId: "t-чужой" }, "m-3")]);
    expect((await mod.wait("reply", "m-3")).error?.code).toBe("TURN_MISMATCH");
  });

  it("история отдаётся хвостом, от старых к новым", async () => {
    const messages = Array.from({ length: 80 }, (_unused, index) => ({
      id: `m${index}`,
      role: index % 2 === 0 ? "user" : "assistant",
      content: `сообщение ${index}`,
      createdAt: new Date(index).toISOString(),
    }));
    const fake = await fakeForeman((req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(req.url?.endsWith("/messages") ? messages : { id: "p" }));
    });
    const { base } = await adapterFor(fake);
    const mod = new ModClient(base);
    await mod.hello();
    await mod.openStream();

    await mod.send([mod.next("chat.history", { saveId: SAVE_ID, limit: 10 }, "m-1")]);
    const reply = await mod.wait("reply", "m-1");
    const history = (reply.body as { messages: { text: string; role: string }[] }).messages;
    expect(history).toHaveLength(10);
    expect(history[0]?.text).toBe("сообщение 70");
    expect(history[9]?.text).toBe("сообщение 79");
  });

  it("пустой текст хода — INVALID_ARGUMENT, до Foreman не идёт", async () => {
    const fake = await holdingForeman();
    const { base } = await adapterFor(fake);
    const mod = new ModClient(base);
    await mod.hello();
    await mod.openStream();

    await mod.send([mod.next("chat.send", { saveId: SAVE_ID, text: "" }, "m-1")]);
    expect((await mod.wait("reply", "m-1")).error?.code).toBe("INVALID_ARGUMENT");
    expect(fake.seen.some((entry) => entry.url.endsWith("/chat"))).toBe(false);
  });
});

describe("вызов инструмента мода", () => {
  it("уходит моду и возвращается результатом", async () => {
    const { base, channel } = await adapterFor(await holdingForeman());
    const mod = new ModClient(base);
    await mod.hello();
    await mod.openStream();

    const call = channel.callTool("query_metric", { metricId: "power.consumption" });
    const sent = await mod.wait("tool.call");
    expect(sent.body).toMatchObject({
      name: "query_metric",
      args: { metricId: "power.consumption" },
      deadlineSec: 10,
    });
    // Идущих ходов нет — сохранение не навязываем, мод ответит по текущему.
    expect(sent.body).not.toHaveProperty("saveId");

    await mod.send([
      { seq: 1, type: "tool.result", re: sent.id as string, body: { kind: "value", value: 412.5 } },
    ]);
    const outcome = await call;
    expect(outcome).toMatchObject({ ok: true });
    expect(JSON.parse((outcome as { text: string }).text)).toMatchObject({ value: 412.5 });
  });

  it("несёт сохранение единственного идущего хода", async () => {
    const { base, channel } = await adapterFor(await holdingForeman());
    const mod = new ModClient(base);
    await mod.hello();
    await mod.openStream();

    await mod.send([mod.next("chat.send", { saveId: SAVE_ID, text: "вопрос" }, "m-1")]);
    await mod.wait("reply", "m-1");

    void channel.callTool("query_metric", {});
    expect((await mod.wait("tool.call")).body).toMatchObject({ saveId: SAVE_ID });
  });

  it("два идущих хода — AMBIGUOUS_TURN, мод не спрашивается", async () => {
    const { base, channel } = await adapterFor(await holdingForeman());
    const mod = new ModClient(base);
    await mod.hello();
    await mod.openStream();

    await mod.send([mod.next("chat.send", { saveId: SAVE_ID, text: "первый" }, "m-1")]);
    await mod.wait("reply", "m-1");
    await mod.send([mod.next("chat.send", { saveId: OTHER_SAVE, text: "второй" }, "m-2")]);
    await mod.wait("reply", "m-2");

    const outcome = await channel.callTool("query_metric", {});
    expect(outcome).toMatchObject({ ok: false, code: "AMBIGUOUS_TURN" });
    expect(mod.lines.some((line) => line.type === "tool.call")).toBe(false);
  });

  it("без подключённого мода — MOD_DISCONNECTED сразу", async () => {
    const { base, channel } = await adapterFor(await holdingForeman());
    const mod = new ModClient(base);
    await mod.hello(); // рукопожатие есть, потока нет

    const outcome = await channel.callTool("query_metric", {});
    expect(outcome).toMatchObject({ ok: false, code: "MOD_DISCONNECTED" });
    expect(base).toContain("127.0.0.1");
  });

  it("ошибка мода доходит кодом, а не обрывом", async () => {
    const { base, channel } = await adapterFor(await holdingForeman());
    const mod = new ModClient(base);
    await mod.hello();
    await mod.openStream();

    const call = channel.callTool("query_metric", {});
    const sent = await mod.wait("tool.call");
    await mod.send([
      {
        seq: 1,
        type: "tool.result",
        re: sent.id as string,
        error: { code: "MOD_INERT", message: "мультиплеер" },
      },
    ]);
    expect(await call).toMatchObject({ ok: false, code: "MOD_INERT" });
  });

  it("смена сессии завершает ожидающий вызов CHANNEL_RESET", async () => {
    const { base, channel } = await adapterFor(await holdingForeman());
    const mod = new ModClient(base);
    await mod.hello();
    await mod.openStream();

    const call = channel.callTool("query_metric", {});
    await mod.wait("tool.call");

    await new ModClient(base).hello();
    expect(await call).toMatchObject({ ok: false, code: "CHANNEL_RESET" });
  });

  it("инструменты мода живут ровно столько, сколько сессия", async () => {
    const { base, channel } = await adapterFor(await holdingForeman());
    expect(channel.modTools()).toHaveLength(0);

    const mod = new ModClient(base);
    await mod.hello();
    expect(channel.modTools().map((tool) => tool.name)).toEqual(["query_metric"]);

    channel.closeSession("shutdown");
    expect(channel.modTools()).toHaveLength(0);
  });
});
