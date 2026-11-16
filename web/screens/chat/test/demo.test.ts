import { describe, expect, it } from "vitest";
import { CHAT_DEMO_STATES, chatDemoModel } from "../src/demo.js";
import { DEFAULT_CHAT_STRINGS } from "../src/strings.js";
import type { ChatActions, ChatViewHandle, ChatViewModel, MountChat } from "../src/types.js";

describe("демонстрационные модели", () => {
  it("каждое состояние даёт модель, пригодную для представления", () => {
    for (const state of CHAT_DEMO_STATES) {
      const model: ChatViewModel = chatDemoModel(state);
      expect(typeof model.connected).toBe("boolean");
      expect(typeof model.streaming).toBe("boolean");
      expect(typeof model.draft).toBe("string");
      expect(model.backKey.length).toBeGreaterThan(0);
      expect(Array.isArray(model.messages)).toBe(true);
    }
  });

  it("пустая история и недоступная — разные состояния", () => {
    expect(chatDemoModel("empty").history).toBe("empty");
    expect(chatDemoModel("empty").connected).toBe(true);
    expect(chatDemoModel("offline").history).toBe("unavailable");
    expect(chatDemoModel("offline").connected).toBe(false);
  });

  it("без связи повтор недоступен, с ошибкой хода — доступен", () => {
    expect(chatDemoModel("offline").error?.canRetry).toBe(false);
    expect(chatDemoModel("error").error?.canRetry).toBe(true);
  });

  it("у показанных сообщений стабильные идентификаторы", () => {
    const ids = chatDemoModel("ready").messages.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(chatDemoModel("streaming").messages[1]?.id).toBe(
      chatDemoModel("ready").messages[1]?.id,
    );
  });

  it("пометки сообщений приходят из строк хоста, а не из представления", () => {
    expect(chatDemoModel("offline").messages[1]?.status).toBe(
      DEFAULT_CHAT_STRINGS.host.messageStatus.stopped,
    );
  });

  it("подпись mountChat сходится с моделью и обработчиками", () => {
    const seen: string[] = [];
    const actions: ChatActions = {
      draft: (text) => seen.push(`draft:${text}`),
      send: (text) => seen.push(`send:${text}`),
      stop: () => seen.push("stop"),
      retry: () => seen.push("retry"),
    };

    const mountChat: MountChat = (_root, options): ChatViewHandle => {
      let current: ChatViewModel | null = null;
      return {
        update: (model) => {
          current = model;
        },
        handleBackAction: () => {
          if (!current?.streaming) return false;
          options.actions.stop();
          return true;
        },
        unmount: () => {
          current = null;
        },
      };
    };

    const presenter = {
      number: (value: number, digits: number) => value.toFixed(digits),
      parts: () => ({ amount: "—", unit: "" }),
      reading: () => "—",
    };

    const view = mountChat({} as HTMLElement, {
      presenter,
      copy: DEFAULT_CHAT_STRINGS.view,
      actions,
    });

    view.update(chatDemoModel("ready"));
    expect(view.handleBackAction()).toBe(false);

    view.update(chatDemoModel("streaming"));
    expect(view.handleBackAction()).toBe(true);

    actions.send("Which stage limits throughput?");
    view.unmount();
    expect(seen).toEqual(["stop", "send:Which stage limits throughput?"]);
  });
});
