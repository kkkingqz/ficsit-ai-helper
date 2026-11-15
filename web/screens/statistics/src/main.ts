import { createApi, type FicsitAIApi } from "@ficsitai/screens-api";
import { DEFAULT_STRINGS } from "./constants.js";
import { StatisticsController } from "./controller.js";
import type { IStatisticsView } from "./types.js";

/**
 * Initializes the Statistics screen on the provided DOM element.
 */
export async function initStatistics(
  rootElement?: HTMLElement | null
): Promise<StatisticsController | null> {
  const root =
    rootElement ??
    document.getElementById("ficsitai-statistics") ??
    document.querySelector("main") ??
    document.body;

  if (!root) {
    console.error("Statistics screen root container not found");
    return null;
  }

  const api: FicsitAIApi = createApi();

  let view: IStatisticsView | undefined;
  try {
    // Dynamic path resolution to link with web/ui-kit in browser / dev environments
    const uiKitComponentsPath = "../../ui-kit/components.js";
    const uiKitScreensPath = "../../ui-kit/screens/statistics.js";

    const [componentsMod, screensMod] = await Promise.all([
      import(/* @vite-ignore */ uiKitComponentsPath).catch(() => null),
      import(/* @vite-ignore */ uiKitScreensPath).catch(() => null),
    ]);

    if (componentsMod && screensMod && typeof screensMod.mountStatistics === "function") {
      const presenter = componentsMod.createPresenter("en", {
        megawatt: "MW",
        itemsPerMinute: "items/min",
        cubicMetersPerMinute: "m³/min",
        items: "",
        percent: "%",
        seconds: "s",
      });

      const controller = new StatisticsController({
        api,
        copy: DEFAULT_STRINGS,
      });

      view = screensMod.mountStatistics(root, {
        presenter,
        Plot: (globalThis as any).uPlot,
        copy: DEFAULT_STRINGS,
        actions: controller.getActions(),
      });

      (controller as any).view = view;
      controller.render();
      return controller;
    }
  } catch (err) {
    console.warn("UI-kit presentation modules not loaded, using controller headless/fallback mode:", err);
  }

  // Fallback controller initialization
  return new StatisticsController({
    api,
    root,
    copy: DEFAULT_STRINGS,
  });
}

// Auto-run if running directly in a browser environment
if (typeof window !== "undefined" && typeof document !== "undefined") {
  window.addEventListener("DOMContentLoaded", () => {
    initStatistics().catch((err) => {
      console.error("Failed to initialize Statistics screen:", err);
    });
  });
}
