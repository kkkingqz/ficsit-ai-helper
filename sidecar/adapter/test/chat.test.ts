import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { playthroughIdFor } from "../src/foreman.js";
import { createApp } from "../src/index.js";
import type { Logger } from "../src/log.js";

/**
 * S2: API чата для мода — поток, отмена, история.
 *
 * Проверки идут через настоящий слушатель адаптера и настоящий HTTP до
 * поддельного Foreman: предмет проверки — потоковое поведение (кадры по мере
 * прихода, обрыв, одновременные ходы), а оно живёт в сокетах, а не в вызовах
 * функций.
 */

const silent: Logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

// Только латиница: заголовок HTTP — ByteString, кириллица в него не пролезает.
const TOKEN = "adapter-token-for-tests-0123456789";
const SAVE_ID = "Сейв игрока 1";

interface Seen {
  method: string;
  url: string;
  body: string;
  closedEarly: boolean;
}

interface Fake {
  port: number;
  seen: Seen[];
  close: () => Promise<void>;
}

type Handler = (req: IncomingMessage, res: ServerResponse, seen: Seen) => void;

/** Поддельный Foreman: вход, playthrough и всё, что задаст тест. */
async function fakeForeman(handler: Handler): Promise<Fake> {
  const seen: Seen[] = [];
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
      // Отмену на нашей стороне видно здесь: Foreman узнаёт о ней только
      // закрытием соединения, своей отмены у него нет.
      res.on("close", () => {
        record.closedEarly = !res.writableEnded;
      });

      if (req.url === "/api/auth/sign-in/email") {
        res.writeHead(200, { "set-cookie": "better-auth.session_token=live; Path=/" });
        res.end("{}");
        return;
      }
      handler(req, res, record);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as AddressInfo).port,
    seen,
    close: () =>
      new Promise<void>((resolve) => {
        // Незавершённые потоки (отменённые ходы) держат сокеты открытыми, и
        // close() ждал бы их до таймаута.
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** Поток SSE, как его отдаёт маршрут чата Foreman. */
function sse(res: ServerResponse) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  return {
    send: (event: string, data: unknown): void => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    raw: (text: string | Buffer): void => {
      res.write(text);
    },
    end: (): void => {
      res.end();
    },
  };
}

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (closers.length > 0) await closers.pop()?.();
});

/** Поднимает адаптер против поддельного Foreman и возвращает его адрес. */
async function adapterFor(fake: Fake): Promise<string> {
  const accountPath = join(mkdtempSync(join(tmpdir(), "ficsitai-chat-")), "account.json");
  const config = loadConfig({
    ADAPTER_TOKEN: TOKEN,
    FOREMAN_BASE_URL: `http://127.0.0.1:${fake.port}`,
    FOREMAN_ACCOUNT_PATH: accountPath,
  } as NodeJS.ProcessEnv);
  const { app } = await createApp(config, silent);
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
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const auth = { authorization: `Bearer ${TOKEN}` };

const postChat = (base: string, body: unknown, headers: Record<string, string> = auth) =>
  fetch(`${base}/mod/saves/${encodeURIComponent(SAVE_ID)}/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

interface Frame {
  event: string;
  data: unknown;
}

interface FrameStream {
  frames: Frame[];
  /** Дочитывает поток до условия, НЕ закрывая соединение. */
  until: (pred: (frames: Frame[]) => boolean) => Promise<Frame[]>;
}

/**
 * Читатель кадров NDJSON. Соединение не закрывает: закрытие на стороне мода —
 * это отмена хода, и читатель, отменяющий поток ради выхода из цикла, отменял
 * бы заодно и сам ход.
 */
function frameStream(response: Response): FrameStream {
  const frames: Frame[] = [];
  const decoder = new TextDecoder();
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  let buffer = "";

  const until = async (pred: (frames: Frame[]) => boolean): Promise<Frame[]> => {
    while (!pred(frames)) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        if (line.length > 0) frames.push(JSON.parse(line) as Frame);
      }
    }
    return frames;
  };

  return { frames, until };
}

const textOf = (frames: Frame[]): string =>
  frames
    .filter((frame) => frame.event === "text")
    .map((frame) => (frame.data as { delta: string }).delta)
    .join("");

describe("API чата: поток", () => {
  it("без токена не пускает", async () => {
    const base = await adapterFor(
      await fakeForeman((_req, res) => {
        res.end("{}");
      }),
    );
    const response = await postChat(base, { message: "привет" }, {});
    expect(response.status).toBe(401);
  });

  it("ход доходит до Foreman и возвращается кадрами", async () => {
    const fake = await fakeForeman((req, res) => {
      if (req.method === "GET") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: playthroughIdFor(SAVE_ID) }));
        return;
      }
      const stream = sse(res);
      stream.send("text", { delta: "Сначала " });
      stream.send("tool_use", { name: "get_recipe" });
      stream.send("text", { delta: "потом." });
      stream.send("done", { ok: true });
      stream.end();
    });
    const base = await adapterFor(fake);

    const response = await postChat(base, { message: "что строить?" });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/x-ndjson");

    const frames = await frameStream(response).until((f) =>
      f.some((frame) => frame.event === "done"),
    );
    expect(frames[0]?.event).toBe("accepted");
    expect((frames[0]?.data as { playthroughId: string }).playthroughId).toBe(
      playthroughIdFor(SAVE_ID),
    );
    expect(frames.map((frame) => frame.event)).toContain("tool_use");
    expect(textOf(frames)).toBe("Сначала потом.");

    const chat = fake.seen.find((entry) => entry.url.endsWith("/chat"));
    expect(chat?.url).toBe(`/api/playthroughs/${playthroughIdFor(SAVE_ID)}/chat`);
    // Ключ провайдера адаптер не передаёт: ключ у Foreman свой, от лаунчера.
    expect(JSON.parse(chat?.body ?? "{}")).toEqual({ message: "что строить?" });
  });

  it("многобайтный символ, разорванный между пакетами, доходит целым", async () => {
    const fake = await fakeForeman((req, res) => {
      if (req.method === "GET") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: playthroughIdFor(SAVE_ID) }));
        return;
      }
      const stream = sse(res);
      const whole = Buffer.from(`event: text\ndata: {"delta":"Железо"}\n\n`, "utf8");
      // Рвём ровно посередине буквы «ж»: UTF-8 отдаёт её двумя байтами.
      const cut = whole.indexOf(Buffer.from("Железо", "utf8")) + 1;
      stream.raw(whole.subarray(0, cut));
      setTimeout(() => {
        stream.raw(whole.subarray(cut));
        stream.send("done", { ok: true });
        stream.end();
      }, 10);
    });
    const base = await adapterFor(fake);

    const response = await postChat(base, { message: "?" });
    const frames = await frameStream(response).until((f) =>
      f.some((frame) => frame.event === "done"),
    );
    expect(textOf(frames)).toBe("Железо");
  });

  it("ошибка Foreman приходит кадром error, а не обрывом", async () => {
    const fake = await fakeForeman((req, res) => {
      if (req.method === "GET") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: playthroughIdFor(SAVE_ID) }));
        return;
      }
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "нет ключа провайдера" }));
    });
    const base = await adapterFor(fake);

    const response = await postChat(base, { message: "?" });
    const frames = await frameStream(response).until((f) =>
      f.some((frame) => frame.event === "error"),
    );
    const error = frames.find((frame) => frame.event === "error");
    expect((error?.data as { message: string }).message).toContain("500");
  });

  it("пустое сообщение — 400, до Foreman не идёт", async () => {
    const fake = await fakeForeman((_req, res) => {
      res.end("{}");
    });
    const base = await adapterFor(fake);
    const response = await postChat(base, { message: "" });
    expect(response.status).toBe(400);
    expect(fake.seen.some((entry) => entry.url.endsWith("/chat"))).toBe(false);
  });
});

describe("API чата: один ход на сохранение", () => {
  it("второй ход получает 409, пока идёт первый", async () => {
    let open: { send: (event: string, data: unknown) => void; end: () => void } | undefined;
    const fake = await fakeForeman((req, res) => {
      if (req.method === "GET") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: playthroughIdFor(SAVE_ID) }));
        return;
      }
      const stream = sse(res);
      stream.send("text", { delta: "думаю" });
      open = stream;
    });
    const base = await adapterFor(fake);

    const first = await postChat(base, { message: "первый" });
    const started = await frameStream(first).until((f) =>
      f.some((frame) => frame.event === "text"),
    );
    const turnId = (started[0]?.data as { turnId: string }).turnId;

    const second = await postChat(base, { message: "второй" });
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ error: "turn_in_progress", turnId });

    open?.send("done", { ok: true });
    open?.end();
  });
});

describe("API чата: отмена", () => {
  const cancel = (base: string, body: unknown) =>
    fetch(`${base}/mod/saves/${encodeURIComponent(SAVE_ID)}/chat/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify(body),
    });

  interface Held {
    send: (event: string, data: unknown) => void;
    end: () => void;
  }

  /** Foreman, который начал отвечать и ждёт, пока тест его отпустит. */
  async function heldTurn(): Promise<{ fake: Fake; open: () => Held | undefined }> {
    let held: Held | undefined;
    const fake = await fakeForeman((req, res) => {
      if (req.method === "GET") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: playthroughIdFor(SAVE_ID) }));
        return;
      }
      const stream = sse(res);
      stream.send("text", { delta: "начал" });
      held = stream;
    });
    return { fake, open: () => held };
  }

  it("отмена закрывает поток моду, но Foreman дочитывается до конца", async () => {
    const { fake, open } = await heldTurn();
    const base = await adapterFor(fake);

    const response = await postChat(base, { message: "долгий" });
    const stream = frameStream(response);
    const started = await stream.until((f) => f.some((frame) => frame.event === "text"));
    const turnId = (started[0]?.data as { turnId: string }).turnId;

    expect((await cancel(base, { turnId })).status).toBe(202);

    const rest = await stream.until((f) => f.some((frame) => frame.event === "cancelled"));
    const cancelled = rest.find((frame) => frame.event === "cancelled");
    expect((cancelled?.data as { turnId: string }).turnId).toBe(turnId);
    expect((cancelled?.data as { message: string }).message).toContain("истории");

    // Соединение к Foreman живо: ход дописывает ответ, и в историю он ляжет
    // раньше следующего вопроса. Живая проверка 12.11.2026 показала, что без
    // этого история складывается «вопрос — вопрос — ответ — ответ».
    const chat = fake.seen.find((entry) => entry.url.endsWith("/chat"));
    expect(chat?.closedEarly).toBe(false);

    // Остаток ответа моду уже не адресован.
    open()?.send("text", { delta: "хвост после отмены" });
    open()?.send("done", { ok: true });
    open()?.end();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(textOf(stream.frames)).toBe("начал");
  });

  it("следующий ход дожидается, пока отменённый допишется", async () => {
    const { fake, open } = await heldTurn();
    const base = await adapterFor(fake);

    const first = await postChat(base, { message: "долгий" });
    const stream = frameStream(first);
    const started = await stream.until((f) => f.some((frame) => frame.event === "text"));
    await cancel(base, { turnId: (started[0]?.data as { turnId: string }).turnId });
    await stream.until((f) => f.some((frame) => frame.event === "cancelled"));

    let answered = false;
    const second = postChat(base, { message: "следующий" }).then((response) => {
      answered = true;
      return response;
    });

    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(answered).toBe(false);

    // Foreman дописал брошенный ход — слот освободился.
    open()?.send("done", { ok: true });
    open()?.end();
    expect((await second).status).toBe(200);
    // Заголовки мод получает раньше, чем адаптер обратится к Foreman: ждём сам
    // запрос, а не ответ на него.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fake.seen.filter((entry) => entry.url.endsWith("/chat"))).toHaveLength(2);
  });

  it("чужой turnId чужой ход не трогает", async () => {
    const { fake } = await heldTurn();
    const base = await adapterFor(fake);

    const response = await postChat(base, { message: "долгий" });
    const stream = frameStream(response);
    await stream.until((f) => f.some((frame) => frame.event === "text"));

    const mismatch = await cancel(base, { turnId: "ход-которого-нет" });
    expect(mismatch.status).toBe(409);
    expect(stream.frames.some((frame) => frame.event === "cancelled")).toBe(false);
  });

  it("без идущего хода отмена — 404", async () => {
    const fake = await fakeForeman((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: playthroughIdFor(SAVE_ID) }));
    });
    const base = await adapterFor(fake);
    expect((await cancel(base, {})).status).toBe(404);
  });

  it("повторная отмена того же хода — не ошибка", async () => {
    const { fake } = await heldTurn();
    const base = await adapterFor(fake);

    const response = await postChat(base, { message: "долгий" });
    const stream = frameStream(response);
    const started = await stream.until((f) => f.some((frame) => frame.event === "text"));
    const turnId = (started[0]?.data as { turnId: string }).turnId;

    expect((await cancel(base, { turnId })).status).toBe(202);
    await stream.until((f) => f.some((frame) => frame.event === "cancelled"));
    expect((await cancel(base, { turnId })).status).toBe(202);
    // Кадр отмены ровно один: второй запрос в закрытый поток не пишет.
    expect(stream.frames.filter((frame) => frame.event === "cancelled")).toHaveLength(1);
  });
});

describe("API чата: история", () => {
  const history = (base: string, query = "") =>
    fetch(`${base}/mod/saves/${encodeURIComponent(SAVE_ID)}/history${query}`, { headers: auth });

  it("отдаёт хвост истории и идентификатор playthrough", async () => {
    const messages = Array.from({ length: 120 }, (_unused, index) => ({
      id: `m${index}`,
      role: index % 2 === 0 ? "user" : "assistant",
      content: `сообщение ${index}`,
      createdAt: new Date(index).toISOString(),
    }));
    const fake = await fakeForeman((req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(req.url?.endsWith("/messages") ? messages : { id: "x" }));
    });
    const base = await adapterFor(fake);

    const body = (await (await history(base, "?limit=10")).json()) as {
      playthroughId: string;
      messages: { content: string }[];
    };
    expect(body.playthroughId).toBe(playthroughIdFor(SAVE_ID));
    expect(body.messages).toHaveLength(10);
    expect(body.messages[0]?.content).toBe("сообщение 110");
    expect(body.messages[9]?.content).toBe("сообщение 119");
  });

  it("по умолчанию отдаёт последние 50", async () => {
    const messages = Array.from({ length: 80 }, (_unused, index) => ({
      id: `m${index}`,
      role: "user",
      content: `${index}`,
      createdAt: new Date(index).toISOString(),
    }));
    const fake = await fakeForeman((req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(req.url?.endsWith("/messages") ? messages : { id: "x" }));
    });
    const base = await adapterFor(fake);
    const body = (await (await history(base)).json()) as { messages: unknown[] };
    expect(body.messages).toHaveLength(50);
  });

  it("без токена не пускает", async () => {
    const fake = await fakeForeman((_req, res) => {
      res.end("[]");
    });
    const base = await adapterFor(fake);
    const response = await fetch(`${base}/mod/saves/${encodeURIComponent(SAVE_ID)}/history`);
    expect(response.status).toBe(401);
  });
});
