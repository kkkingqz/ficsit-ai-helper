/**
 * Два формата потока в одном месте: разбор SSE, которым отвечает Foreman, и
 * сборка строчного JSON, которым адаптер отвечает моду.
 *
 * Почему моду не SSE. Транспорт канала мод ↔ адаптер выбран в ARCHITECTURE §13:
 * модуль `HTTP` игры с потоковым чтением тела, «построчный JSON». Своего
 * разбора SSE у мода нет, а заводить его ради одного маршрута — лишний парсер в
 * игровом процессе. Поэтому наружу идёт NDJSON: одна строка — один объект
 * `{event, data}`. Формат собран одной функцией {@link encodeFrame}: если
 * документ протокола канала (Co-37) потребует другой конверт, меняется она.
 */

export interface SseEvent {
  event: string;
  /** Тело события как есть; разбирать JSON — дело вызывающего. */
  data: string;
}

/**
 * Разбирает поток SSE в события. Склейка частей делается по байтам, а не по
 * строкам: `data:` с кириллицей приходит произвольно нарезанным на чанки, и
 * `TextDecoder` со `stream: true` — единственный способ не разорвать символ.
 */
export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let buffer = "";
  let event = "message";
  let data: string[] = [];

  const flush = (): SseEvent | undefined => {
    if (data.length === 0) {
      event = "message";
      return undefined;
    }
    const result: SseEvent = { event, data: data.join("\n") };
    event = "message";
    data = [];
    return result;
  };

  /** Одна строка потока. Возвращает событие, если строка его завершила. */
  const consume = (rawLine: string): SseEvent | undefined => {
    const line = rawLine.replace(/\r$/, "");
    if (line.length === 0) return flush();
    // Комментарий (в том числе keep-alive) событием не является.
    if (line.startsWith(":")) return undefined;

    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    const raw = colon < 0 ? "" : line.slice(colon + 1);
    const value = raw.startsWith(" ") ? raw.slice(1) : raw;
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
    return undefined;
  };

  try {
    for (;;) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      buffer += decoder.decode(chunk, { stream: true });

      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        const complete = consume(line);
        if (complete !== undefined) yield complete;
      }
    }
  } finally {
    reader.releaseLock();
  }

  // Поток оборвался без пустой строки в конце: недочитанную строку разбираем, и
  // то, что успело собраться, отдаём — иначе последний кусок ответа пропадёт
  // молча. Так заканчивается прерванный ход Foreman.
  buffer += decoder.decode();
  if (buffer.length > 0) {
    const complete = consume(buffer);
    if (complete !== undefined) yield complete;
  }
  const tail = flush();
  if (tail !== undefined) yield tail;
}

/** Одна строка потока к моду: `{"event":…,"data":…}` плюс перевод строки. */
export function encodeFrame(event: string, data: unknown): string {
  return `${JSON.stringify({ event, data })}\n`;
}
