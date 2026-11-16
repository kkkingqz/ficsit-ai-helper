import { describe, expect, it } from "vitest";
import { MetricsStateManager } from "../src/metrics-state.js";
import type { CatalogMetricModel } from "../src/types.js";

describe("MetricsStateManager & 4-Series Invariant (D-1 §2.2)", () => {
  it("initializes with default metrics for energy and resources", () => {
    const manager = new MetricsStateManager();
    expect(manager.getSelected("energy")).toEqual([
      "power.production",
      "power.consumption",
    ]);
    expect(manager.getSelected("resources")).toEqual([
      "iron.production",
      "copper.production",
    ]);
  });

  it("toggles metric off when already selected", () => {
    const manager = new MetricsStateManager();
    const res = manager.toggleMetric("energy", "power.production");
    expect(res.evictedId).toBeNull();
    expect(res.updatedSelectedIds).toEqual(["power.consumption"]);
    expect(manager.isSelected("energy", "power.production")).toBe(false);
  });

  it("enforces max 4 series on chart by evicting oldest custom selection", () => {
    // Start with 3 series
    const manager = new MetricsStateManager({
      energy: ["s1", "s2", "s3"],
    });

    // Add 4th series: no eviction
    const res4 = manager.toggleMetric("energy", "s4");
    expect(res4.evictedId).toBeNull();
    expect(res4.updatedSelectedIds).toEqual(["s1", "s2", "s3", "s4"]);

    // Add 5th series: 's1' (the oldest) must be evicted
    const res5 = manager.toggleMetric("energy", "s5");
    expect(res5.evictedId).toBe("s1");
    expect(res5.updatedSelectedIds).toEqual(["s2", "s3", "s4", "s5"]);
    expect(manager.getSelected("energy").length).toBe(4);
  });

  it("filters catalog metrics case-insensitively by query and matches flag", () => {
    const manager = new MetricsStateManager();
    const catalog: CatalogMetricModel[] = [
      { id: "power.production", label: "Power Production", unit: "megawatt", hasSeries: true, selected: true },
      { id: "power.consumption", label: "Power Consumption", unit: "megawatt", hasSeries: true, selected: true },
      { id: "items.produced", label: "Iron Ore", unit: "itemsPerMinute", hasSeries: true, selected: false },
    ];

    const filtered = manager.filterCatalog(catalog, "iron");
    expect(filtered.find((m) => m.id === "items.produced")?.matches).toBe(true);
    expect(filtered.find((m) => m.id === "power.production")?.matches).toBe(false);

    // Empty query matches all
    const all = manager.filterCatalog(catalog, "");
    expect(all.every((m) => m.matches)).toBe(true);
  });
});
