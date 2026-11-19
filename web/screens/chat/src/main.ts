import { createApi, type FicsitAIApi } from "@ficsitai/screens-api";
import { createChatController, fallbackPresenter, type ChatController } from "./controller.js";
import { DEFAULT_CHAT_STRINGS } from "./strings.js";
import type { ChatPresenter, ChatStrings, MountChat } from "./types.js";

/**
 * Точка входа экрана «Чат с ИИ» (Co2-48 §1).
 *
 * Страница одна и та же в игре и в браузере: фасад сам выбирает транспорт —
 * мост к моду в игре, HTTP к dev-серверу в браузере. Представление приходит
 * из дизайн-системы D-2 (`web/ui-kit/screens/chat.js`, зона Gs2) и грузится
 * по адресу, а не импортом пакета: витрина и экран собираются порознь.
 */

const DEFAULT_VIEW_URL = "/ui-kit/screens/chat.js";
const DEFAULT_COMPONENTS_URL = "/ui-kit/components.js";

export interface MountChatScreenOptions {
  root: HTMLElement;
  api?: FicsitAIApi;
  strings?: ChatStrings;
  /** Адрес модуля представления; по умолчанию — D-2 рядом на странице. */
  viewUrl?: string;
  /** Адрес модуля компонентов D-2 — оттуда берётся форматтер. */
  componentsUrl?: string;
  /** Привязка действия Back, которую показывает подсказка потока. */
  backKey?: string;
}

interface ViewModule {
  mountChat?: MountChat;
}

interface ComponentsModule {
  createPresenter?: (locale: string, units: Record<string, string>) => ChatPresenter;
}

/** Подписи единиц для форматтера D-2: формы контракта, слова — экрана. */
const UNIT_LABELS: Record<string, string> = {
  megawatt: "MW",
  megawattHour: "MWh",
  itemsPerMinute: "items/min",
  cubicMetersPerMinute: "m³/min",
  percent: "%",
  count: "",
  seconds: "s",
};

export async function mountChatScreen(
  options: MountChatScreenOptions,
): Promise<ChatController> {
  const strings = options.strings ?? DEFAULT_CHAT_STRINGS;
  const api = options.api ?? createApi();

  const view = (await import(/* @vite-ignore */ options.viewUrl ?? DEFAULT_VIEW_URL)) as ViewModule;
  const mountChat = view.mountChat;
  if (typeof mountChat !== "function") {
    throw new Error(
      `модуль представления не отдал mountChat: ${options.viewUrl ?? DEFAULT_VIEW_URL}`,
    );
  }

  // Форматтер — из D-2, если он там есть. Свой остаётся запасным: он
  // форматирует числа по локали и ничего не решает о виде.
  let presenter: ChatPresenter = fallbackPresenter(strings.locale);
  try {
    const components = (await import(
      /* @vite-ignore */ options.componentsUrl ?? DEFAULT_COMPONENTS_URL
    )) as ComponentsModule;
    if (typeof components.createPresenter === "function") {
      presenter = components.createPresenter(strings.locale, UNIT_LABELS);
    }
  } catch {
    // Витрина рядом не лежит — экран всё равно работает.
  }

  return createChatController({
    api,
    mountView: mountChat,
    root: options.root,
    presenter,
    strings,
    ...(options.backKey === undefined ? {} : { backKey: options.backKey }),
  });
}

/** Автозапуск на странице: корень `#ficsitai-chat`, как в Co2-48. */
export function autoMount(): void {
  const root = document.getElementById("ficsitai-chat");
  if (root === null) return;
  void mountChatScreen({ root }).catch((err: unknown) => {
    // Экран не поднялся — игрок должен увидеть почему, а не пустой прямоугольник.
    root.textContent = `Chat screen failed to start: ${String(err)}`;
  });
}
