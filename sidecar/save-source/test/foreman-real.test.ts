import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createSaveSource, loadForemanPackages, PUBLIC_API_VERSION } from "../src/index.js";

const foremanDir = process.env.FOREMAN_SRC
  ? path.resolve(process.env.FOREMAN_SRC)
  : path.join(os.homedir(), "Projects", "foreman-src");

const hasForemanBuild = existsSync(
  path.join(foremanDir, "packages", "sf-save-data", "dist", "index.js"),
);

const candidateSavePath = process.env.FICSIT_TEST_SAV_PATH;
const hasRealSave = Boolean(
  hasForemanBuild &&
    candidateSavePath &&
    existsSync(candidateSavePath),
);

describe.skipIf(!hasForemanBuild)("Foreman real packages integration", () => {
  it("loads compiled @foreman/* packages and bundled GameData", async () => {
    const packages = await loadForemanPackages(foremanDir);
    const { gameData, world } = packages.loadDataset();

    expect(Object.keys(gameData.recipes).length).toBeGreaterThan(100);
    expect(Object.keys(gameData.buildings).length).toBeGreaterThan(30);
    expect(world.resourceNodes.length).toBeGreaterThan(100);
    expect(packages.WATER_ITEM_CLASS).toBe("Desc_Water_C");
  });
});

describe.skipIf(!hasRealSave)("Real .sav file integration", () => {
  it("parses real .sav and serves GetStatus, ListMetrics and QueryMetric", async () => {
    const source = createSaveSource({
      saveFilePath: candidateSavePath,
      foremanSrcDir: foremanDir,
      sourceMode: "save",
    });

    const status = await source.getStatus();
    expect(status.apiVersion).toBe(PUBLIC_API_VERSION);
    expect(status.inert).toBe(false);
    expect(status.source).toBe("save");

    const catalog = await source.listMetrics();
    expect(catalog.metrics).toHaveLength(20);

    const powerProd = await source.queryMetric({ metricId: "power.production" });
    const powerCons = await source.queryMetric({ metricId: "power.consumption" });
    expect(powerProd.state).toBe("value");
    expect(typeof powerProd.value).toBe("number");
    expect(powerCons.state).toBe("value");
    expect(typeof powerCons.value).toBe("number");

    const itemScopes = await source.listScopes({ metricId: "items.produced" });
    if (itemScopes.scopes.length > 0 && itemScopes.scopes[0]) {
      const sample = await source.queryMetric({
        metricId: "items.produced",
        scopeId: itemScopes.scopes[0].scopeId,
      });
      expect(sample.state).toBe("value");
      expect(sample.unit).toBe("itemsPerMinute");
    }

    const estSource = createSaveSource({
      saveFilePath: candidateSavePath,
      foremanSrcDir: foremanDir,
      sourceMode: "saveEstimated",
    });
    const estPower = await estSource.queryMetric({ metricId: "power.production" });
    expect(estPower.source).toBe("saveEstimated");
    expect(estPower.state).toBe("value");
  }, 30000);
});
