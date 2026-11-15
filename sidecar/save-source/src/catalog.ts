import {
  CostClass,
  FicsitAIApiError,
  MetricDescriptor,
  MetricScope,
  ScopeRef,
  Unit,
} from "./types.js";

/** Лимиты пагинации по контракту Public API v0 (раздел Pagination & Discovery). */
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;
export const MAX_INLINE_SCOPES = 50;

export interface MetricDefinition {
  id: string;
  displayName: string;
  unit: Unit;
  scope: MetricScope;
  hasSeries: boolean;
  costClass: CostClass;
  sampleIntervalSec: number;
  external: boolean;
  precisionDigits: number;
}

/**
 * Канонический каталог 20 метрик v0.1 согласно
 * mod/FicsitAI/Source/FicsitAICore/GameFacade/Telemetry/Sampling/metrics-v0.1.md.
 * Для источников Save и SaveEstimated временные ряды отсутствуют (hasSeries: false).
 */
export const V01_METRICS: readonly MetricDefinition[] = [
  // Factory (2)
  {
    id: "power.production",
    displayName: "Total Power Production",
    unit: "megawatt",
    scope: "factory",
    hasSeries: false,
    costClass: "normal",
    sampleIntervalSec: 5,
    external: false,
    precisionDigits: 1,
  },
  {
    id: "power.consumption",
    displayName: "Total Power Consumption",
    unit: "megawatt",
    scope: "factory",
    hasSeries: false,
    costClass: "normal",
    sampleIntervalSec: 5,
    external: false,
    precisionDigits: 1,
  },
  // PowerNetwork (9)
  {
    id: "power.network.production",
    displayName: "Network Power Production",
    unit: "megawatt",
    scope: "powerNetwork",
    hasSeries: false,
    costClass: "normal",
    sampleIntervalSec: 5,
    external: false,
    precisionDigits: 1,
  },
  {
    id: "power.network.consumption",
    displayName: "Network Power Consumption",
    unit: "megawatt",
    scope: "powerNetwork",
    hasSeries: false,
    costClass: "normal",
    sampleIntervalSec: 5,
    external: false,
    precisionDigits: 1,
  },
  {
    id: "power.network.capacity",
    displayName: "Network Power Capacity",
    unit: "megawatt",
    scope: "powerNetwork",
    hasSeries: false,
    costClass: "cheap",
    sampleIntervalSec: 5,
    external: false,
    precisionDigits: 1,
  },
  {
    id: "power.network.max_consumption",
    displayName: "Network Max Power Consumption",
    unit: "megawatt",
    scope: "powerNetwork",
    hasSeries: false,
    costClass: "cheap",
    sampleIntervalSec: 5,
    external: false,
    precisionDigits: 1,
  },
  {
    id: "power.network.fuse_tripped",
    displayName: "Network Fuse Tripped",
    unit: "count",
    scope: "powerNetwork",
    hasSeries: false,
    costClass: "cheap",
    sampleIntervalSec: 5,
    external: false,
    precisionDigits: 0,
  },
  {
    id: "power.network.battery_charge",
    displayName: "Network Battery Charge",
    unit: "percent",
    scope: "powerNetwork",
    hasSeries: false,
    costClass: "cheap",
    sampleIntervalSec: 5,
    external: false,
    precisionDigits: 1,
  },
  {
    id: "power.network.battery_output",
    displayName: "Network Battery Output",
    unit: "megawatt",
    scope: "powerNetwork",
    hasSeries: false,
    costClass: "cheap",
    sampleIntervalSec: 5,
    external: false,
    precisionDigits: 1,
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
    precisionDigits: 0,
  },
  {
    id: "power.network.battery_time_to_full",
    displayName: "Network Battery Time To Full",
    unit: "seconds",
    scope: "powerNetwork",
    hasSeries: false,
    costClass: "cheap",
    sampleIntervalSec: 5,
    external: false,
    precisionDigits: 0,
  },
  // MachineType (3)
  {
    id: "generators.total",
    displayName: "Generators Total",
    unit: "count",
    scope: "machineType",
    hasSeries: false,
    costClass: "normal",
    sampleIntervalSec: 10,
    external: false,
    precisionDigits: 0,
  },
  {
    id: "generators.running",
    displayName: "Generators Running",
    unit: "count",
    scope: "machineType",
    hasSeries: false,
    costClass: "normal",
    sampleIntervalSec: 10,
    external: false,
    precisionDigits: 0,
  },
  {
    id: "generators.production",
    displayName: "Generators Production",
    unit: "megawatt",
    scope: "machineType",
    hasSeries: false,
    costClass: "normal",
    sampleIntervalSec: 10,
    external: false,
    precisionDigits: 1,
  },
  // Item (solid, 3)
  {
    id: "items.produced",
    displayName: "Items Produced",
    unit: "itemsPerMinute",
    scope: "item",
    hasSeries: false,
    costClass: "heavy",
    sampleIntervalSec: 15,
    external: false,
    precisionDigits: 1,
  },
  {
    id: "items.consumed",
    displayName: "Items Consumed",
    unit: "itemsPerMinute",
    scope: "item",
    hasSeries: false,
    costClass: "heavy",
    sampleIntervalSec: 15,
    external: false,
    precisionDigits: 1,
  },
  {
    id: "items.balance",
    displayName: "Items Balance",
    unit: "itemsPerMinute",
    scope: "item",
    hasSeries: false,
    costClass: "heavy",
    sampleIntervalSec: 15,
    external: false,
    precisionDigits: 1,
  },
  // Item (fluids, 3)
  {
    id: "fluids.produced",
    displayName: "Fluids Produced",
    unit: "cubicMetersPerMinute",
    scope: "item",
    hasSeries: false,
    costClass: "heavy",
    sampleIntervalSec: 15,
    external: false,
    precisionDigits: 1,
  },
  {
    id: "fluids.consumed",
    displayName: "Fluids Consumed",
    unit: "cubicMetersPerMinute",
    scope: "item",
    hasSeries: false,
    costClass: "heavy",
    sampleIntervalSec: 15,
    external: false,
    precisionDigits: 1,
  },
  {
    id: "fluids.balance",
    displayName: "Fluids Balance",
    unit: "cubicMetersPerMinute",
    scope: "item",
    hasSeries: false,
    costClass: "heavy",
    sampleIntervalSec: 15,
    external: false,
    precisionDigits: 1,
  },
];

const METRIC_BY_ID = new Map<string, MetricDefinition>(
  V01_METRICS.map((metric) => [metric.id, metric]),
);

export function getMetricDefinition(metricId: string): MetricDefinition {
  const def = METRIC_BY_ID.get(metricId);
  if (!def) {
    throw new FicsitAIApiError("UNKNOWN_METRIC", `Unknown metricId: ${metricId}`, {
      metricId,
    });
  }
  return def;
}

export function normalizePageSize(pageSize: number | undefined): number {
  if (pageSize === undefined) {
    return DEFAULT_PAGE_SIZE;
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    throw new FicsitAIApiError(
      "INVALID_ARGUMENT",
      `pageSize must be an integer between 1 and ${MAX_PAGE_SIZE}`,
      { pageSize },
    );
  }
  return pageSize;
}

export type CursorKind = "m" | "s";

export function encodeCursor(kind: CursorKind, offset: number): string {
  const payload = Buffer.from(JSON.stringify({ k: kind, o: offset }), "utf8").toString(
    "base64url",
  );
  return `${kind}_${payload}`;
}

export function decodeCursor(
  cursor: string | undefined,
  expectedKind: CursorKind,
  paramName: string,
): number {
  if (cursor === undefined || cursor === "") {
    return 0;
  }
  const underscoreIdx = cursor.indexOf("_");
  if (underscoreIdx <= 0) {
    throw new FicsitAIApiError("INVALID_ARGUMENT", `Invalid ${paramName} cursor format`);
  }
  const prefix = cursor.slice(0, underscoreIdx);
  if (prefix !== expectedKind) {
    throw new FicsitAIApiError(
      "INVALID_ARGUMENT",
      `Cursor ${paramName} has mismatched kind`,
      { expectedKind, actualKind: prefix },
    );
  }
  const encoded = cursor.slice(underscoreIdx + 1);
  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as {
      k?: unknown;
      o?: unknown;
    };
    if (
      parsed.k !== expectedKind ||
      typeof parsed.o !== "number" ||
      !Number.isInteger(parsed.o) ||
      parsed.o < 0
    ) {
      throw new Error("bad payload");
    }
    return parsed.o;
  } catch {
    throw new FicsitAIApiError("INVALID_ARGUMENT", `Invalid ${paramName} cursor payload`);
  }
}

export function filterScopes(scopes: readonly ScopeRef[], scopeFilter?: string): ScopeRef[] {
  if (!scopeFilter || scopeFilter.trim() === "") {
    return [...scopes];
  }
  const needle = scopeFilter.toLowerCase();
  return scopes.filter(
    (s) =>
      s.scopeId.toLowerCase().includes(needle) ||
      s.displayName.toLowerCase().includes(needle),
  );
}

export function toMetricDescriptor(
  def: MetricDefinition,
  scopes: readonly ScopeRef[],
  scopeOffset = 0,
  maxScopes = MAX_INLINE_SCOPES,
): { descriptor: MetricDescriptor; nextScopeCursor: string } {
  const boundedMax = Math.min(maxScopes, MAX_INLINE_SCOPES);
  if (scopeOffset > scopes.length) {
    throw new FicsitAIApiError("INVALID_ARGUMENT", "scopeCursor is out of range");
  }
  const slice = scopes.slice(scopeOffset, scopeOffset + boundedMax);
  const hasMore = scopeOffset + slice.length < scopes.length;
  const nextScopeCursor = hasMore ? encodeCursor("s", scopeOffset + slice.length) : "";

  return {
    descriptor: {
      id: def.id,
      displayName: def.displayName,
      unit: def.unit,
      scope: def.scope,
      hasSeries: def.hasSeries,
      costClass: def.costClass,
      sampleIntervalSec: def.sampleIntervalSec,
      external: def.external,
      availableScopes: slice,
      scopesTruncated: hasMore,
    },
    nextScopeCursor,
  };
}
