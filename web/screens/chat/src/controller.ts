import type { ApiStatus, FicsitAIApi } from "@ficsitai/screens-api";
import { ApiError } from "@ficsitai/screens-api";
import { DEFAULT_CHAT_STRINGS } from "./strings.js";
import type {
  ChatActions,
  ChatError,
  ChatHistoryState,
  ChatMessage,
  ChatPanelItem,
  ChatPresenter,
  ChatStrings,
  ChatViewHandle,
  ChatViewModel,
  MountChat,
} from "./types.js";

/**
 * Контроллер экрана «Чат с ИИ» (V-6, [#23](https://github.com/kkkingqz/ficsit-ai-helper/issues/23)).
 *
 * Он владеет состоянием и зовёт фасад; представление Gs2 — чистая функция от
 * свойств (ADR-032, Co2-48). Отсюда три правила, которые видно в коде:
 *
 * - **представление ничего не решает.** Каждый его обработчик приходит сюда,
 *   каждое изменение уходит обратно целым `ChatViewModel`;
 * - **экран не придумывает ответов.** Текст приходит событиями `chat.*`, и
 *   если их нет, в ленте не появляется ничего — ни заглушки, ни «думаю»;
 * - **слова живут в одном месте.** Всё, что видит игрок, берётся из
 *   {@link ChatStrings}: представление получает `view`, а поля модели,
 *   которые оно показывает готовыми, заполняются из `host`.
 *
 * Семантика хода — из контракта, и она не та, которую подсказывает интуиция:
 * отмена останавливает показ, а Foreman дочитывает ход и кладёт ответ в
 * историю. Поэтому после отмены контроллер перечитывает историю — но не
 * перед отправкой, а после принятия следующего хода: раньше Foreman ещё
 * пишет, и перечитанная история вернула бы тот же обрубок. Номер нового
 * хода мод называет только после того, как прежний допишется, и это
 * единственный рубеж, на котором история полна (ревью Gs на #62).
 */

export interface ChatControllerOptions {
  api: FicsitAIApi;
  /** Готовое представление; либо `mountView` плюс `root`. */
  view?: ChatViewHandle;
  mountView?: MountChat;
  root?: HTMLElement;
  presenter?: ChatPresenter;
  strings?: ChatStrings;
  /** Сколько сообщений просить у истории (1–100 по контракту). */
  historyLimit?: number;
  /** Текущая привязка действия Back — её показывает подсказка потока. */
  backKey?: string;
  /** Часы экрана. Подменяются в проверках, чтобы отметки времени не плыли. */
  now?: () => Date;
}

export interface ChatController {
  /** Текущая модель — то же, что ушло в представление последним `update`. */
  getModel(): ChatViewModel;
  readonly actions: ChatActions;
  /** Перечитывает историю у мода (после отмены там появляется дочитанный ход). */
  refreshHistory(): Promise<void>;
  /** Снимает подписки и представление. */
  destroy(): void;
}

/** Код, после которого повторять тот же ход бессмысленно. */
const FINAL_CODES: ReadonlySet<string> = new Set([
  "MOD_INERT",
  "API_VERSION_MISMATCH",
  "INVALID_ARGUMENT",
]);

export function createChatController(options: ChatControllerOptions): ChatController {
  const api = options.api;
  const strings = options.strings ?? DEFAULT_CHAT_STRINGS;
  const host = strings.host;
  const now = options.now ?? (() => new Date());
  const historyLimit = options.historyLimit ?? 50;

  let connected = false;
  let assistantModel = "";
  let history: ChatHistoryState = "loading";
  let messages: ChatMessage[] = [];
  let draft = "";
  let sending = false;
  let streaming = false;
  let turnId: string | null = null;
  /**
   * Последний отправленный текст — для повтора. Запоминается до ответа мода:
   * повторяют обычно как раз тот ход, который не состоялся, и помнить только
   * удачные значило бы, что кнопка Retry после отказа ничего не делает.
   */
  let lastAttempt = "";
  let error: ChatError | null = null;
  let rateLimit: string | null = null;
  /** Ход отменён — историю надо перечитать, там окажется дочитанный ответ. */
  let historyStale = false;
  let destroyed = false;
  /** Отправка в полёте: мод ещё не назвал номер хода, а события уже идут. */
  let awaitingTurn = false;
  /**
   * События хода, пришедшие раньше его номера.
   *
   * Ответ на `chatSend` и поток событий идут разными соединениями, и на HTTP
   * первый кусок обгоняет ответ на отправку. Отбрасывать такие события
   * нельзя: экран показал бы пустое сообщение и остался бы «в потоке»
   * навсегда (ревью Gs на #62, P2-3).
   */
  const buffered: { turnId: string; terminal: boolean; apply: () => void }[] = [];

  const unsubscribes: (() => void)[] = [];
  let view: ChatViewHandle | undefined = options.view;

  const message = (
    id: string,
    role: ChatMessage["role"],
    text: string,
    at: Date,
    status?: string,
  ): ChatMessage => ({
    id,
    role,
    author: role === "assistant" ? host.assistantAuthor : host.operatorAuthor,
    time: host.messageTime(at),
    dateTime: at.toISOString(),
    text,
    ...(status === undefined ? {} : { status }),
  });

  const assistantPanel = (): ChatPanelItem[] | undefined => {
    if (!connected && assistantModel === "") return undefined;
    const items: ChatPanelItem[] = [
      { label: "Connection", value: connected ? "Linked" : "Offline" },
    ];
    if (assistantModel !== "") items.push({ label: "Model", value: assistantModel });
    return items;
  };

  const model = (): ChatViewModel => {
    const panel = assistantPanel();
    return {
      connected,
      sending,
      streaming,
      history,
      messages,
      draft,
      backKey: options.backKey ?? "Esc",
      error,
      rateLimit,
      ...(panel === undefined ? {} : { assistant: panel }),
    };
  };

  const render = (): void => {
    if (destroyed) return;
    view?.update(model());
  };

  /** Текст ошибки для игрока: код контракта в слова экрана. */
  const describe = (err: unknown): { text: string; canRetry: boolean; rateLimited: boolean } => {
    if (err instanceof ApiError) {
      if (err.code === "SIDECAR_UNAVAILABLE" || err.code === "TRANSPORT_UNAVAILABLE") {
        return { text: host.sidecarUnavailable, canRetry: false, rateLimited: false };
      }
      if (err.code === "RATE_LIMITED") {
        const retryAfter = Number(err.details?.["retryAfterSec"] ?? 0);
        return {
          text: host.rateLimited(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 1),
          canRetry: true,
          rateLimited: true,
        };
      }
      if (err.code === "API_VERSION_MISMATCH") {
        return { text: host.apiVersionMismatch(err.message), canRetry: false, rateLimited: false };
      }
      if (err.code === "MOD_INERT") {
        return { text: host.inert(err.message), canRetry: false, rateLimited: false };
      }
      return { text: host.turnFailed, canRetry: !FINAL_CODES.has(err.code), rateLimited: false };
    }
    return { text: host.turnFailed, canRetry: true, rateLimited: false };
  };

  const fail = (err: unknown): void => {
    const described = describe(err);
    error = { text: described.text, canRetry: described.canRetry && connected };
    rateLimit = described.rateLimited ? described.text : null;
  };

  const applyStatus = (status: Partial<ApiStatus>): void => {
    const wasConnected = connected;
    if (typeof status.sidecarConnected === "boolean") connected = status.sidecarConnected;
    if (status.assistantState === "unavailable") connected = false;
    if (typeof status.assistantModel === "string") assistantModel = status.assistantModel;

    if (wasConnected && !connected && (streaming || sending)) {
      // Связь пропала посреди хода. Уже показанные сообщения остаются — это
      // прямое требование к экрану (Gs2-25): исчезнувшая лента выглядит как
      // потерянный разговор, хотя он цел в истории.
      streaming = false;
      sending = false;
      turnId = null;
      historyStale = true;
      error = { text: host.sidecarUnavailable, canRetry: false };
    }
  };

  /**
   * Перечитывает историю и делает её лентой.
   *
   * Живой ход при этом не теряется и не удваивается: его сообщения опознаются
   * по **своим** идентификаторам (`${turnId}-ask` и `turnId`) — их ставим мы,
   * и путать их с записями мода не на чем. Всё остальное приходит из снимка.
   */
  const loadHistory = async (): Promise<void> => {
    try {
      const page = await api.chatHistory({ limit: historyLimit });
      const shown = messages;
      if (page.messages.length === 0 && shown.length > 0) {
        // Пустой снимок не стирает показанное: разговор у мода есть — мы его
        // только что видели, — и такой ответ говорит о сбое на той стороне, а
        // не о пустой истории. Лента остаётся, и пометка «перечитать» тоже.
        return;
      }
      // Живой ход опознаётся по **своим** идентификаторам: их ставим мы, и
      // спутать их с записями мода не на чем. Остальное приходит из снимка.
      const live =
        turnId === null
          ? []
          : shown.filter((item) => item.id === `${turnId}-ask` || item.id === turnId);
      const stored = page.messages.map((entry) => {
        const at = new Date(entry.createdAt);
        return message(
          entry.id,
          entry.role === "assistant" ? "assistant" : "operator",
          entry.text,
          Number.isNaN(at.getTime()) ? now() : at,
        );
      });
      messages = [...stored, ...live];
      history = messages.length === 0 ? "empty" : "ready";
      historyStale = false;
    } catch (err: unknown) {
      // Недоступная история и пустая — разные вещи, и путать их нельзя:
      // «сообщений ещё нет» о потерянной связи соврало бы игроку.
      history = "unavailable";
      if (err instanceof ApiError && err.code === "SIDECAR_UNAVAILABLE") connected = false;
    }
  };

  /**
   * Пропускает событие хода.
   *
   * Своё — применяем и перерисовываем. Раннее (номер хода ещё не известен) —
   * складываем до присвоения. Чужое — молча мимо: ход у сохранения один, и
   * событие с другим номером относится к уже закрытому ходу.
   */
  const gate = (incomingTurn: string, apply: () => void, terminal = false): void => {
    if (turnId !== null && incomingTurn === turnId) {
      apply();
      render();
      return;
    }
    if (awaitingTurn) buffered.push({ turnId: incomingTurn, terminal, apply });
  };

  /** Применяет события, дождавшиеся номера хода, в порядке прихода. */
  const flushBuffered = (): void => {
    const early = buffered.splice(0, buffered.length);
    for (const item of early) if (item.turnId === turnId) item.apply();
  };

  const start = async (): Promise<void> => {
    try {
      const status = await api.getStatus();
      applyStatus(status);
    } catch (err: unknown) {
      connected = false;
      fail(err);
    }

    unsubscribes.push(api.on("api.status", (data) => {
      applyStatus(data as Partial<ApiStatus>);
      render();
    }));
    unsubscribes.push(api.on("chat.text", (data) => {
      gate(data.turnId, () => appendToTurn(data.text));
    }));
    unsubscribes.push(api.on("chat.tool", (data) => {
      gate(data.turnId, () => setTurnStatus(host.messageStatus.tool(data.name)));
    }));
    unsubscribes.push(api.on("chat.done", (data) => {
      gate(
        data.turnId,
        () => {
          if (data.model !== "") assistantModel = data.model;
          setTurnStatus(undefined);
          streaming = false;
          turnId = null;
          // Ход закончен, живого хода больше нет — и только теперь снимок
          // истории можно делать лентой целиком, ничего не смешивая. Читаем
          // не после каждого хода, а когда ждёт дочитанный ответ отменённого:
          // ради него перечитывание и нужно (Co-133).
          if (historyStale) void refreshHistory();
        },
        true,
      );
    }));
    unsubscribes.push(api.on("chat.failed", (data) => {
      gate(
        data.turnId,
        () => {
          setTurnStatus(host.messageStatus.failed);
          streaming = false;
          turnId = null;
          fail(new ApiError({ code: data.code, message: data.message }));
        },
        true,
      );
    }));
    unsubscribes.push(api.on("chat.cancelled", (data) => {
      gate(
        data.turnId,
        () => {
          setTurnStatus(host.messageStatus.stopped);
          streaming = false;
          turnId = null;
          // Ход продолжается у Foreman, и его ответ ляжет в историю. Пометить
          // историю устаревшей — единственный способ не соврать игроку позже.
          historyStale = true;
        },
        true,
      );
    }));

    await loadHistory();
    render();
  };

  const turnMessage = (): ChatMessage | undefined =>
    turnId === null ? undefined : messages.find((entry) => entry.id === turnId);

  const appendToTurn = (chunk: string): void => {
    const existing = turnMessage();
    if (existing === undefined) return;
    messages = messages.map((entry) =>
      entry.id === existing.id ? { ...entry, text: entry.text + chunk } : entry,
    );
  };

  const setTurnStatus = (status: string | undefined): void => {
    const existing = turnMessage();
    if (existing === undefined) return;
    messages = messages.map((entry) => {
      if (entry.id !== existing.id) return entry;
      const next = { ...entry };
      if (status === undefined) delete next.status;
      else next.status = status;
      return next;
    });
  };

  const send = async (text: string): Promise<void> => {
    const trimmed = text.trim();
    if (destroyed || trimmed === "") return;
    if (sending || streaming) return;
    if (!connected) {
      error = { text: host.sidecarUnavailable, canRetry: false };
      render();
      return;
    }

    // Замок ставится до первого `await`. Между проверкой выше и ответом мода
    // есть ожидание — после отмены до 30 с, пока прежний ход дописывается, —
    // и два Enter подряд уходили двумя ходами: второй получал
    // `TURN_IN_PROGRESS` и сбивал первый, уже принятый (ревью Gs на #62).
    sending = true;
    error = null;
    rateLimit = null;
    lastAttempt = trimmed;
    awaitingTurn = true;
    buffered.length = 0;
    render();

    // Историю здесь не читаем вовсе, и это третья попытка — зато первая, в
    // которой два источника не смешиваются. Сначала я читал её до отправки
    // (Foreman ещё дописывал отменённый ход — в ленте оставался обрубок),
    // потом на рубеже принятия (снимок уже мог содержать весь новый ход —
    // то удваивался вопрос, то ответ, то терялся полученный текст). Причина
    // одна и та же: живой ход приходит событиями, снимок — записями без
    // номеров, и соединять их приходилось по тексту.
    //
    // Больше не соединяются. Пока ход идёт, его показывают только события;
    // снимок становится лентой после `chat.done`, когда смешивать уже
    // нечего, и дочитанный ответ отменённого хода приезжает тем же чтением
    // (ревью Gs на #62).
    try {
      const sent = await api.chatSend({ text: trimmed });
      draft = "";
      turnId = sent.turnId;
      const at = now();
      messages = [
        ...messages,
        message(`${sent.turnId}-ask`, "operator", trimmed, at),
        message(sent.turnId, "assistant", "", at),
      ];
      history = "ready";
      sending = false;
      streaming = true;
      // Куски, обогнавшие ответ на отправку, применяем сразу — иначе
      // сообщение осталось бы пустым, а поток незакрытым.
      flushBuffered();
    } catch (err: unknown) {
      // `turnId` здесь не присваивался, и чужой стирать нельзя: после Stop
      // он ещё хранит отменённый ход, которому придёт `chat.cancelled`.
      sending = false;
      fail(err);
    } finally {
      awaitingTurn = false;
      buffered.length = 0;
    }
    render();
  };

  const refreshHistory = async (): Promise<void> => {
    await loadHistory();
    render();
  };

  const actions: ChatActions = {
    draft(text: string): void {
      // Черновик хранится, но перерисовки не вызывает: поле ввода уже знает
      // свой текст, а новый `update` на каждую клавишу забирал бы курсор.
      draft = text;
    },

    send(text: string): void {
      void send(text);
    },

    stop(): void {
      const current = turnId;
      if (current === null) return;
      void api
        .chatCancel({ turnId: current })
        .then(() => {
          // Событие `chat.cancelled` придёт следом и пометит сообщение;
          // здесь только снимаем поток, чтобы кнопка не ждала сети.
          streaming = false;
          render();
        })
        .catch((err: unknown) => {
          if (err instanceof ApiError && (err.code === "NO_TURN" || err.code === "TURN_MISMATCH")) {
            // Хода уже нет: экран отстал от мода, а не сломался.
            streaming = false;
            turnId = null;
            historyStale = true;
            render();
            return;
          }
          fail(err);
          render();
        });
    },

    retry(): void {
      if (lastAttempt === "") return;
      error = null;
      // Повтора в API нет: это новый ход с тем же текстом и новым turnId,
      // а прежний остаётся в истории (Co2-48 §3).
      void send(lastAttempt);
    },
  };

  if (view === undefined && options.mountView !== undefined && options.root !== undefined) {
    view = options.mountView(options.root, {
      presenter: options.presenter ?? fallbackPresenter(strings.locale),
      copy: strings.view,
      actions,
    });
  }

  render();
  void start();

  return {
    getModel: model,
    actions,
    refreshHistory,
    destroy(): void {
      destroyed = true;
      for (const off of unsubscribes) off();
      unsubscribes.length = 0;
      view?.unmount();
      view = undefined;
    },
  };
}

/**
 * Форматтер на случай, когда хост его не дал.
 *
 * Это не вторая дизайн-система: он только форматирует числа по локали и
 * ничего не решает о виде. Настоящий приходит из D-2 вместе с подписями
 * единиц, и в игре используется именно он.
 */
export function fallbackPresenter(locale: string): ChatPresenter {
  const format = (value: number, digits: number): string =>
    new Intl.NumberFormat(locale, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value);

  const parts = (reading: Parameters<ChatPresenter["parts"]>[0]): { amount: string; unit: string } =>
    reading === null || reading === undefined || reading.value === null
      ? { amount: "—", unit: "" }
      : { amount: format(reading.value, reading.precisionDigits), unit: "" };

  return {
    number: format,
    parts,
    reading: (reading) => parts(reading).amount,
  };
}
