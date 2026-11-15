import { describe, expect, it, vi } from "vitest";
import type {
  ApiStatus,
  FicsitAIApi,
  ListMetricsResult,
  MetricSeries,
  MetricValue,
} from "@ficsitai/screens-api";
import { StatisticsController } from "../src/controller.js";
import type { IStatisticsView, StatisticsModel } from "../src/types.js";

function createMockApi(overrides: Partial<ApiStatus> = {}): {
  api: FicsitAIApi;
  emitSnapshot: (sessionTime: number) => void;
  queryCalls: string[];
} {
  const listeners: Record<string, ((data: any) => void)[]> = {};
  const queryCalls: string[] = [];
  let currentSessionTime = 2100;

  const status: ApiStatus = {
    apiVersion: "0.5.0",
    saveId: "test-save-id",
    source: "live",
    inert: false,
    lastSnapshotSessionTimeSec: 2100,
    sidecarConnected: true,
    apiVersionMismatch: "",
    reason: "",
    ...overrides,
  };

  const api: FicsitAIApi = {
    transport: "mock" as any,
    getStatus: vi.fn(async () => status),
    listMetrics: vi.fn(async (): Promise<ListMetricsResult> => ({
      metrics: [
        {
          id: "power.production",
          displayName: "Power Production",
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
          displayName: "Power Consumption",
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
          id: "power.capacity",
          displayName: "Grid Capacity",
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
          id: "iron.production",
          displayName: "Iron Ore Production",
          unit: "itemsPerMinute",
          scope: "item",
          hasSeries: true,
          costClass: "normal",
          sampleIntervalSec: 15,
          external: false,
          availableScopes: [],
          scopesTruncated: false,
        },
      ],
      nextCursor: "",
    })),
    listScopes: vi.fn(async () => ({ scopes: [], nextCursor: "" })),
    queryMetric: vi.fn(async (args): Promise<MetricValue> => {
      queryCalls.push(`queryMetric:${args.metricId}`);
      let val = 500;
      if (args.metricId === "power.production") val = 850;
      if (args.metricId === "power.consumption") val = 620;
      if (args.metricId === "power.capacity") val = 1000;
      return {
        kind: "value",
        metricId: args.metricId,
        scopeId: args.scopeId || "",
        state: "value",
        value: val,
        unit: "megawatt",
        source: "live",
        sessionTimeSec: currentSessionTime,
        precisionDigits: 0,
      };
    }),
    querySeries: vi.fn(async (args): Promise<MetricSeries> => {
      queryCalls.push(`querySeries:${args.metricId}:${args.window}`);
      return {
        kind: "series",
        metricId: args.metricId,
        scopeId: args.scopeId || "",
        window: args.window,
        unit: "megawatt",
        source: "live",
        intervalSec: 5,
        timestamps: [currentSessionTime - 20, currentSessionTime - 10, currentSessionTime],
        values: [840, 845, 850],
        firstPointSessionTimeSec: currentSessionTime - 20,
        windowIncomplete: false,
      };
    }),
    on: vi.fn((event: string, handler: (data: any) => void) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event]!.push(handler);
      return () => {
        listeners[event] = listeners[event]!.filter((h) => h !== handler);
      };
    }),
    close: vi.fn(),
  };

  return {
    api,
    queryCalls,
    emitSnapshot: (sessionTime: number) => {
      currentSessionTime = sessionTime;
      for (const h of listeners["metrics.snapshot"] || []) {
        h({ sessionTimeSec: sessionTime });
      }
    },
  };
}

describe("StatisticsController (V-5, #22)", () => {
  it("initializes and renders energy model with metrics, tiles, and charts", async () => {
    const { api } = createMockApi();
    let latestModel: StatisticsModel | null = null;

    const mockView: IStatisticsView = {
      update: vi.fn((m) => {
        latestModel = m;
      }),
      unmount: vi.fn(),
    };

    const controller = new StatisticsController({
      api,
      view: mockView,
    });

    // Wait for async init
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mockView.update).toHaveBeenCalled();
    expect(latestModel).not.toBeNull();
    expect(latestModel!.tab).toBe("energy");
    expect(latestModel!.window).toBe(15);
    expect(latestModel!.canExport).toBe(true);

    // Verify energy tiles
    const prodTile = latestModel!.tiles.find((t) => t.id === "generation");
    expect(prodTile).toBeDefined();
    expect(prodTile!.reading.value).toBe(850);

    const consTile = latestModel!.tiles.find((t) => t.id === "consumption");
    expect(consTile).toBeDefined();
    expect(consTile!.reading.value).toBe(620);

    const headroomTile = latestModel!.tiles.find((t) => t.id === "headroom");
    expect(headroomTile).toBeDefined();
    expect(headroomTile!.reading.value).toBe(380); // 1000 - 620

    // Verify charts
    expect(latestModel!.charts.length).toBeGreaterThan(0);
    const primaryChart = latestModel!.charts[0]!;
    expect(primaryChart.series.length).toBe(2);

    // Verify tables
    expect(latestModel!.tables.length).toBe(3);

    // Verify meters
    expect(latestModel!.meters?.length).toBe(1);
    expect(latestModel!.meters![0]?.id).toBe("battery");

    controller.destroy();
    expect(mockView.unmount).toHaveBeenCalled();
  });

  it("handles tab switching to resources and back", async () => {
    const { api } = createMockApi();
    let latestModel: StatisticsModel | null = null;

    const controller = new StatisticsController({
      api,
      view: {
        update: (m) => {
          latestModel = m;
        },
        unmount: vi.fn(),
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(latestModel!.tab).toBe("energy");

    // Switch to resources
    controller.setTab("resources");
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(latestModel!.tab).toBe("resources");
    expect(latestModel!.tables[0]?.groups[0]?.id).toBe("balance-table");
    expect(latestModel!.charts.length).toBe(3); // Extraction, Consumption, Stock trend

    // Switch back to energy
    controller.setTab("energy");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(latestModel!.tab).toBe("energy");

    controller.destroy();
  });

  it("handles window changing and requests corresponding series", async () => {
    const { api, queryCalls } = createMockApi();

    const controller = new StatisticsController({
      api,
      view: { update: vi.fn(), unmount: vi.fn() },
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Change to 5 min
    controller.setWindow(5);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(queryCalls.some((c) => c.includes("last5Min"))).toBe(true);

    // Change to 60 min
    controller.setWindow(60);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(queryCalls.some((c) => c.includes("last60Min"))).toBe(true);

    controller.destroy();
  });

  it("handles CSV export and temporary notice", async () => {
    const { api } = createMockApi();
    let exportedCsv = "";
    let exportedFile = "";

    const controller = new StatisticsController({
      api,
      view: { update: vi.fn(), unmount: vi.fn() },
      exportHandler: (csv, filename) => {
        exportedCsv = csv;
        exportedFile = filename;
        return true;
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    const exportSuccess = await controller.handleExport();
    expect(exportSuccess).toBe(true);
    expect(exportedFile).toBe("ficsitai-statistics-energy-15min.csv");
    expect(exportedCsv).toContain("# Report,ENERGY");
    expect(exportedCsv).toContain("[TABLE: Generators by type]");

    const model = controller.buildModel();
    expect(model.notice).toBe("CSV export complete");

    controller.destroy();
  });

  it("updates model in real-time when metrics.snapshot event arrives", async () => {
    const { api, emitSnapshot } = createMockApi();
    const updateSpy = vi.fn();

    const controller = new StatisticsController({
      api,
      view: { update: updateSpy, unmount: vi.fn() },
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    updateSpy.mockClear();

    // Emit new snapshot with updated time
    emitSnapshot(2115);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(updateSpy).toHaveBeenCalled();
    const model = controller.buildModel();
    expect(model.tiles[0]?.reading.sessionTimeSec).toBe(2115);

    controller.destroy();
  });

  it("continues working when sidecar is disconnected (FR-10)", async () => {
    const { api } = createMockApi({ sidecarConnected: false });

    const controller = new StatisticsController({
      api,
      view: { update: vi.fn(), unmount: vi.fn() },
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    const model = controller.buildModel();
    expect(model.tab).toBe("energy");
    expect(model.canExport).toBe(true);
    expect(model.tiles.length).toBeGreaterThan(0);

    controller.destroy();
  });

  it("displays notice when mod is in inert mode", async () => {
    const { api } = createMockApi({ inert: true });

    const controller = new StatisticsController({
      api,
      view: { update: vi.fn(), unmount: vi.fn() },
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    const model = controller.buildModel();
    expect(model.notice).toContain("Inert mode");

    controller.destroy();
  });

  it("displays eviction notice when 5th series is selected", async () => {
    const { api } = createMockApi();

    const controller = new StatisticsController({
      api,
      view: { update: vi.fn(), unmount: vi.fn() },
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Initially energy has 2 series: power.production, power.consumption
    // Add 3rd
    controller.toggleMetric("power.capacity");
    // Add 4th
    controller.toggleMetric("power.metric4");
    // Add 5th: should evict oldest ("power.production")
    controller.toggleMetric("power.metric5");

    const model = controller.buildModel();
    expect(model.notice).toContain("Max 4 series reached — evicted oldest");

    controller.destroy();
  });
});
