import { describe, expect, it } from "vitest";
import {
  SignatureStore,
  conversationAnchor,
  createSseNormalizer,
  normalizeNonStreamBody,
  prepareRequestBody,
} from "../src/normalizer.js";
import { redact, safeUrl } from "../src/log.js";
import { loadConfig } from "../src/config.js";

/**
 * Замечания ревью Gs-11 к PR #35. Каждый блок воспроизводит поломку так, как
 * она была описана, а не так, как её удобнее починить.
 *
 * Сквозные сценарии (исправный поток, поломка провайдера) живут в
 * `tests/fake-llm/` у Gf2: исправный и сломанный поток должны лежать рядом
 * (Co-23). Здесь — свойства самого нормализатора, которые эмулятор провайдера
 * выразить не может: соседний вариант ответа, границы кэша подписей, маскировка.
 */

function sse(lines: readonly unknown[]): { text: string; rewrites: number } {
  const normalizer = createSseNormalizer();
  let text = "";
  for (const line of lines) text += normalizer.transform(`data: ${JSON.stringify(line)}\n\n`);
  text += normalizer.flush();
  return { text, rewrites: normalizer.rewrites() };
}

const toolCall = {
  id: "call-1",
  index: 0,
  type: "function",
  function: { name: "total_raw_inputs", arguments: "{}" },
};

describe("п. 1 — признак tool_calls отдельно для каждого варианта ответа", () => {
  it("не ставит tool_calls текстовому варианту, когда вызов пришёл в соседнем", () => {
    const { text } = sse([
      { choices: [{ index: 0, delta: { tool_calls: [toolCall] } }] },
      { choices: [{ index: 1, delta: { content: "железная руда" }, finish_reason: "stop" }] },
      { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
    ]);
    const choices = text
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => JSON.parse(line.slice("data: ".length)) as { choices: { index: number; finish_reason?: string }[] })
      .flatMap((chunk) => chunk.choices);

    expect(choices.find((c) => c.index === 1 && c.finish_reason !== undefined)?.finish_reason).toBe("stop");
    expect(choices.find((c) => c.index === 0 && c.finish_reason !== undefined)?.finish_reason).toBe("tool_calls");
  });

  it("исправный текстовый поток проходит без правок", () => {
    const { text, rewrites } = sse([
      { choices: [{ index: 0, delta: { content: "360 единиц в минуту" } }] },
      { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
    ]);
    expect(rewrites).toBe(0);
    expect(text).toContain('"finish_reason":"stop"');
    expect(text).not.toContain("tool_calls");
  });
});

describe("п. 2 — возврат подписи не стирает соседние поля и видит JSON-ответ", () => {
  const messages = [{ role: "user", content: "сколько руды на 30 пластин" }];
  const anchor = conversationAnchor(messages);

  function requestWithCall(extra: Record<string, unknown>): Buffer {
    return Buffer.from(
      JSON.stringify({
        messages: [
          ...messages,
          { role: "assistant", tool_calls: [{ ...toolCall, extra_content: { google: extra } }] },
          { role: "tool", tool_call_id: toolCall.id, content: "{}" },
        ],
      }),
      "utf8",
    );
  }

  it("сохраняет прежние свойства extra_content.google", () => {
    const store = new SignatureStore();
    store.remember(anchor, [{ ...toolCall, extra_content: { google: { thought_signature: "подпись" } } }]);

    const prepared = prepareRequestBody(requestWithCall({ existing: "не терять" }), store);
    expect(prepared.restored).toBe(1);

    const body = JSON.parse(prepared.body.toString("utf8")) as {
      messages: { tool_calls?: { extra_content?: { google?: Record<string, unknown> } }[] }[];
    };
    const google = body.messages[1]?.tool_calls?.[0]?.extra_content?.google;
    expect(google).toEqual({ existing: "не терять", thought_signature: "подпись" });
  });

  it("запоминает подпись и из обычного JSON-ответа, а не только из потока", () => {
    const store = new SignatureStore();
    normalizeNonStreamBody(
      JSON.stringify({
        choices: [
          {
            index: 0,
            finish_reason: "tool_calls",
            message: {
              role: "assistant",
              tool_calls: [{ ...toolCall, extra_content: { google: { thought_signature: "из-json" } } }],
            },
          },
        ],
      }),
      store,
      anchor,
    );

    expect(prepareRequestBody(requestWithCall({}), store).restored).toBe(1);
  });
});

describe("п. 3 — кэш подписей не выходит за разговор", () => {
  function request(userText: string): Buffer {
    return Buffer.from(
      JSON.stringify({
        messages: [
          { role: "user", content: userText },
          { role: "assistant", tool_calls: [toolCall] },
          { role: "tool", tool_call_id: toolCall.id, content: "{}" },
        ],
      }),
      "utf8",
    );
  }

  const stored = (userText: string): SignatureStore => {
    const store = new SignatureStore();
    store.remember(conversationAnchor([{ role: "user", content: userText }]), [
      { ...toolCall, extra_content: { google: { thought_signature: "подпись разговора А" } } },
    ]);
    return store;
  };

  it("в своём разговоре подпись возвращается", () => {
    expect(prepareRequestBody(request("разговор А"), stored("разговор А")).restored).toBe(1);
  });

  it("в другом разговоре с тем же идентификатором вызова — нет", () => {
    expect(prepareRequestBody(request("разговор Б"), stored("разговор А")).restored).toBe(0);
  });
});

describe("п. 4 — ключ провайдера не попадает в лог", () => {
  it("адрес в логе остаётся без строки запроса", () => {
    expect(safeUrl("https://generativelanguage.googleapis.com/v1beta/openai?x-goog-api-key=AIzaSyA-SECRET")).toBe(
      "https://generativelanguage.googleapis.com/v1beta/openai",
    );
  });

  it("маскировка ловит x-goog-api-key в строке запроса", () => {
    const masked = redact("GET https://host/v1?x-goog-api-key=AIzaSyA-SECRET&alt=sse");
    expect(masked).not.toContain("AIzaSyA-SECRET");
    expect(masked).toContain("<скрыто>");
    expect(masked).toContain("alt=sse");
  });
});

describe("п. 5 — версия API по умолчанию идёт за контрактом", () => {
  it("0.3.0, пока окружение не сказало иначе", () => {
    expect(loadConfig({ ADAPTER_TOKEN: "0".repeat(32) }).apiVersion).toBe("0.3.0");
  });
});
