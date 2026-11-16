import type { MetricValue } from "@ficsitai/screens-api";
import { DEFAULT_CHAT_STRINGS } from "./strings.js";
import type { ChatMessage, ChatViewModel } from "./types.js";

/**
 * Демонстрационные модели для витрины и dev-источника (Co2-48 §4).
 *
 * Это не телеметрия и не выдаётся за неё: данные детерминированные, служат
 * только для вёрстки и дымовых проверок. В экране их нет — он строит модель
 * из фасада.
 */
export type ChatDemoState =
  | "ready"
  | "empty"
  | "loading"
  | "streaming"
  | "sending"
  | "error"
  | "offline";

const reading = (value: number): MetricValue => ({
  kind: "value",
  metricId: "power.production",
  scopeId: "factory",
  state: "value",
  value,
  unit: "megawatt",
  source: "fixture",
  sessionTimeSec: 2098,
  precisionDigits: 0,
});

const operator: ChatMessage = {
  id: "operator-1",
  role: "operator",
  author: DEFAULT_CHAT_STRINGS.host.operatorAuthor,
  time: "09:41",
  text: "How much power headroom do we have, and where is most of it used?",
};

const assistant: ChatMessage = {
  id: "assistant-1",
  role: "assistant",
  author: DEFAULT_CHAT_STRINGS.host.assistantAuthor,
  time: "09:41",
  text:
    "There is 281 MW of headroom on this grid. Consumption is 439 MW against a capacity of 720 MW.",
};

export function chatDemoModel(state: ChatDemoState = "ready"): ChatViewModel {
  const offline = state === "offline";
  const streaming = state === "streaming";

  const messages: ChatMessage[] =
    state === "empty" || state === "loading"
      ? []
      : streaming
        ? [operator, { ...assistant, text: "There is 281 MW of headroom on this grid." }]
        : offline
          ? [operator, { ...assistant, status: DEFAULT_CHAT_STRINGS.host.messageStatus.stopped }]
          : [operator, assistant];

  return {
    connected: !offline,
    sending: state === "sending",
    streaming,
    history:
      state === "loading"
        ? "loading"
        : state === "empty"
          ? "empty"
          : offline
            ? "unavailable"
            : "ready",
    messages,
    draft: "",
    backKey: "Esc",
    error:
      state === "error"
        ? { text: DEFAULT_CHAT_STRINGS.host.turnFailed, canRetry: true }
        : offline
          ? { text: DEFAULT_CHAT_STRINGS.host.sidecarUnavailable, canRetry: false }
          : null,
    rateLimit: null,
    context: [
      { label: "Generation", value: reading(576) },
      { label: "Consumption", value: reading(439) },
      { label: "Active lines", value: "12 / 12" },
    ],
    assistant: [{ label: "Connection", value: offline ? "Offline" : "Linked" }],
  };
}

export const CHAT_DEMO_STATES: readonly ChatDemoState[] = [
  "ready",
  "empty",
  "loading",
  "streaming",
  "sending",
  "error",
  "offline",
] as const;
