import { describe, expect, it } from "vitest";
import { encodeFrame, parseSse } from "../src/stream.js";

/** Поток байтов из строк — как их отдаёт `fetch`. */
function streamOf(...chunks: (string | Uint8Array)[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
      }
      controller.close();
    },
  });
}

async function all(stream: ReadableStream<Uint8Array>) {
  const events = [];
  for await (const event of parseSse(stream)) events.push(event);
  return events;
}

describe("разбор SSE", () => {
  it("читает имя события и тело", async () => {
    const events = await all(streamOf('event: text\ndata: {"delta":"раз"}\n\n'));
    expect(events).toEqual([{ event: "text", data: '{"delta":"раз"}' }]);
  });

  it("без имени события — «message», как в спецификации", async () => {
    expect(await all(streamOf("data: просто\n\n"))).toEqual([{ event: "message", data: "просто" }]);
  });

  it("несколько строк data склеиваются переводом строки", async () => {
    expect(await all(streamOf("event: text\ndata: первая\ndata: вторая\n\n"))).toEqual([
      { event: "text", data: "первая\nвторая" },
    ]);
  });

  it("комментарии и keep-alive событиями не становятся", async () => {
    expect(await all(streamOf(": keep-alive\n\ndata: тело\n\n"))).toEqual([
      { event: "message", data: "тело" },
    ]);
  });

  it("имя события не протекает в следующее", async () => {
    const events = await all(streamOf("event: done\ndata: 1\n\ndata: 2\n\n"));
    expect(events.map((entry) => entry.event)).toEqual(["done", "message"]);
  });

  it("оборванный поток отдаёт то, что успело собраться", async () => {
    // Без завершающей пустой строки: иначе последний кусок ответа пропал бы молча.
    expect(await all(streamOf("event: text\ndata: хвост"))).toEqual([
      { event: "text", data: "хвост" },
    ]);
  });

  it("переносит \\r\\n", async () => {
    expect(await all(streamOf("event: text\r\ndata: раз\r\n\r\n"))).toEqual([
      { event: "text", data: "раз" },
    ]);
  });
});

describe("кадры к моду", () => {
  it("одна строка — один объект", () => {
    const frame = encodeFrame("text", { delta: "раз" });
    expect(frame.endsWith("\n")).toBe(true);
    expect(JSON.parse(frame)).toEqual({ event: "text", data: { delta: "раз" } });
  });

  it("перевод строки внутри данных кадр не рвёт", () => {
    const frame = encodeFrame("text", { delta: "первая\nвторая" });
    expect(frame.split("\n")).toHaveLength(2);
    expect((JSON.parse(frame) as { data: { delta: string } }).data.delta).toBe("первая\nвторая");
  });
});
