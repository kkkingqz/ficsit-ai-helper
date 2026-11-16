import { describe, expect, it } from "vitest";
import {
  CHAT_VIEW_COPY_KEYS,
  createChatStrings,
  DEFAULT_CHAT_STRINGS,
  DEFAULT_CHAT_VIEW_COPY,
} from "../src/strings.js";
import type { ChatViewCopy } from "../src/types.js";

describe("строки экрана чата", () => {
  it("набор ключей представления заморожен", () => {
    expect(Object.keys(DEFAULT_CHAT_VIEW_COPY).sort()).toEqual([...CHAT_VIEW_COPY_KEYS].sort());
  });

  it("ни одна строка не пустая", () => {
    const empty: string[] = [];
    const walk = (value: unknown, path: string): void => {
      if (typeof value === "string") {
        if (value.trim().length === 0) empty.push(path);
        return;
      }
      if (Array.isArray(value)) {
        value.forEach((item, index) => walk(item, `${path}[${index}]`));
        return;
      }
      if (value && typeof value === "object") {
        for (const [key, inner] of Object.entries(value)) walk(inner, `${path}.${key}`);
      }
    };

    walk(DEFAULT_CHAT_VIEW_COPY, "view");
    expect(empty).toEqual([]);
  });

  it("подсказка потока показывает текущую привязку Back", () => {
    expect(DEFAULT_CHAT_VIEW_COPY.streaming("Esc")).toContain("Esc");
    expect(DEFAULT_CHAT_VIEW_COPY.streaming("Backspace")).toContain("Backspace");
  });

  it("у каждого шаблона есть и подпись, и текст", () => {
    for (const prompt of DEFAULT_CHAT_VIEW_COPY.prompts) {
      expect(prompt.label.length).toBeGreaterThan(0);
      expect(prompt.text.length).toBeGreaterThan(0);
    }
  });

  it("три состояния истории описаны отдельно", () => {
    const states = DEFAULT_CHAT_VIEW_COPY.historyStates;
    expect(Object.keys(states).sort()).toEqual(["empty", "loading", "unavailable"]);
    expect(states.empty.label).not.toBe(states.unavailable.label);
  });

  it("строки хоста подставляют причину и срок", () => {
    const host = DEFAULT_CHAT_STRINGS.host;
    expect(host.apiVersionMismatch("0.4.0 vs 0.5.0")).toContain("0.4.0 vs 0.5.0");
    expect(host.inert("save not loaded")).toContain("save not loaded");
    expect(host.rateLimited(2.2)).toContain("3");
    expect(host.messageTime(new Date(Date.UTC(2026, 10, 16, 9, 41)))).toMatch(/\d{2}:\d{2}/);
  });

  it("подмена заменяет вложенный объект целиком, а не половину", () => {
    const strings = createChatStrings({
      view: {
        historyStates: {
          loading: { label: "Загрузка истории" },
          empty: { label: "Сообщений пока нет" },
          unavailable: { label: "История недоступна" },
        },
      },
      host: { assistantAuthor: "ФИКСИТ ИИ" },
    });

    expect(strings.view.historyStates.empty.label).toBe("Сообщений пока нет");
    expect(strings.view.historyStates.empty.detail).toBeUndefined();
    expect(strings.host.assistantAuthor).toBe("ФИКСИТ ИИ");
    expect(strings.host.operatorAuthor).toBe(DEFAULT_CHAT_STRINGS.host.operatorAuthor);
    expect(strings.view.send).toBe(DEFAULT_CHAT_VIEW_COPY.send);
  });

  it("подмена не трогает набор по умолчанию", () => {
    createChatStrings({ view: { send: "Отправить" } });
    expect(DEFAULT_CHAT_VIEW_COPY.send).toBe("Send");
  });

  it("частичный набор строк не проходит как полный", () => {
    const partial = { history: "Conversation" };
    // @ts-expect-error — отсутствующий ключ ловится сборкой, а не прочерком на экране
    const copy: ChatViewCopy = partial;
    expect(copy.history).toBe("Conversation");
  });
});
