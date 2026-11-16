import type { MetricValue } from "@ficsitai/screens-api";

/**
 * Типы экрана «Чат с ИИ» (V-6, D-1 §3).
 *
 * Разделение зон (ADR-032, Co2-48 и ответ Gs2-25):
 * - представление `mountChat` — зона Gs2, чистая функция от свойств: не ходит
 *   в фасад, не хранит состояние между вызовами `update` и не придумывает слов;
 * - экран `web/screens/chat/` — зона Co2: владеет состоянием, зовёт фасад,
 *   локализует всё, что попадает в модель, и отдаёт представлению готовое.
 *
 * Отсюда две группы строк: {@link ChatViewCopy} уходит в представление как
 * `copy`, {@link ChatHostStrings} остаётся у экрана и нужен, чтобы заполнить
 * поля модели, которые представление получает уже локализованными
 * (`messages[].status`, `error.text`, `rateLimit`, `messages[].time`).
 */

/** Состояние истории разговора. Пустая история и недоступная — разные вещи. */
export type ChatHistoryState = "loading" | "ready" | "empty" | "unavailable";

/** Кто говорит. Роли протокола чата, не роли команды. */
export type ChatRole = "operator" | "assistant";

export interface ChatMessage {
  /** Стабильный идентификатор: поток дописывает то же сообщение. */
  id: string;
  role: ChatRole;
  /** Подпись автора — её даёт экран, представление не склоняет и не переводит. */
  author: string;
  /** Отметка времени, уже отформатированная экраном ({@link ChatHostStrings.messageTime}). */
  time: string;
  /**
   * Та же отметка машиночитаемо — уходит в атрибут `datetime` элемента
   * `<time>` (компонент `chatMessage` в D-2). Без неё разметка показывает
   * время, но не говорит его программе чтения с экрана.
   */
  dateTime?: string;
  text: string;
  /**
   * Пометка состояния сообщения, уже локализованная: «Остановлено», «Ошибка».
   * Пустая строка и отсутствие поля значат одно — пометки нет.
   */
  status?: string;
}

/** Строка боковой панели. Значение — либо готовый текст, либо чтение метрики. */
export interface ChatPanelItem {
  label: string;
  value: string | MetricValue;
}

export interface ChatError {
  /** Текст для игрока, уже локализованный экраном. */
  text: string;
  /**
   * Повтор доступен только при связи с сайдкаром. Повтора в API нет:
   * это новый `chat.send` с тем же текстом и новым `turnId` (Co2-48 §3).
   */
  canRetry: boolean;
}

/**
 * Свойства, которые экран передаёт в `update`. Всё, что видит игрок, приходит
 * отсюда: представление ничего не достраивает.
 */
export interface ChatViewModel {
  /** Есть связь с сайдкаром. При `false` показывается офлайн-состояние. */
  connected: boolean;
  /**
   * Запрос отправлен, идентификатор хода ещё не получен. Экран ставит флаг
   * в обработчике `send` и снимает его при ответе или ошибке (Gs2-25),
   * чтобы повторный Enter не отправил второй ход.
   */
  sending?: boolean;
  /** Идёт поток ответа: видна кнопка Stop, Back тоже отменяет показ. */
  streaming: boolean;
  history: ChatHistoryState;
  /** История в порядке показа. При разрыве связи уже показанные остаются. */
  messages: ChatMessage[];
  /** Черновик поля ввода. Экран хранит его отдельно от истории. */
  draft: string;
  /** Текущая привязка действия Back — её показывает подсказка потока. */
  backKey: string;
  error?: ChatError | null;
  /** Сообщение о пределе частоты, уже локализованное. */
  rateLimit?: string | null;
  context?: ChatPanelItem[];
  workOrders?: ChatPanelItem[];
  assistant?: ChatPanelItem[];
}

/**
 * Обработчики представления. Каждый — событие к экрану, а не действие:
 * представление не меняет себя само, оно дожидается нового `update`.
 */
export interface ChatActions {
  /** Изменение поля ввода, включая подстановку шаблона. */
  draft(text: string): void;
  /** Кнопка Send и Enter. */
  send(text: string): void;
  /**
   * Кнопка Stop и `handleBackAction()` во время потока. Отмена в протоколе —
   * «перестать показывать», а не «остановить ход»: Foreman дочитывает ход,
   * и ответ окажется в истории при следующем чтении (Co2-48 §3).
   */
  stop(): void;
  /** Доступен при `connected` и `error.canRetry`. */
  retry(): void;
}

/** Форматтер D-2: его даёт хост, локаль и подписи единиц живут в нём. */
export interface ChatPresenter {
  number(value: number, digits: number): string;
  parts(reading: MetricValue | null | undefined): { amount: string; unit: string };
  reading(reading: MetricValue | null | undefined): string;
}

export interface ChatViewOptions {
  presenter: ChatPresenter;
  copy: ChatViewCopy;
  actions: ChatActions;
}

export interface ChatViewHandle {
  update(model: ChatViewModel): void;
  /**
   * Хост отдаёт сюда действие Back. `true` — представление забрало его себе
   * (шла выдача, показ остановлен), `false` — хост продолжает по правилам D-1.
   */
  handleBackAction(): boolean;
  unmount(): void;
}

/** Подпись `mountChat` из `web/ui-kit/screens/chat.js` (зона Gs2). */
export type MountChat = (root: HTMLElement, options: ChatViewOptions) => ChatViewHandle;

export interface ChatHistoryStateCopy {
  label: string;
  detail?: string;
}

export interface ChatPromptTemplate {
  label: string;
  /** Текст, который подставляется в поле ввода; отправляет игрок. */
  text: string;
}

/**
 * Строки представления — то, что уходит в `mountChat` как `copy`.
 * Набор ключей заморожен: отсутствующий ключ должен ловиться сборкой,
 * а не прочерком на экране (Co2-48 §2).
 */
export interface ChatViewCopy {
  /** Заголовок ленты разговора. */
  history: string;
  historyStates: {
    loading: ChatHistoryStateCopy;
    empty: ChatHistoryStateCopy;
    unavailable: ChatHistoryStateCopy;
  };
  /** Заголовок офлайн-состояния: сайдкар не подключён. */
  offlineTitle: string;
  offlineDetail: string;
  /** Что продолжает работать без сайдкара (FR-10). */
  offlineScope: string;
  /** Подсказка во время потока; получает текущую привязку Back. */
  streaming: (backKey: string) => string;
  /** Запрос отправлен, ход ещё не начался. */
  sending: string;
  stop: string;
  retry: string;
  draftLabel: string;
  send: string;
  sendHint: string;
  prompts: ChatPromptTemplate[];
  promptHint: string;
  /** Метки боковых панелей. */
  context: string;
  workOrders: string;
  assistant: string;
}

/**
 * Строки экрана. В представление не уходят: ими экран заполняет поля модели,
 * которые представление получает готовыми.
 */
export interface ChatHostStrings {
  /** Подпись ассистента в истории. */
  assistantAuthor: string;
  /** Подпись игрока в истории. */
  operatorAuthor: string;
  /** Отметка времени сообщения. */
  messageTime: (at: Date) => string;
  messageStatus: {
    /** Показ остановлен игроком; ход у Foreman мог дойти до конца. */
    stopped: string;
    failed: string;
    /** Ассистент вызвал инструмент: аргументов в событии нет, только имя. */
    tool: (name: string) => string;
  };
  /** Ход не состоялся — текст для `error.text`. */
  turnFailed: string;
  /** Сайдкар не отвечает на запрос чата. */
  sidecarUnavailable: string;
  /** Версия API экрана и мода разошлись; получает описание из `apiVersionMismatch`. */
  apiVersionMismatch: (detail: string) => string;
  /** Мод в инертном режиме; получает причину из состояния. */
  inert: (reason: string) => string;
  /** Предел частоты; получает число секунд до следующей попытки. */
  rateLimited: (retryAfterSec: number) => string;
}

/**
 * Полный набор строк экрана чата: `view` уходит представлению, `host`
 * остаётся у экрана. Один объект, чтобы у чата был один источник слов.
 */
export interface ChatStrings {
  locale: string;
  view: ChatViewCopy;
  host: ChatHostStrings;
}
