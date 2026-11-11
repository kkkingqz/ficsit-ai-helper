import { createHash } from "node:crypto";
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
 * `finish_reason` вольное. Поэтому нормализация — постоянное требование. С
 * 10.11.2026 Gemini выбран провайдером по умолчанию (§17.1), поэтому этот путь
 * проходит каждый тестер, а не только тот, кто настроил его сам (R-29).
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
 * Нормализатор запоминает подпись и возвращает её на место. ADR-034 расширен на
 * обе стороны (Co-24): в ответах правится форма, в запросе возвращается **его
 * же непрозрачное поле из его же ответа в пределах того же разговора**. Мы её
 * не создаём, не читаем и не переносим между разговорами.
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
 * Подписи мыслей. Кэш в памяти, в пределах разговора, без записи на диск
 * (§12 п. 2а, Co-24): файл с подписями стал бы вторым хранилищем данных
 * разговора помимо базы Foreman, а §10 говорит, что оно одно. Потерянная при
 * перезапуске подпись даёт ошибку на следующем ходе, а не порчу истории.
 */
const SIGNATURE_LIMIT = 200;

interface ToolCallWithSignature {
  id?: string;
  index?: number;
  extra_content?: { google?: Record<string, unknown> };
}

function fingerprint(parts: readonly (string | undefined)[]): string {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(part ?? "");
    hash.update("\u0000");
  }
  return hash.digest("hex").slice(0, 32);
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

/**
 * Отпечаток разговора по последнему сообщению пользователя.
 *
 * Разговора в OpenAI-совместимом протоколе нет: идентификатора он не несёт, и
 * один кэш на приложение раздавал подпись одного разговора другому при
 * совпадении идентификатора вызова (ревью Gs-11, п. 3). Границу приходится
 * восстанавливать из того, что провайдеру и так отправлено.
 *
 * Почему именно последнее сообщение пользователя: ход инструмента (запрос N) и
 * ход с его результатом (запрос N+1) отличаются только дописанными в конец
 * сообщениями ассистента и `role: "tool"`, нового сообщения пользователя между
 * ними нет. Поэтому отпечаток у них один. Привязываться к началу истории нельзя:
 * `HISTORY_WINDOW` сдвигает окно, и ключ менялся бы посреди хода.
 *
 * Остаётся случай, когда в двух разговорах совпали и текст последнего сообщения
 * пользователя, и идентификатор вызова: на границе протокола такие два хода
 * неразличимы вообще. Записал это вопросом Co2-10, потому что формулировка §12
 * говорит про разговор, а разговора здесь нет.
 */
export function conversationAnchor(messages: readonly unknown[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i] as { role?: string; content?: unknown };
    if (message.role !== "user") continue;
    const content = typeof message.content === "string" ? message.content : safeJson(message.content);
    return fingerprint([content]);
  }
  return fingerprint(["(без сообщения пользователя)"]);
}

export class SignatureStore {
  private readonly map = new Map<string, string>();

  /** Ключ — отпечаток разговора и идентификатор вызова, а не один идентификатор. */
  private key(anchor: string, call: ToolCallWithSignature): string | undefined {
    if (call.id === undefined || call.id.length === 0) return undefined;
    return fingerprint([anchor, call.id]);
  }

  public remember(anchor: string, calls: readonly unknown[]): void {
    for (const call of calls) {
      const typed = call as ToolCallWithSignature;
      const signature = typed.extra_content?.google?.thought_signature;
      const key = this.key(anchor, typed);
      if (key === undefined || typeof signature !== "string") continue;
      this.map.delete(key);
      this.map.set(key, signature);
      while (this.map.size > SIGNATURE_LIMIT) {
        const oldest = this.map.keys().next();
        if (oldest.done === true) break;
        this.map.delete(oldest.value);
      }
    }
  }

  /** Возвращает число восстановленных подписей в запросе. */
  public restore(anchor: string, messages: readonly unknown[]): number {
    let restored = 0;
    for (const message of messages) {
      const typed = message as { role?: string; tool_calls?: ToolCallWithSignature[] };
      if (typed.role !== "assistant" || !Array.isArray(typed.tool_calls)) continue;
      for (const call of typed.tool_calls) {
        if (call.extra_content?.google?.thought_signature !== undefined) continue;
        const key = this.key(anchor, call);
        if (key === undefined) continue;
        const signature = this.map.get(key);
        if (signature === undefined) continue;
        // Соседние поля сохраняются: подмена объекта `google` целиком стирала
        // то, что провайдер положил рядом с подписью (ревью Gs-11, п. 2).
        call.extra_content = {
          ...call.extra_content,
          google: { ...call.extra_content?.google, thought_signature: signature },
        };
        restored += 1;
      }
    }
    return restored;
  }
}

interface Choice {
  index?: number;
  finish_reason?: string | null;
  delta?: { tool_calls?: unknown[] };
  message?: { tool_calls?: unknown[] };
}

function toolCallsOf(choice: Choice): unknown[] | undefined {
  const calls = choice.delta?.tool_calls ?? choice.message?.tool_calls;
  return Array.isArray(calls) ? calls : undefined;
}

function indexOf(choice: Choice): number {
  return typeof choice.index === "number" ? choice.index : 0;
}

/**
 * Единственная правка: `stop` → `tool_calls`, если вызовы инструментов есть.
 *
 * Признак хранится отдельно для каждого `choice.index`: один общий флаг ставил
 * `tool_calls` текстовому варианту ответа, если вызов пришёл в соседнем
 * (ревью Gs-11, п. 1).
 */
function fixChoices(choices: readonly Choice[], seenToolCalls: Set<number>): boolean {
  let changed = false;
  for (const choice of choices) {
    const index = indexOf(choice);
    const calls = toolCallsOf(choice);
    if (calls !== undefined && calls.length > 0) seenToolCalls.add(index);
    if (seenToolCalls.has(index) && choice.finish_reason === "stop") {
      choice.finish_reason = "tool_calls";
      changed = true;
    }
  }
  return changed;
}

/** Google заворачивает ошибки в массив из одного элемента — разворачиваем. */
function unwrapSingleton(value: unknown): unknown {
  return Array.isArray(value) && value.length === 1 ? value[0] : value;
}

/**
 * Запрос: тело с восстановленными подписями, их число и отпечаток разговора.
 * Отпечаток возвращается наружу, потому что подписи из ответа на этот же запрос
 * кладутся в кэш под ним же.
 */
export function prepareRequestBody(
  raw: Buffer,
  store: SignatureStore,
): { body: Buffer; restored: number; anchor: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    return { body: raw, restored: 0, anchor: "" };
  }
  const payload = parsed as { messages?: unknown[] };
  if (!Array.isArray(payload.messages)) return { body: raw, restored: 0, anchor: "" };
  const anchor = conversationAnchor(payload.messages);
  const restored = store.restore(anchor, payload.messages);
  if (restored === 0) return { body: raw, restored: 0, anchor };
  return { body: Buffer.from(JSON.stringify(payload), "utf8"), restored, anchor };
}

export function normalizeNonStreamBody(
  raw: string,
  store?: SignatureStore,
  anchor = "",
): { body: string; changed: boolean } {
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
    // Подписи запоминаются и здесь: раньше в кэш писал только путь SSE, и после
    // обычного JSON-ответа подпись на следующем ходе не восстанавливалась
    // (ревью Gs-11, п. 2).
    if (store !== undefined) {
      for (const choice of payload.choices) {
        const calls = toolCallsOf(choice);
        if (calls !== undefined) store.remember(anchor, calls);
      }
    }
    changed = fixChoices(payload.choices, new Set<number>()) || changed;
  }
  return changed ? { body: JSON.stringify(payload), changed: true } : { body: raw, changed: false };
}

/**
 * В потоке идентификатор вызова приходит в первом фрагменте, а подпись может
 * оказаться в следующем, где есть только `index`. Поэтому идентификатор
 * запоминается по месту вызова в ответе.
 */
function withKnownId(
  ids: Map<string, string>,
  choiceIndex: number,
  call: unknown,
  position: number,
): ToolCallWithSignature {
  const typed = call as ToolCallWithSignature;
  const slot = `${choiceIndex}:${typed.index ?? position}`;
  if (typeof typed.id === "string" && typed.id.length > 0) {
    ids.set(slot, typed.id);
    return typed;
  }
  const known = ids.get(slot);
  return known === undefined ? typed : { ...typed, id: known };
}

/** Разбирает поток SSE построчно и правит только строки `data:`. */
export function createSseNormalizer(
  store?: SignatureStore,
  anchor = "",
): {
  transform: (chunk: string) => string;
  flush: () => string;
  rewrites: () => number;
} {
  let pending = "";
  const seenToolCalls = new Set<number>();
  const idBySlot = new Map<string, string>();
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
    if (Array.isArray(chunk.choices)) {
      if (store !== undefined) {
        for (const choice of chunk.choices) {
          const calls = toolCallsOf(choice);
          if (calls === undefined) continue;
          const index = indexOf(choice);
          store.remember(
            anchor,
            calls.map((call, position) => withKnownId(idBySlot, index, call, position)),
          );
        }
      }
      changed = fixChoices(chunk.choices, seenToolCalls) || changed;
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

/**
 * Адрес провайдера: путь базы и путь запроса складываются как пути, а параметры
 * — как параметры.
 *
 * Прежняя склейка строк ломалась, когда в `LLM_UPSTREAM_BASE_URL` была строка
 * запроса: `…/v1?key=…` + `/chat/completions` давало путь `/v1` и значение
 * параметра `key=…/chat/completions` (ревью Gs-14, п. 2). Строку запроса в
 * базовом адресе отклонять нельзя — V-08 обещает любой OpenAI-совместимый
 * адрес, а некоторые шлюзы передают ключ именно так.
 *
 * При совпадении имени параметра побеждает запрос: база — это настройка, а
 * запрос приходит от клиента, который знает про конкретный вызов (`alt=sse`).
 */
export function resolveTarget(upstreamBaseUrl: string, requestUrl: string): URL {
  const base = new URL(upstreamBaseUrl);
  const incoming = new URL(requestUrl, "http://request.invalid");
  const target = new URL(base.toString());
  target.pathname = `${base.pathname.replace(/\/+$/, "")}${incoming.pathname}`;
  for (const [name, value] of incoming.searchParams) target.searchParams.set(name, value);
  return target;
}

/**
 * Переходы по `Location` не выполняются вовсе.
 *
 * `fetch` по умолчанию идёт за редиректом и **повторяет наши заголовки**, а
 * среди них ключ провайдера: `303` на `POST` уводил запрос с ключом на другой
 * порт, и второй сервер его получал (ревью Gs-14, п. 1). Спецификация снимает
 * при смене origin только `Authorization`, а `x-goog-api-key` и `api-key` —
 * заголовки провайдера, и про них она не знает.
 *
 * Поэтому `redirect: "manual"`, а любой `3xx` с `Location` — отказ `502` с
 * понятным сообщением: адрес провайдера задаётся локально, и редирект значит,
 * что настройка указывает не туда. Переход в пределах того же origin тоже не
 * делаем: это отдельная ветка с повтором тела, а пользы от неё нет.
 */
const REDIRECT_REFUSED = "upstream redirect refused: set LLM_UPSTREAM_BASE_URL to the final address";

export function createNormalizerApp(upstreamBaseUrl: string, log: Logger) {
  const signatures = new SignatureStore();
  const app = express();
  app.disable("x-powered-by");
  app.use(express.raw({ type: () => true, limit: "32mb" }));

  app.use(async (req: Request, res: Response) => {
    const target = resolveTarget(upstreamBaseUrl, req.url);
    const headers: Record<string, string> = { "accept-encoding": "identity" };
    for (const name of FORWARD_HEADERS) {
      const value = req.header(name);
      if (value !== undefined) headers[name] = value;
    }

    let body = Buffer.isBuffer(req.body) && req.body.length > 0 ? req.body : undefined;
    let restoredSignatures = 0;
    let anchor = "";
    if (body !== undefined) {
      const prepared = prepareRequestBody(body, signatures);
      body = prepared.body;
      restoredSignatures = prepared.restored;
      anchor = prepared.anchor;
      if (restoredSignatures > 0) headers["content-length"] = String(body.length);
    }

    // Тела не логируем: только метод, путь, код и число правок (§12, ADR-034).
    // Путь — из разобранного адреса, без строки запроса: ключ провайдера ездит
    // именно там (ревью Gs-11, п. 4).
    const path = target.pathname;

    // Строка до обращения к провайдеру: если он подвиснет, в логе останется
    // хотя бы попытка.
    log.debug(`→ провайдер ${req.method} ${path}`);

    let upstream: globalThis.Response;
    try {
      upstream = await fetch(target, {
        method: req.method,
        headers,
        redirect: "manual",
        ...(body !== undefined ? { body } : {}),
      });
    } catch (err: unknown) {
      log.error(`провайдер недоступен: ${req.method} ${path}`, err);
      res.status(502).json({ error: { message: "upstream unavailable", type: "normalizer" } });
      return;
    }

    // Редирект не выполняем: за ним ушли бы наши заголовки вместе с ключом.
    if (upstream.status >= 300 && upstream.status < 400 && upstream.headers.has("location")) {
      const location = upstream.headers.get("location") ?? "";
      const destination = ((): string => {
        try {
          return new URL(location, target).origin;
        } catch {
          return "<адрес не разобран>";
        }
      })();
      log.error(
        `провайдер ответил ${upstream.status} с переходом на ${destination} — не повторяю запрос: ` +
          "в заголовках ключ провайдера",
      );
      res.status(502).json({ error: { message: REDIRECT_REFUSED, type: "normalizer" } });
      return;
    }

    const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
    res.status(upstream.status);
    res.setHeader("content-type", contentType);

    if (contentType.includes("text/event-stream") && upstream.body !== null) {
      res.setHeader("cache-control", "no-cache");
      res.setHeader("connection", "keep-alive");
      const sse = createSseNormalizer(signatures, anchor);
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
    const { body: normalized, changed } = normalizeNonStreamBody(raw, signatures, anchor);
    res.send(normalized);
    log.info(
      `${req.method} ${path} → ${upstream.status}${changed ? ", ответ нормализован" : ""}` +
        (restoredSignatures > 0 ? `, подписей восстановлено: ${restoredSignatures}` : ""),
    );
  });

  return app;
}
