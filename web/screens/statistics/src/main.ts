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
    // From dist/main.js, ui-kit is at ../../../ui-kit/ (fallback to ../../ui-kit/)
    const uiKitComponentsPath: string = "../../../ui-kit/components.js";
    const uiKitScreensPath: string = "../../../ui-kit/screens/statistics.js";
    const altComponentsPath: string = "../../ui-kit/components.js";
    const altScreensPath: string = "../../ui-kit/screens/statistics.js";

    const loadUiKit = async () => {
      try {
        const [c, s] = await Promise.all([
          import(/* @vite-ignore */ uiKitComponentsPath),
          import(/* @vite-ignore */ uiKitScreensPath),
        ]);
        return [c, s];
      } catch {
        return Promise.all([
          import(/* @vite-ignore */ altComponentsPath).catch(() => null),
          import(/* @vite-ignore */ altScreensPath).catch(() => null),
        ]);
      }
    };
    const [componentsMod, screensMod] = await loadUiKit();

    if (componentsMod && screensMod && typeof screensMod.mountStatistics === "function") {
      const presenter = componentsMod.createPresenter("en", {
        megawatt: "MW",
        itemsPerMinute: "items/min",
        cubicMetersPerMinute: "m³/min",
        items: "",
        percent: "%",
        seconds: "s",
      });

      const copy = {
        ...DEFAULT_STRINGS,
        axis: (value: number) => presenter.number(value, 0),
      };

      const controller = new StatisticsController({
        api,
        copy,
      });

      view = screensMod.mountStatistics(root, {
        presenter,
        Plot: (globalThis as any).uPlot,
        copy,
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
