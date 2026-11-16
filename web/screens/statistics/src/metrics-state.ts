import { MAX_CHART_SERIES } from "./constants.js";
import type { CatalogMetricModel, ReportTab } from "./types.js";

export interface MetricSelectionResult {
  updatedSelectedIds: string[];
  evictedId: string | null;
}

export class MetricsStateManager {
  private activeByTab: Map<ReportTab, string[]> = new Map();

  constructor(initialSelections?: Partial<Record<ReportTab, string[]>>) {
    this.activeByTab.set("energy", initialSelections?.energy ?? [
      "power.production",
      "power.consumption",
    ]);
    this.activeByTab.set("resources", initialSelections?.resources ?? [
      "iron.production",
      "copper.production",
    ]);
  }

  public getSelected(tab: ReportTab): string[] {
    return [...(this.activeByTab.get(tab) ?? [])];
  }

  public isSelected(tab: ReportTab, id: string): boolean {
    const list = this.activeByTab.get(tab) ?? [];
    return list.includes(id);
  }

  /**
   * Toggles a metric on/off.
   * If adding exceeds MAX_CHART_SERIES (4), the oldest chosen series is evicted (FIFO).
   */
  public toggleMetric(tab: ReportTab, id: string): MetricSelectionResult {
    const current = this.getSelected(tab);
    const existingIndex = current.indexOf(id);

    if (existingIndex >= 0) {
      // Metric is already selected: deselect it
      current.splice(existingIndex, 1);
      this.activeByTab.set(tab, current);
      return { updatedSelectedIds: current, evictedId: null };
    }

    // Adding metric
    let evictedId: string | null = null;
    if (current.length >= MAX_CHART_SERIES) {
      // Evict oldest (head of array)
      evictedId = current.shift() ?? null;
    }

    current.push(id);
    this.activeByTab.set(tab, current);
    return { updatedSelectedIds: current, evictedId };
  }

  public filterCatalog(
    catalog: CatalogMetricModel[],
    query: string,
    locale = "en"
  ): CatalogMetricModel[] {
    const term = query.trim().toLocaleLowerCase(locale);
    if (!term) {
      return catalog.map((m) => ({ ...m, matches: true }));
    }

    return catalog.map((m) => ({
      ...m,
      matches:
        m.label.toLocaleLowerCase(locale).includes(term) ||
        m.id.toLocaleLowerCase(locale).includes(term),
    }));
  }
}
