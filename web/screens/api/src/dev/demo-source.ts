import { SourceError, type DevSource } from "./source.js";
import { API_VERSION } from "../types.js";
import type {
  ChatCancelArgs,
  ChatCancelResult,
  ChatHistoryArgs,
  ChatHistoryResult,
  ChatMessage,
  ChatSendArgs,
  ChatSendResult,
  ListMetricsArgs,
  ListMetricsResult,
  ListScopesArgs,
  ListScopesResult,
  MetricDescriptor,
  MetricSeries,
  MetricValue,
  QueryMetricArgs,
  QuerySeriesArgs,
  ScopeRef,
  SeriesWindow,
} from "../types.js";

/**
 * Временный источник dev-сервера: чтобы страницу можно было открыть сегодня.
 *
 * **Это не наборы Fixture.** Наборы — работа Gf2 (пустая и большая фабрика,
 * сайдкар недоступен, инертный режим, нет питания), и подменять их здесь
 * нельзя: разойдутся две правды о том, что значит «пустая фабрика».
 * Здесь ровно столько, сколько нужно проверить сам фасад: значение,
 * неприменимое значение, ряд с пропуском, области с пагинацией и все коды
 * ошибок контракта.
 *
 * Как только наборы появятся, этот источник остаётся только для самопроверки
 * сервера, а экраны берут Fixture.
 */

const SESSION_START = 1800;

const METRICS: MetricDescriptor[] = [
  {
    id: "power.production",
    displayName: "Total Power Production",
    unit: "megawatt",
    scope: "factory",
    hasSeries: true,
    costClass: "normal",
    sampleIntervalSec: 5,
    external: false,
    availableScopes: [],
    scopesTruncated: false,
  },
  {
    id: "power.consumption",
    displayName: "Total Power Consumption",
    unit: "megawatt",
    scope: "factory",
    hasSeries: true,
    costClass: "normal",
    sampleIntervalSec: 5,
    external: false,
    availableScopes: [],
    scopesTruncated: false,
  },
  {
    id: "power.network.battery_time_to_empty",
    displayName: "Network Battery Time To Empty",
    unit: "seconds",
    scope: "powerNetwork",
    hasSeries: false,
    costClass: "cheap",
    sampleIntervalSec: 5,
    external: false,
    availableScopes: [],
    scopesTruncated: false,
  },
  {
    id: "items.produced",
    displayName: "Items Produced",
    unit: "itemsPerMinute",
    scope: "item",
    hasSeries: true,
    costClass: "heavy",
    sampleIntervalSec: 15,
    external: false,
    availableScopes: [],
    scopesTruncated: false,
  },
];

const NETWORKS: ScopeRef[] = [
  { scopeId: "1", displayName: "Power Circuit 1" },
  { scopeId: "2", displayName: "Power Circuit 2" },
];

/** 60 предметов: хватает, чтобы потолок в 50 областей был виден. */
const ITEMS: ScopeRef[] = Array.from({ length: 60 }, (_unused, index) => ({
  scopeId: `Desc_Item${index + 1}_C`,
  displayName: `Item ${index + 1}`,
}));

const MAX_INLINE_SCOPES = 50;

/**
 * Демонстрационный ассистент: отвечает заранее известным текстом по частям,
 * чтобы экран чата можно было отлаживать в браузере.
 *
 * Он ничего не знает про фабрику и не выдаёт себя за ассистента: модель
 * называется `demo-echo`, а текст ответа собирается из вопроса. Ценность здесь
 * в поведении хода, а не в словах: один ход на источник, отмена останавливает
 * показ, но ответ всё равно ложится в историю — ровно та семантика, о которую
 * спотыкается экран.
 */
const CHAT_MODEL = "demo-echo";
const CHAT_CHUNK_MS = 200;
const CHAT_HISTORY_DEFAULT = 50;
const CHAT_HISTORY_MAX = 100;

/** Окна ряда из контракта: другое значение — `INVALID_ARGUMENT`. */
const WINDOWS: ReadonlySet<string> = new Set<SeriesWindow>(["last5Min", "last15Min", "last60Min"]);

function scopesOf(metricId: string): ScopeRef[] {
  if (metricId.startsWith("power.network.")) return NETWORKS;
  if (metricId.startsWith("items.")) return ITEMS;
  return [];
}

function definitionOf(metricId: string): MetricDescriptor {
  const found = METRICS.find((metric) => metric.id === metricId);
  if (found === undefined) {
    throw new SourceError("UNKNOWN_METRIC", `метрики «${metricId}» нет в каталоге`, { metricId });
  }
  return found;
}

function cursorOffset(cursor: string | undefined, kind: "m" | "s"): number {
  if (cursor === undefined || cursor === "") return 0;
  const match = /^([ms]):(\d+)$/.exec(cursor);
  if (match === null) {
    throw new SourceError("INVALID_ARGUMENT", "курсор не разобран");
  }
  if (match[1] !== kind) {
    // Курсор метрик вместо курсора областей — отказ, а не пустая страница:
    // пустая выглядела бы как «областей больше нет» (Gs-8.1).
    throw new SourceError("INVALID_ARGUMENT", "курсор не того вида");
  }
  return Number.parseInt(match[2] as string, 10);
}

function normalizePageSize(pageSize: number | undefined): number {
  if (pageSize === undefined) return 50;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 200) {
    throw new SourceError("INVALID_ARGUMENT", "pageSize вне границ 1…200");
  }
  return pageSize;
}

/**
 * Области метрики с учётом `scopeFilter`. Фильтр применяется до выбора
 * страницы: иначе `listMetrics` отдавал полную страницу областей даже на
 * фильтр, которому не подходит ни одна (повторное ревью Gs на #53).
 */
function matchingScopes(metricId: string, filter?: string): ScopeRef[] {
  const all = scopesOf(metricId);
  const needle = filter?.trim().toLowerCase();
  if (needle === undefined || needle === "") return all;
  return all.filter(
    (scope) =>
      scope.displayName.toLowerCase().includes(needle) ||
      scope.scopeId.toLowerCase().includes(needle),
  );
}

/**
 * Проверка области — одна на `queryMetric` и `querySeries`. Раньше ряд
 * выдавался и без `scopeId`, и с несуществующим: браузерная отладка
 * пропускала то, что живой API отклоняет (повторное ревью Gs на #53).
 */
function requireScope(metric: MetricDescriptor, scopeId: string | undefined): void {
  const scopes = scopesOf(metric.id);
  const given = scopeId !== undefined && scopeId !== "";
  // Фабричной метрике область не нужна, но выдуманную она принимать не
  // должна: ранний выход «областей нет — всё можно» пропускал любой
  // `scopeId` и возвращал его в ответе (третий круг ревью Gs на #53).
  if (scopes.length > 0 && !given) {
    throw new SourceError("SCOPE_REQUIRED", `метрике «${metric.id}» нужен scopeId`);
  }
  if (given && !scopes.some((scope) => scope.scopeId === scopeId)) {
    throw new SourceError("SCOPE_NOT_FOUND", `область «${scopeId as string}» неизвестна`);
  }
}

function withScopes(metric: MetricDescriptor, offset = 0, all = scopesOf(metric.id)): MetricDescriptor {
  const page = all.slice(offset, offset + MAX_INLINE_SCOPES);
  return {
    ...metric,
    availableScopes: page,
    scopesTruncated: offset + page.length < all.length,
  };
}

export interface DemoSourceOptions {
  /**
   * Пауза между кусками ответа. По умолчанию такая, чтобы на экране было
   * видно, как ответ пишется; проверкам нужна маленькая, иначе они ждут
   * демонстрацию вместо того, чтобы её проверять.
   */
  chatChunkMs?: number;
}

export function createDemoSource(options: DemoSourceOptions = {}): DevSource {
  const chunkMs = options.chatChunkMs ?? CHAT_CHUNK_MS;
  let tick = 0;

  /** Куда уходят события. Пока на поток никто не подписан — некуда. */
  let emitEvent: ((event: string, data: unknown) => void) | null = null;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const history: ChatMessage[] = [];
  let turnSeq = 0;
  /** Текущий ход. `cancelled` — показ остановлен, но ход ещё дочитывается. */
  let turn: { id: string; cancelled: boolean } | null = null;

  const emit = (event: string, data: unknown): void => {
    emitEvent?.(event, data);
  };

  const later = (ms: number, run: () => void): void => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      run();
    }, ms);
    timers.add(timer);
  };

  const answerFor = (question: string): string =>
    `Демонстрационный ответ dev-сервера. Вопрос принят: «${question.trim()}». ` +
    `Настоящие числа придут из мода: выработка 412.5 МВт, потребление 388.1 МВт.`;

  return {
    name: "demo",

    getStatus() {
      return {
        apiVersion: API_VERSION,
        saveId: "demo-save",
        source: "fixture",
        inert: false,
        lastSnapshotSessionTimeSec: SESSION_START + tick * 5,
        // Ассистент здесь есть — демонстрационный, но запросы чата он
        // обслуживает, поэтому экран видит связь, а не офлайн.
        sidecarConnected: true,
        apiVersionMismatch: "",
        reason: "демонстрационный источник dev-сервера",
        assistantState: "ready",
        assistantModel: CHAT_MODEL,
      };
    },

    listMetrics(args: ListMetricsArgs): ListMetricsResult {
      const pageSize = normalizePageSize(args.pageSize);
      const hasMetricId = args.metricId !== undefined && args.metricId !== "";
      if (!hasMetricId && (args.scopeFilter !== undefined || args.scopeCursor !== undefined)) {
        throw new SourceError(
          "INVALID_ARGUMENT",
          "scopeFilter и scopeCursor допустимы только вместе с metricId",
        );
      }

      if (hasMetricId) {
        const metric = definitionOf(args.metricId as string);
        const offset = cursorOffset(args.scopeCursor, "s");
        const all = matchingScopes(metric.id, args.scopeFilter);
        const descriptor = withScopes(metric, offset, all);
        const nextOffset = offset + descriptor.availableScopes.length;
        return {
          metrics: [descriptor],
          nextCursor: "",
          nextScopeCursor: nextOffset < all.length ? `s:${nextOffset}` : "",
        };
      }

      const needle = args.filter?.trim().toLowerCase();
      const matching = METRICS.filter((metric) => {
        if (args.scope !== undefined && metric.scope !== args.scope) return false;
        if (needle === undefined || needle === "") return true;
        return (
          metric.id.toLowerCase().includes(needle) ||
          metric.displayName.toLowerCase().includes(needle)
        );
      });

      const offset = cursorOffset(args.cursor, "m");
      const page = matching.slice(offset, offset + pageSize);
      const nextOffset = offset + page.length;
      return {
        metrics: page.map((metric) => withScopes(metric)),
        nextCursor: nextOffset < matching.length ? `m:${nextOffset}` : "",
      };
    },

    listScopes(args: ListScopesArgs): ListScopesResult {
      const metric = definitionOf(args.metricId);
      const pageSize = normalizePageSize(args.pageSize);
      const offset = cursorOffset(args.cursor, "s");
      const all = matchingScopes(metric.id, args.scopeFilter);
      const page = all.slice(offset, offset + pageSize);
      const nextOffset = offset + page.length;
      return { scopes: page, nextCursor: nextOffset < all.length ? `s:${nextOffset}` : "" };
    },

    queryMetric(args: QueryMetricArgs): MetricValue {
      const metric = definitionOf(args.metricId);
      requireScope(metric, args.scopeId);

      const base: Omit<MetricValue, "state" | "value"> = {
        kind: "value",
        metricId: metric.id,
        scopeId: args.scopeId ?? "",
        unit: metric.unit,
        source: "fixture",
        sessionTimeSec: SESSION_START + tick * 5,
        precisionDigits: metric.unit === "seconds" ? 0 : 1,
      };

      // Сеть 2 без батарей: времени до разряда нет по смыслу, а не по ошибке.
      if (metric.id === "power.network.battery_time_to_empty" && args.scopeId === "2") {
        return { ...base, state: "notApplicable", value: null };
      }

      const value =
        metric.id === "power.production"
          ? 412.5
          : metric.id === "power.consumption"
            ? 388.1
            : metric.id === "items.produced"
              ? 120
              : 900;
      return { ...base, state: "value", value };
    },

    querySeries(args: QuerySeriesArgs): MetricSeries {
      // Недопустимое окно раньше возвращалось в успешном ответе как есть, и
      // браузерная отладка пропускала то, что игровой API отклоняет
      // (ревью Gs на #53).
      if (!WINDOWS.has(args.window)) {
        throw new SourceError("INVALID_ARGUMENT", `окно «${String(args.window)}» не из контракта`);
      }
      const metric = definitionOf(args.metricId);
      if (!metric.hasSeries) {
        throw new SourceError("SERIES_NOT_AVAILABLE", `у «${metric.id}» нет ряда`);
      }
      requireScope(metric, args.scopeId);
      const windowSec =
        args.window === "last5Min" ? 300 : args.window === "last15Min" ? 900 : 3600;
      const now = SESSION_START + tick * 5;
      const step = metric.sampleIntervalSec;
      const values: number[] = [];
      const timestamps: number[] = [];
      for (let time = Math.max(0, now - windowSec); time <= now; time += step) {
        // Пропуск в середине окна: он виден только по timestamps, и это
        // единственный способ его показать (Gs-3.3).
        if (time % 60 === 0) continue;
        timestamps.push(time);
        values.push(400 + Math.sin(time / 30) * 20);
      }
      return {
        kind: "series",
        metricId: metric.id,
        scopeId: args.scopeId ?? "",
        window: args.window,
        unit: metric.unit,
        source: "fixture",
        intervalSec: step,
        values,
        timestamps,
        firstPointSessionTimeSec: timestamps[0] ?? now,
        windowIncomplete: now < windowSec,
      };
    },

    chatSend(args: ChatSendArgs): ChatSendResult {
      const text = typeof args.text === "string" ? args.text.trim() : "";
      if (text === "") {
        throw new SourceError("INVALID_ARGUMENT", "пустой текст хода");
      }
      if (turn !== null) {
        // Два разных кода нарочно: пока ход идёт — `TURN_IN_PROGRESS`, после
        // отмены, пока ответ дочитывается, — `TURN_DRAINING`. Экран должен
        // различать «идёт» и «доигрывает»: во втором случае следующий ход
        // можно будет отправить через мгновение.
        throw new SourceError(
          turn.cancelled ? "TURN_DRAINING" : "TURN_IN_PROGRESS",
          turn.cancelled ? "прежний ход ещё дочитывается" : "ход уже идёт",
        );
      }

      turnSeq += 1;
      const turnId = `t-${turnSeq}`;
      turn = { id: turnId, cancelled: false };
      history.push({
        id: `m-${history.length + 1}`,
        role: "user",
        text,
        createdAt: new Date().toISOString(),
      });

      const answer = answerFor(text);
      const chunks = answer.split(" ").map((word, index) => (index === 0 ? word : ` ${word}`));
      const startedAt = Date.now();

      chunks.forEach((chunk, index) => {
        later(chunkMs * (index + 1), () => {
          // После отмены куски не вещаются: отмена — это «перестать
          // показывать». Ход при этом продолжается.
          if (turn?.id !== turnId || turn.cancelled) return;
          emit("chat.text", { turnId, text: chunk });
        });
      });

      later(chunkMs * (chunks.length + 1), () => {
        if (turn?.id !== turnId) return;
        const cancelled = turn.cancelled;
        // Ответ ложится в историю в обоих случаях — и это главное, что
        // показывает демонстрация: отменённый ход не исчезает.
        history.push({
          id: `m-${history.length + 1}`,
          role: "assistant",
          text: answer,
          createdAt: new Date().toISOString(),
        });
        turn = null;
        if (!cancelled) {
          emit("chat.done", { turnId, model: CHAT_MODEL, latencyMs: Date.now() - startedAt });
        }
      });

      return { turnId };
    },

    chatCancel(args: ChatCancelArgs): ChatCancelResult {
      if (turn === null) {
        throw new SourceError("NO_TURN", "отменять нечего: хода нет");
      }
      if (turn.id !== args.turnId) {
        throw new SourceError("TURN_MISMATCH", `ход «${String(args.turnId)}» не текущий`);
      }
      if (turn.cancelled) return { state: "alreadyCancelled" };
      turn.cancelled = true;
      emit("chat.cancelled", { turnId: turn.id });
      return { state: "cancelled" };
    },

    chatHistory(args: ChatHistoryArgs): ChatHistoryResult {
      const limit = args.limit ?? CHAT_HISTORY_DEFAULT;
      if (!Number.isInteger(limit) || limit < 1 || limit > CHAT_HISTORY_MAX) {
        throw new SourceError("INVALID_ARGUMENT", `limit вне диапазона 1–${CHAT_HISTORY_MAX}`);
      }
      // От старых к новым, последние `limit` — как в контракте.
      return { messages: history.slice(-limit) };
    },

    subscribe(emitTo: (event: string, data: unknown) => void): () => void {
      emitEvent = emitTo;
      // Снимок раз в пять секунд: экран должен перерисовываться по событию,
      // а не по своему таймеру (§8.2).
      const timer = setInterval(() => {
        tick += 1;
        emitTo("metrics.snapshot", {
          sessionTimeSec: SESSION_START + tick * 5,
          changedMetricIds: ["power.production", "power.consumption"],
          source: "fixture",
        });
      }, 5000);
      return () => {
        clearInterval(timer);
        // Таймеры хода снимаются вместе с подпиской: иначе закрытый сервер
        // держал бы процесс до конца последнего ответа.
        for (const pending of timers) clearTimeout(pending);
        timers.clear();
        turn = null;
        emitEvent = null;
      };
    },
  };
}
