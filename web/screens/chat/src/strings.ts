import type { ChatHostStrings, ChatStrings, ChatViewCopy } from "./types.js";

/**
 * Набор по умолчанию. Тексты представления взяты из демонстрации вёрстки
 * (`web/ui-kit/screens/fixtures.js`, зона Gs2), чтобы экран и витрина говорили
 * одними словами. Два исключения — пустая история и строка офлайна: в
 * демонстрации они обещают Notes, Screens и Lines, которых в срезе v0.1 нет
 * (§17 архитектуры: Chat и Dashboard), и обещать экраны, которых игрок не
 * увидит, нельзя (ревью Gs на #61). Локаль здесь `en`, как у остальных экранов на этом этапе;
 * перевод — отдельная работа, и делается он подменой этого объекта, а не
 * правкой представления.
 */
export const DEFAULT_CHAT_VIEW_COPY: ChatViewCopy = {
  history: "Conversation",
  historyStates: {
    loading: { label: "Loading history" },
    empty: {
      label: "No messages yet",
      detail: "Ask about your factory. The assistant reads live telemetry and explains what it sees.",
    },
    unavailable: {
      label: "History unavailable",
      detail: "Earlier messages could not be loaded.",
    },
  },
  offlineTitle: "Assistant unavailable — the sidecar is not connected",
  offlineDetail: "Start the sidecar and reopen Chat. Connection retries automatically.",
  offlineScope: "The Dashboard keeps working: telemetry does not depend on the sidecar.",
  streaming: (backKey: string) => `Streaming… ${backKey} stops displaying the answer`,
  sending: "Sending request…",
  stop: "Stop",
  retry: "Retry",
  draftLabel: "Message",
  send: "Send",
  sendHint: "Enter to send · Shift+Enter for a new line",
  prompts: [
    { label: "Find the bottleneck", text: "Which production stage is limiting throughput?" },
    { label: "Explain this metric", text: "Explain the selected metric in factory terms." },
    { label: "Power use this session", text: "Summarize power consumption during this session." },
    { label: "What changed in 15 min", text: "What changed during the last 15 minutes?" },
  ],
  promptHint: "Templates fill the field. Press Send to submit.",
  context: "Factory context",
  workOrders: "Related work orders",
  assistant: "Assistant",
};

export const DEFAULT_CHAT_HOST_STRINGS: ChatHostStrings = {
  assistantAuthor: "FICSIT AI",
  operatorAuthor: "Operator",
  messageTime: (at: Date) =>
    new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit", hour12: false }).format(at),
  messageStatus: {
    stopped: "Stopped",
    failed: "Failed",
    tool: (name: string) => `Reading ${name}…`,
  },
  turnFailed: "The assistant did not respond.",
  sidecarUnavailable: "The sidecar is not connected, so the assistant cannot answer.",
  apiVersionMismatch: (detail: string) =>
    `The screen and the mod speak different API versions: ${detail}`,
  inert: (reason: string) => `The mod is inert, so factory data is unavailable: ${reason}`,
  rateLimited: (retryAfterSec: number) =>
    `Too many requests. Try again in ${Math.max(1, Math.ceil(retryAfterSec))} s.`,
};

export const DEFAULT_CHAT_STRINGS: ChatStrings = {
  locale: "en",
  view: DEFAULT_CHAT_VIEW_COPY,
  host: DEFAULT_CHAT_HOST_STRINGS,
};

/**
 * Замороженный перечень ключей представления. Нужен не компилятору, а тесту:
 * он ловит ключ, который тихо появился или пропал в наборе по умолчанию,
 * — такой ключ должен сначала попасть в тип и в уведомление Gs2 (Co2-48 §2).
 */
export const CHAT_VIEW_COPY_KEYS = [
  "history",
  "historyStates",
  "offlineTitle",
  "offlineDetail",
  "offlineScope",
  "streaming",
  "sending",
  "stop",
  "retry",
  "draftLabel",
  "send",
  "sendHint",
  "prompts",
  "promptHint",
  "context",
  "workOrders",
  "assistant",
] as const satisfies readonly (keyof ChatViewCopy)[];

/**
 * Набор строк с точечной подменой. Группы `view` и `host` сливаются по
 * верхнему уровню: вложенные объекты заменяются целиком, чтобы подмена
 * половины `historyStates` не оставила экран с чужой половиной.
 */
export function createChatStrings(overrides?: {
  locale?: string;
  view?: Partial<ChatViewCopy>;
  host?: Partial<ChatHostStrings>;
}): ChatStrings {
  return {
    locale: overrides?.locale ?? DEFAULT_CHAT_STRINGS.locale,
    view: { ...DEFAULT_CHAT_VIEW_COPY, ...overrides?.view },
    host: { ...DEFAULT_CHAT_HOST_STRINGS, ...overrides?.host },
  };
}
