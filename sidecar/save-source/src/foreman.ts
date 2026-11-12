import { constants } from "node:fs";
import { access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  FicsitAIApiError,
  FlowSolverModule,
  ForemanPackages,
  GameBuilding,
  GameData,
  GameItem,
  GameRecipe,
  SaveSourceDeps,
  SaveSourceOptions,
} from "./types.js";

export interface ResolvedSaveLocation {
  saveFilePath: string;
  saveId: string;
}

export interface GameDataIndex {
  items: ReadonlyMap<string, GameItem>;
  recipes: ReadonlyMap<string, GameRecipe>;
  buildings: ReadonlyMap<string, GameBuilding>;
}

/** Разворачивает ведущую тильду `~` в домашний каталог пользователя. */
export function expandHomePath(rawPath: string): string {
  if (rawPath === "~") {
    return os.homedir();
  }
  if (rawPath.startsWith("~/") || rawPath.startsWith("~\\")) {
    return path.join(os.homedir(), rawPath.slice(2));
  }
  return rawPath;
}

/** Определяет путь к локальному checkout FICSIT Foreman. */
export function resolveForemanSrcDir(options: SaveSourceOptions): string {
  const raw =
    options.foremanSrcDir ??
    process.env.FOREMAN_SRC ??
    path.join(os.homedir(), "Projects", "foreman-src");
  return path.resolve(expandHomePath(raw));
}

/** Проверяет безопасность идентификатора сохранения и разрешает путь к `.sav`. */
export function resolveSaveLocation(options: SaveSourceOptions): ResolvedSaveLocation {
  if (options.saveFilePath !== undefined && options.saveFilePath.trim() !== "") {
    const resolved = path.resolve(expandHomePath(options.saveFilePath));
    const base = path.basename(resolved, ".sav");
    const saveId = options.saveId?.trim() || base;
    return { saveFilePath: resolved, saveId };
  }

  const rawDir = options.saveDataDir?.trim();
  const rawSaveId = options.saveId?.trim();
  if (!rawDir || !rawSaveId) {
    throw new FicsitAIApiError(
      "SOURCE_UNAVAILABLE",
      "Save source requires saveFilePath or both saveDataDir and saveId",
    );
  }

  if (
    rawSaveId.includes("/") ||
    rawSaveId.includes("\\") ||
    rawSaveId.includes("..") ||
    rawSaveId.includes("\0")
  ) {
    throw new FicsitAIApiError(
      "INVALID_ARGUMENT",
      "saveId must not contain path separators or traversal segments",
      { saveId: rawSaveId },
    );
  }

  const resolvedDir = path.resolve(expandHomePath(rawDir));
  const fileName = rawSaveId.endsWith(".sav") ? rawSaveId : `${rawSaveId}.sav`;
  const saveFilePath = path.join(resolvedDir, fileName);
  const saveId = rawSaveId.endsWith(".sav") ? rawSaveId.slice(0, -4) : rawSaveId;
  return { saveFilePath, saveId };
}

export async function defaultFileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function importForemanPackage(foremanSrcDir: string, pkgName: string): Promise<unknown> {
  const entryPath = path.join(foremanSrcDir, "packages", pkgName, "dist", "index.js");
  if (!(await defaultFileExists(entryPath))) {
    throw new FicsitAIApiError(
      "SOURCE_UNAVAILABLE",
      `Foreman package build not found: ${entryPath}`,
      { pkgName, entryPath },
    );
  }
  return import(pathToFileURL(entryPath).href);
}

/** Динамически загружает собранные ESM-пакеты FICSIT Foreman без коммит-зависимости по file:. */
export async function loadForemanPackages(foremanSrcDir: string): Promise<ForemanPackages> {
  try {
    const [saveDataRaw, graphRaw, gameDataRaw] = await Promise.all([
      importForemanPackage(foremanSrcDir, "sf-save-data"),
      importForemanPackage(foremanSrcDir, "sf-save-data-graph"),
      importForemanPackage(foremanSrcDir, "sf-game-data"),
    ]);

    let flowModule: FlowSolverModule | undefined;
    try {
      const flowRaw = (await importForemanPackage(
        foremanSrcDir,
        "sf-flow",
      )) as Partial<FlowSolverModule>;
      if (typeof flowRaw.solveFlow === "function") {
        flowModule = { solveFlow: flowRaw.solveFlow };
      }
    } catch {
      // Режим "save" работает и без sf-flow; при запросе "saveEstimated" это будет учтено.
      flowModule = undefined;
    }

    const saveData = saveDataRaw as Partial<ForemanPackages>;
    const graph = graphRaw as Partial<ForemanPackages>;
    const gameData = gameDataRaw as Partial<ForemanPackages>;

    if (
      typeof saveData.parseSaveFile !== "function" ||
      typeof saveData.normaliseSave !== "function" ||
      typeof saveData.statMtimeMs !== "function" ||
      !(saveData.WATER_EXTRACTOR instanceof RegExp) ||
      typeof saveData.WATER_ITEM_CLASS !== "string" ||
      typeof graph.buildSaveGraph !== "function" ||
      typeof gameData.loadDataset !== "function"
    ) {
      throw new FicsitAIApiError(
        "SOURCE_UNAVAILABLE",
        "Loaded Foreman packages do not match expected exports",
        { foremanSrcDir },
      );
    }

    const packages: ForemanPackages = {
      parseSaveFile: saveData.parseSaveFile,
      normaliseSave: saveData.normaliseSave,
      statMtimeMs: saveData.statMtimeMs,
      WATER_EXTRACTOR: saveData.WATER_EXTRACTOR,
      WATER_ITEM_CLASS: saveData.WATER_ITEM_CLASS,
      buildSaveGraph: graph.buildSaveGraph,
      loadDataset: gameData.loadDataset,
    };
    if (flowModule !== undefined) {
      packages.flowModule = flowModule;
    }
    return packages;
  } catch (err) {
    if (err instanceof FicsitAIApiError) {
      throw err;
    }
    throw new FicsitAIApiError(
      "SOURCE_UNAVAILABLE",
      `Failed to load FICSIT Foreman packages from ${foremanSrcDir}`,
      { cause: err instanceof Error ? err.message : String(err) },
    );
  }
}

export function createDefaultDeps(overrides?: Partial<SaveSourceDeps>): SaveSourceDeps {
  return {
    loadForemanPackages: overrides?.loadForemanPackages ?? loadForemanPackages,
    fileExists: overrides?.fileExists ?? defaultFileExists,
  };
}

/** Преобразует сырой ClassName движка в читаемое английское имя при отсутствии записи в GameData. */
export function humaniseClassName(className: string): string {
  let cleaned = className
    .replace(/^(Build|Desc|Recipe)_/, "")
    .replace(/_C$/, "");
  cleaned = cleaned.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  cleaned = cleaned.replace(/_/g, " ").trim();
  return cleaned || className;
}

export function buildGameDataIndex(gameData: GameData): GameDataIndex {
  const items = new Map<string, GameItem>();
  for (const [key, item] of Object.entries(gameData.items ?? {})) {
    items.set(key, item);
    if (item.className) {
      items.set(item.className, item);
    }
  }
  for (const [key, res] of Object.entries(gameData.resources ?? {})) {
    if (!items.has(key)) {
      items.set(key, res);
    }
    if (res.className && !items.has(res.className)) {
      items.set(res.className, res);
    }
  }

  const recipes = new Map<string, GameRecipe>();
  for (const [key, recipe] of Object.entries(gameData.recipes ?? {})) {
    recipes.set(key, recipe);
    if (recipe.className) {
      recipes.set(recipe.className, recipe);
    }
  }

  const buildings = new Map<string, GameBuilding>();
  for (const [key, building] of Object.entries(gameData.buildings ?? {})) {
    buildings.set(key, building);
    if (building.className) {
      buildings.set(building.className, building);
    }
  }

  return { items, recipes, buildings };
}

export function isFluidForm(form: string | undefined): boolean {
  return form === "liquid" || form === "gas";
}

export function resolveItemDisplayName(index: GameDataIndex, itemClass: string): string {
  const found = index.items.get(itemClass)?.displayName?.trim();
  return found || humaniseClassName(itemClass);
}

export function resolveBuildingDisplayName(
  index: GameDataIndex,
  buildingClass: string,
): string {
  const found = index.buildings.get(buildingClass)?.displayName?.trim();
  return found || humaniseClassName(buildingClass);
}
