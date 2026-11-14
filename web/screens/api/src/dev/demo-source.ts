import { SourceError, type DevSource } from "./source.js";
import type {
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

function withScopes(metric: MetricDescriptor, offset = 0): MetricDescriptor {
  const all = scopesOf(metric.id);
  const page = all.slice(offset, offset + MAX_INLINE_SCOPES);
  return {
    ...metric,
    availableScopes: page,
    scopesTruncated: offset + page.length < all.length,
  };
}

export function createDemoSource(): DevSource {
  let tick = 0;

  return {
    name: "demo",

    getStatus() {
      return {
        apiVersion: "0.4.0",
        saveId: "demo-save",
        source: "fixture",
        inert: false,
        lastSnapshotSessionTimeSec: SESSION_START + tick * 5,
        sidecarConnected: false,
        apiVersionMismatch: "",
        reason: "демонстрационный источник dev-сервера",
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
        const all = scopesOf(metric.id);
        const descriptor = withScopes(metric, offset);
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
      const needle = args.scopeFilter?.trim().toLowerCase();
      const all = scopesOf(metric.id).filter(
        (scope) =>
          needle === undefined ||
          needle === "" ||
          scope.displayName.toLowerCase().includes(needle) ||
          scope.scopeId.toLowerCase().includes(needle),
      );
      const page = all.slice(offset, offset + pageSize);
      const nextOffset = offset + page.length;
      return { scopes: page, nextCursor: nextOffset < all.length ? `s:${nextOffset}` : "" };
    },

    queryMetric(args: QueryMetricArgs): MetricValue {
      const metric = definitionOf(args.metricId);
      const scopes = scopesOf(metric.id);
      if (scopes.length > 0 && (args.scopeId === undefined || args.scopeId === "")) {
        throw new SourceError("SCOPE_REQUIRED", `метрике «${metric.id}» нужен scopeId`);
      }
      if (
        args.scopeId !== undefined &&
        args.scopeId !== "" &&
        !scopes.some((scope) => scope.scopeId === args.scopeId)
      ) {
        throw new SourceError("SCOPE_NOT_FOUND", `область «${args.scopeId}» неизвестна`);
      }

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
      const metric = definitionOf(args.metricId);
      if (!metric.hasSeries) {
        throw new SourceError("SERIES_NOT_AVAILABLE", `у «${metric.id}» нет ряда`);
      }
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

    subscribe(emit: (event: string, data: unknown) => void): () => void {
      // Снимок раз в пять секунд: экран должен перерисовываться по событию,
      // а не по своему таймеру (§8.2).
      const timer = setInterval(() => {
        tick += 1;
        emit("metrics.snapshot", {
          sessionTimeSec: SESSION_START + tick * 5,
          changedMetricIds: ["power.production", "power.consumption"],
          source: "fixture",
        });
      }, 5000);
      return () => clearInterval(timer);
    },
  };
}
