import express, { type Request, type Response } from "express";
import type { Logger } from "./log.js";

/**
 * Нормализатор ответов LLM-провайдера (ADR-034).
 *
 * `LLM_BASE_URL` Foreman указывает сюда; мы проксируем к настоящему провайдеру
 * и приводим ответ к тому, что ожидает OpenAI-совместимый клиент.
 *
 * Основание — не поломка одного провайдера, а AC-12 и V-08: альфа принимает
 * любой OpenAI-совместимый адрес и локальные модели, у которых обращение с
 * `finish_reason` вольное. Поэтому нормализация — постоянное требование.
 *
 * Первый случай: Google в потоковом режиме отдаёт `finish_reason: "stop"`
 * даже когда в том же ответе есть `tool_calls` (без потока — корректный
 * `"tool_calls"`). `ff-server` решает по `finish_reason`, поэтому вызовы
 * инструментов собирались и молча отбрасывались: ни текста, ни ошибки.
 *
 * Второй случай: Gemini 3.x требует, чтобы в следующем запросе вместе с вызовом
 * инструмента вернулась его `thought_signature`. Приходит она в `extra_content`
 * ответа, а OpenAI-совместимая форма Foreman это поле теряет — на втором ходе
 * провайдер отвечает `400 Function call is missing a thought_signature`.
 * Нормализатор запоминает подпись по идентификатору вызова и возвращает её на
 * место. Это восстановление поля, которое потеряла совместимая форма, а не
 * вмешательство в содержимое — но оно двунаправленное, поэтому формулировку
 * ADR-034 надо расширить (вопрос Co2-6).
 *
 * **Это нормализатор, а не слой политики.** Можно: править `finish_reason`,
 * склеивать `tool_calls`, приводить формы ошибок. Нельзя: добавлять или менять
 * системные промпты, переписывать определения инструментов, фильтровать
 * содержимое — иначе граница доверия §7 переезжает в недокументированное место.
 * Тела запросов и ответов не логируются (§12).
 */

/** Заголовки, которые имеет смысл передавать провайдеру. */
const FORWARD_HEADERS = ["authorization", "content-type", "accept", "x-goog-api-key", "api-key"];

/**
 * Подписи мыслей по идентификатору вызова инструмента. Ограничены по размеру:
 * это кэш одного разговора, а не хранилище.
 */
const SIGNATURE_LIMIT = 200;

interface ToolCallWithSignature {
  id?: string;
  extra_content?: { google?: { thought_signature?: string } };
}

class SignatureStore {
  private readonly map = new Map<string, string>();

  public remember(calls: unknown[]): void {
    for (const call of calls) {
      const typed = call as ToolCallWithSignature;
      const signature = typed.extra_content?.google?.thought_signature;
      if (typed.id === undefined || signature === undefined) continue;
      this.map.delete(typed.id);
      this.map.set(typed.id, signature);
      while (this.map.size > SIGNATURE_LIMIT) {
        const oldest = this.map.keys().next();
        if (oldest.done === true) break;
        this.map.delete(oldest.value);
      }
    }
  }

  /** Возвращает число восстановленных подписей в запросе. */
  public restore(messages: unknown[]): number {
    let restored = 0;
    for (const message of messages) {
      const typed = message as { role?: string; tool_calls?: ToolCallWithSignature[] };
      if (typed.role !== "assistant" || !Array.isArray(typed.tool_calls)) continue;
      for (const call of typed.tool_calls) {
        if (call.id === undefined) continue;
        if (call.extra_content?.google?.thought_signature !== undefined) continue;
        const signature = this.map.get(call.id);
        if (signature === undefined) continue;
        call.extra_content = { ...call.extra_content, google: { thought_signature: signature } };
        restored += 1;
      }
    }
    return restored;
  }
}

interface Choice {
  finish_reason?: string | null;
  delta?: { tool_calls?: unknown[] };
  message?: { tool_calls?: unknown[] };
}

/** Единственная правка: `stop` → `tool_calls`, если вызовы инструментов есть. */
function fixChoices(choices: Choice[], sawToolCalls: boolean): { changed: boolean; sawToolCalls: boolean } {
  let changed = false;
  let seen = sawToolCalls;
  for (const choice of choices) {
    const calls = choice.delta?.tool_calls ?? choice.message?.tool_calls;
    if (Array.isArray(calls) && calls.length > 0) seen = true;
    if (seen && choice.finish_reason === "stop") {
      choice.finish_reason = "tool_calls";
      changed = true;
    }
  }
  return { changed, sawToolCalls: seen };
}

/** Google заворачивает ошибки в массив из одного элемента — разворачиваем. */
function unwrapSingleton(value: unknown): unknown {
  return Array.isArray(value) && value.length === 1 ? value[0] : value;
}

/** Запрос: возвращает тело с восстановленными подписями и их число. */
export function restoreSignaturesInRequest(
  raw: Buffer,
  store: SignatureStore,
): { body: Buffer; restored: number } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    return { body: raw, restored: 0 };
  }
  const payload = parsed as { messages?: unknown[] };
  if (!Array.isArray(payload.messages)) return { body: raw, restored: 0 };
  const restored = store.restore(payload.messages);
  if (restored === 0) return { body: raw, restored: 0 };
  return { body: Buffer.from(JSON.stringify(payload), "utf8"), restored };
}

export function normalizeNonStreamBody(raw: string): { body: string; changed: boolean } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { body: raw, changed: false };
  }
  const unwrapped = unwrapSingleton(parsed);
  const payload = unwrapped as { choices?: Choice[] };
  let changed = unwrapped !== parsed;
  if (Array.isArray(payload.choices)) {
    changed = fixChoices(payload.choices, false).changed || changed;
  }
  return changed ? { body: JSON.stringify(payload), changed: true } : { body: raw, changed: false };
}

/** Разбирает поток SSE построчно и правит только строки `data:`. */
export function createSseNormalizer(store?: SignatureStore): {
  transform: (chunk: string) => string;
  flush: () => string;
  rewrites: () => number;
} {
  let pending = "";
  let sawToolCalls = false;
  let rewrites = 0;

  const line = (text: string): string => {
    if (!text.startsWith("data:")) return text;
    const payload = text.slice("data:".length).trim();
    if (payload.length === 0 || payload === "[DONE]") return text;
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      return text;
    }
    const unwrapped = unwrapSingleton(parsed);
    const chunk = unwrapped as { choices?: Choice[] };
    let changed = unwrapped !== parsed;
    if (store !== undefined && Array.isArray(chunk.choices)) {
      for (const choice of chunk.choices) {
        const calls = choice.delta?.tool_calls ?? choice.message?.tool_calls;
        if (Array.isArray(calls)) store.remember(calls);
      }
    }
    if (Array.isArray(chunk.choices)) {
      const result = fixChoices(chunk.choices, sawToolCalls);
      sawToolCalls = result.sawToolCalls;
      changed = result.changed || changed;
    }
    if (!changed) return text;
    rewrites += 1;
    return `data: ${JSON.stringify(chunk)}`;
  };

  return {
    transform: (incoming: string): string => {
      pending += incoming;
      const parts = pending.split("\n");
      pending = parts.pop() ?? "";
      return parts.map(line).map((l) => `${l}\n`).join("");
    },
    flush: (): string => {
      const tail = pending;
      pending = "";
      return tail.length > 0 ? line(tail) : "";
    },
    rewrites: () => rewrites,
  };
}

export function createNormalizerApp(upstreamBaseUrl: string, log: Logger) {
  const signatures = new SignatureStore();
  const app = express();
  app.disable("x-powered-by");
  app.use(express.raw({ type: () => true, limit: "32mb" }));

  app.use(async (req: Request, res: Response) => {
    const target = `${upstreamBaseUrl.replace(/\/+$/, "")}${req.url}`;
    const headers: Record<string, string> = { "accept-encoding": "identity" };
    for (const name of FORWARD_HEADERS) {
      const value = req.header(name);
      if (value !== undefined) headers[name] = value;
    }

    let body = Buffer.isBuffer(req.body) && req.body.length > 0 ? req.body : undefined;
    let restoredSignatures = 0;
    if (body !== undefined) {
      const restored = restoreSignaturesInRequest(body, signatures);
      body = restored.body;
      restoredSignatures = restored.restored;
      if (restoredSignatures > 0) headers["content-length"] = String(body.length);
    }

    let upstream: globalThis.Response;
    try {
      upstream = await fetch(target, {
        method: req.method,
        headers,
        ...(body !== undefined ? { body } : {}),
      });
    } catch (err: unknown) {
      log.error(`провайдер недоступен: ${req.method} ${new URL(target).pathname}`, err);
      res.status(502).json({ error: { message: "upstream unavailable", type: "normalizer" } });
      return;
    }

    const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
    res.status(upstream.status);
    res.setHeader("content-type", contentType);

    // Тела не логируем: только метод, путь, код и число правок (§12, ADR-034).
    const path = new URL(target).pathname;

    if (contentType.includes("text/event-stream") && upstream.body !== null) {
      res.setHeader("cache-control", "no-cache");
      res.setHeader("connection", "keep-alive");
      const sse = createSseNormalizer(signatures);
      const decoder = new TextDecoder();
      for await (const piece of upstream.body as unknown as AsyncIterable<Uint8Array>) {
        res.write(sse.transform(decoder.decode(piece, { stream: true })));
      }
      const tail = sse.flush();
      if (tail.length > 0) res.write(tail);
      res.end();
      log.info(
        `поток ${req.method} ${path} → ${upstream.status}, правок finish_reason: ${sse.rewrites()}` +
          (restoredSignatures > 0 ? `, подписей восстановлено: ${restoredSignatures}` : ""),
      );
      return;
    }

    const raw = await upstream.text();
    const { body: normalized, changed } = normalizeNonStreamBody(raw);
    res.send(normalized);
    log.info(
      `${req.method} ${path} → ${upstream.status}${changed ? ", ответ нормализован" : ""}` +
        (restoredSignatures > 0 ? `, подписей восстановлено: ${restoredSignatures}` : ""),
    );
  });

  return app;
}
