import { describe, expect, it, vi } from "vitest";
import {
  buildSaveSnapshot,
  createSaveSource,
  FicsitAIApiError,
  PUBLIC_API_VERSION,
  V01_METRICS,
} from "../src/index.js";
import type {
  ActorNode,
  ForemanPackages,
  GameData,
  SaveGraph,
  SavePowerCircuit,
  SaveState,
  WorldLocations,
} from "../src/types.js";

function createTestGameData(): GameData {
  return {
    items: {
      Desc_OreIron_C: { className: "Desc_OreIron_C", displayName: "Iron Ore", form: "solid" },
      Desc_IronIngot_C: { className: "Desc_IronIngot_C", displayName: "Iron Ingot", form: "solid" },
      Desc_IronPlate_C: { className: "Desc_IronPlate_C", displayName: "Iron Plate", form: "solid" },
      Desc_Coal_C: { className: "Desc_Coal_C", displayName: "Coal", form: "solid" },
      Desc_Water_C: { className: "Desc_Water_C", displayName: "Water", form: "liquid" },
      Desc_LiquidOil_C: { className: "Desc_LiquidOil_C", displayName: "Crude Oil", form: "liquid" },
      Desc_Plastic_C: { className: "Desc_Plastic_C", displayName: "Plastic", form: "solid" },
      Desc_HeavyOilResidue_C: {
        className: "Desc_HeavyOilResidue_C",
        displayName: "Heavy Oil Residue",
        form: "liquid",
      },
    },
    resources: {
      Desc_OreIron_C: { className: "Desc_OreIron_C", displayName: "Iron Ore", form: "solid" },
      Desc_Water_C: { className: "Desc_Water_C", displayName: "Water", form: "liquid" },
    },
    recipes: {
      Recipe_IngotIron_C: {
        className: "Recipe_IngotIron_C",
        displayName: "Iron Ingot",
        ingredients: [
          {
            itemClassName: "Desc_OreIron_C",
            displayName: "Iron Ore",
            amount: 1,
            perMinute: 30,
            unit: "items",
          },
        ],
        products: [
          {
            itemClassName: "Desc_IronIngot_C",
            displayName: "Iron Ingot",
            amount: 1,
            perMinute: 30,
            unit: "items",
          },
        ],
      },
      Recipe_IronPlate_C: {
        className: "Recipe_IronPlate_C",
        displayName: "Iron Plate",
        ingredients: [
          {
            itemClassName: "Desc_IronIngot_C",
            displayName: "Iron Ingot",
            amount: 3,
            perMinute: 30,
            unit: "items",
          },
        ],
        products: [
          {
            itemClassName: "Desc_IronPlate_C",
            displayName: "Iron Plate",
            amount: 2,
            perMinute: 20,
            unit: "items",
          },
        ],
      },
      Recipe_Plastic_C: {
        className: "Recipe_Plastic_C",
        displayName: "Plastic",
        ingredients: [
          {
            itemClassName: "Desc_LiquidOil_C",
            displayName: "Crude Oil",
            amount: 3,
            perMinute: 30,
            unit: "m³",
          },
        ],
        products: [
          {
            itemClassName: "Desc_Plastic_C",
            displayName: "Plastic",
            amount: 2,
            perMinute: 20,
            unit: "items",
          },
          {
            itemClassName: "Desc_HeavyOilResidue_C",
            displayName: "Heavy Oil Residue",
            amount: 1,
            perMinute: 10,
            unit: "m³",
          },
        ],
      },
    },
    buildings: {
      Build_GeneratorCoal_C: {
        className: "Build_GeneratorCoal_C",
        displayName: "Coal-Powered Generator",
        powerConsumption: 0,
        powerProduction: 75,
      },
      Build_GeneratorGeoThermal_C: {
        className: "Build_GeneratorGeoThermal_C",
        displayName: "Geothermal Generator",
        powerConsumption: 0,
        powerProduction: 200,
        variablePowerProduction: true,
      },
      Build_MinerMk1_C: {
        className: "Build_MinerMk1_C",
        displayName: "Miner Mk.1",
        powerConsumption: 5,
        extractionRatePerMin: 60,
      },
      Build_WaterPump_C: {
        className: "Build_WaterPump_C",
        displayName: "Water Extractor",
        powerConsumption: 20,
        extractionRatePerMin: 120,
      },
      Build_SmelterMk1_C: {
        className: "Build_SmelterMk1_C",
        displayName: "Smelter",
        powerConsumption: 4,
      },
      Build_ConstructorMk1_C: {
        className: "Build_ConstructorMk1_C",
        displayName: "Constructor",
        powerConsumption: 4,
      },
      Build_OilRefinery_C: {
        className: "Build_OilRefinery_C",
        displayName: "Refinery",
        powerConsumption: 30,
      },
      Build_PowerStorageMk1_C: {
        className: "Build_PowerStorageMk1_C",
        displayName: "Power Storage",
        powerConsumption: 0,
      },
      Build_ConveyorBeltMk1_C: {
        className: "Build_ConveyorBeltMk1_C",
        displayName: "Conveyor Belt Mk.1",
        powerConsumption: 0,
        conveyorSpeedPerMin: 60,
      },
    },
  };
}

function createFakeGraph(state: SaveState): SaveGraph {
  const actorMap = new Map<string, ActorNode>();
  for (const p of state.production.producers) {
    actorMap.set(p.instanceName, {
      instanceName: p.instanceName,
      classKey: p.buildingClass,
      kind: "producer",
      producer: p,
    });
  }
  for (const e of state.production.extractors) {
    actorMap.set(e.instanceName, {
      instanceName: e.instanceName,
      classKey: e.buildingClass,
      kind: "extractor",
      extractor: e,
    });
  }
  for (const g of state.production.generators) {
    actorMap.set(g.instanceName, {
      instanceName: g.instanceName,
      classKey: g.buildingClass,
      kind: "generator",
      generator: g,
    });
  }
  for (const b of state.production.batteries) {
    actorMap.set(b.instanceName, {
      instanceName: b.instanceName,
      classKey: b.buildingClass,
      kind: "building",
      battery: b,
    });
  }
  for (const bld of state.topology.buildables) {
    if (!actorMap.has(bld.instanceName)) {
      actorMap.set(bld.instanceName, {
        instanceName: bld.instanceName,
        classKey: bld.classKey,
        kind: "building",
      });
    }
  }

  return {
    getActor: (id) => actorMap.get(id),
    actorsByKind: (kind) => [...actorMap.values()].filter((a) => a.kind === kind),
    powerCircuits: () => state.topology.powerCircuits,
    powerCircuitOf: (id) =>
      state.topology.powerCircuits.find((c) => c.members.includes(id)),
    flowEdges: () => [
      { from: "miner_1", to: "belt_1", kind: "conveyor" },
      { from: "belt_1", to: "smelter_1", kind: "conveyor" },
    ],
  };
}

function createTestSaveState(): SaveState {
  return {
    saveName: "alpha-base",
    sessionName: "Alpha Session",
    playDurationSeconds: 1234,
    creativeMode: { noPower: false },
    advancedGameSettings: { powerConsumptionMultiplier: 1 },
    production: {
      producers: [
        {
          instanceName: "smelter_1",
          buildingClass: "Build_SmelterMk1_C",
          recipeClass: "Recipe_IngotIron_C",
          clockSpeed: 1,
          productionBoost: 2,
        },
        {
          instanceName: "ctor_1",
          buildingClass: "Build_ConstructorMk1_C",
          recipeClass: "Recipe_IronPlate_C",
          clockSpeed: 1,
          productionBoost: 1,
        },
        {
          instanceName: "refinery_1",
          buildingClass: "Build_OilRefinery_C",
          recipeClass: "Recipe_Plastic_C",
          clockSpeed: 2,
          productionBoost: 1,
        },
      ],
      extractors: [
        {
          instanceName: "miner_1",
          buildingClass: "Build_MinerMk1_C",
          clockSpeed: 1,
          productionBoost: 1,
          location: { x: 100, y: 100, z: 0 },
        },
        {
          instanceName: "water_1",
          buildingClass: "Build_WaterPump_C",
          clockSpeed: 1,
          productionBoost: 1,
        },
      ],
      generators: [
        {
          instanceName: "coal_gen_1",
          buildingClass: "Build_GeneratorCoal_C",
          clockSpeed: 1,
          fuelClass: "Desc_Coal_C",
        },
        {
          instanceName: "coal_gen_idle",
          buildingClass: "Build_GeneratorCoal_C",
          clockSpeed: 1,
        },
        {
          instanceName: "geo_gen_1",
          buildingClass: "Build_GeneratorGeoThermal_C",
          clockSpeed: 1,
        },
      ],
      batteries: [
        {
          instanceName: "batt_1",
          buildingClass: "Build_PowerStorageMk1_C",
          chargeMWh: 50,
        },
        {
          instanceName: "batt_2",
          buildingClass: "Build_PowerStorageMk1_C",
          chargeMWh: 40,
        },
      ],
    },
    topology: {
      buildables: [
        { instanceName: "belt_1", classKey: "Build_ConveyorBeltMk1_C" },
      ],
      powerCircuits: [
        // Сеть 1 (профицит + батарея): 75 MW генерация, 5 + 16 MW потребление -> зарядка 50->100 MWh за 54 MW
        {
          circuitId: 1,
          members: ["coal_gen_1", "coal_gen_idle", "miner_1", "smelter_1", "batt_1"],
        },
        // Сеть 2 (дефицит + батарея): 75 MW нет генерации? Ставим Geo (0 в capacity) + ctor_1 (4 MW), батарея 40 MWh -> разряд 4 MW
        {
          circuitId: 2,
          members: ["geo_gen_1", "ctor_1", "batt_2"],
        },
        // Сеть 3 (нет батарей, перегрузка): WaterPump (20 MW) + Refinery@200% (75 MW) -> fuse_tripped = 1
        {
          circuitId: 3,
          members: ["water_1", "refinery_1"],
        },
      ] satisfies SavePowerCircuit[],
    },
    resourceNodeOverrides: [
      {
        position: { x: 120, y: 100, z: 0 },
        resourceClass: "Desc_OreIron_C",
        purity: "pure",
      },
    ],
  };
}

function createMockSource(options?: {
  state?: SaveState;
  gameData?: GameData;
  world?: WorldLocations;
  exists?: boolean;
  mtimeMs?: () => number;
  sourceMode?: "save" | "saveEstimated";
  expectedApiVersion?: string;
  onParse?: () => void;
  solveFlow?: (n: unknown) => { delivered: Record<string, Record<string, number>>; throughput: Record<string, number>; cyclic: string[] };
}) {
  const gameData = options?.gameData ?? createTestGameData();
  const world: WorldLocations = options?.world ?? {
    resourceNodes: [
      {
        id: "node_iron_impure",
        kind: "resourceNode",
        resourceClass: "Desc_OreIron_C",
        purity: "impure",
        x: 100,
        y: 100,
        z: 0,
      },
    ],
  };

  const packages: ForemanPackages = {
    parseSaveFile: () => {
      options?.onParse?.();
      return {};
    },
    normaliseSave: () => ({
      state: options?.state ?? createTestSaveState(),
      warnings: [],
    }),
    statMtimeMs: () => (options?.mtimeMs ? options.mtimeMs() : 1000),
    WATER_EXTRACTOR: /^Build_WaterPump/,
    WATER_ITEM_CLASS: "Desc_Water_C",
    buildSaveGraph: (s) => createFakeGraph(s),
    loadDataset: () => ({ gameData, world }),
    flowModule: options?.solveFlow ? { solveFlow: options.solveFlow } : undefined,
  };

  return createSaveSource({
    saveDataDir: "/tmp/fake-saves",
    saveId: "alpha-base",
    ...(options?.sourceMode !== undefined ? { sourceMode: options.sourceMode } : {}),
    ...(options?.expectedApiVersion !== undefined
      ? { expectedApiVersion: options.expectedApiVersion }
      : {}),
    deps: {
      loadForemanPackages: async () => packages,
      fileExists: async () => options?.exists ?? true,
    },
  });
}

describe("SaveSource contract and metrics (Public API v0 0.4.0)", () => {
  it("reports healthy GetStatus and handles missing file gracefully as inert", async () => {
    const okSource = createMockSource();
    const okStatus = await okSource.getStatus();
    expect(okStatus).toEqual({
      apiVersion: PUBLIC_API_VERSION,
      saveId: "alpha-base",
      source: "save",
      inert: false,
      lastSnapshotSessionTimeSec: 1234,
      sidecarConnected: false,
      apiVersionMismatch: "",
      reason: "",
    });

    const missingSource = createMockSource({ exists: false });
    const missingStatus = await missingSource.getStatus();
    expect(missingStatus.inert).toBe(false);
    expect(missingStatus.lastSnapshotSessionTimeSec).toBe(0);
    expect(missingStatus.reason).toContain("Save file not found");
  });

  it("discovers all 20 v0.1 metrics with exact metadata and hasSeries=false", async () => {
    const source = createMockSource();
    const list = await source.listMetrics();
    expect(list.nextCursor).toBe("");
    expect(list.metrics).toHaveLength(20);

    const ids = list.metrics.map((m) => m.id);
    expect(ids).toEqual(V01_METRICS.map((m) => m.id));
    for (const metric of list.metrics) {
      expect(metric.hasSeries).toBe(false);
    }
  });

  it("computes factory, powerNetwork, battery, fuse and machineType metrics accurately", async () => {
    const source = createMockSource();

    // Сеть 1: coal_gen_1 (75 MW) + coal_gen_idle (не работает: capacity += 75, prod += 0)
    // Потребители: miner_1 (5 MW) + smelter_1 (4 * 2^2 = 16 MW) = 21 MW
    expect((await source.queryMetric({ metricId: "power.network.production", scopeId: "1" })).value).toBe(75);
    expect((await source.queryMetric({ metricId: "power.network.capacity", scopeId: "1" })).value).toBe(150);
    expect((await source.queryMetric({ metricId: "power.network.consumption", scopeId: "1" })).value).toBe(21);
    expect((await source.queryMetric({ metricId: "power.network.fuse_tripped", scopeId: "1" })).value).toBe(0);
    expect((await source.queryMetric({ metricId: "power.network.battery_charge", scopeId: "1" })).value).toBe(50);
    expect((await source.queryMetric({ metricId: "power.network.battery_output", scopeId: "1" })).value).toBe(0);
    // Недостающие 50 MWh при скорости 54 MW = 3600 * 50 / 54 = 3333 сек
    expect(await source.queryMetric({ metricId: "power.network.battery_time_to_full", scopeId: "1" })).toMatchObject({
      state: "value",
      value: 3333,
    });
    expect(await source.queryMetric({ metricId: "power.network.battery_time_to_empty", scopeId: "1" })).toMatchObject({
      state: "notApplicable",
      value: null,
    });

    // Сеть 2: геотермальный (переменная мощность) и конструктор (4 MW), батарея 40 MWh
    // Так как выработка геотермального генератора неизвестна в статике:
    // production, capacity, fuse_tripped, battery_output, battery_time_to_empty/full -> notApplicable
    expect((await source.queryMetric({ metricId: "power.network.consumption", scopeId: "2" })).value).toBe(4);
    expect(await source.queryMetric({ metricId: "power.network.production", scopeId: "2" })).toMatchObject({
      state: "notApplicable",
      value: null,
    });
    expect(await source.queryMetric({ metricId: "power.network.capacity", scopeId: "2" })).toMatchObject({
      state: "notApplicable",
      value: null,
    });
    expect(await source.queryMetric({ metricId: "power.network.fuse_tripped", scopeId: "2" })).toMatchObject({
      state: "notApplicable",
      value: null,
    });
    expect(await source.queryMetric({ metricId: "power.network.battery_output", scopeId: "2" })).toMatchObject({
      state: "notApplicable",
      value: null,
    });
    expect(await source.queryMetric({ metricId: "power.network.battery_time_to_empty", scopeId: "2" })).toMatchObject({
      state: "notApplicable",
      value: null,
    });
    expect(await source.queryMetric({ metricId: "power.network.battery_time_to_full", scopeId: "2" })).toMatchObject({
      state: "notApplicable",
      value: null,
    });
    expect((await source.queryMetric({ metricId: "power.network.battery_charge", scopeId: "2" })).value).toBe(40);

    // Сеть 3: нет батарей (все 4 поля NotApplicable), fuse_tripped = 1
    // WaterPump (20) + Refinery (30 * 2^1.321928 = 75) = 95 MW
    expect((await source.queryMetric({ metricId: "power.network.consumption", scopeId: "3" })).value).toBe(95);
    expect((await source.queryMetric({ metricId: "power.network.max_consumption", scopeId: "3" })).value).toBe(95);
    expect((await source.queryMetric({ metricId: "power.network.fuse_tripped", scopeId: "3" })).value).toBe(1);
    for (const metricId of [
      "power.network.battery_charge",
      "power.network.battery_output",
      "power.network.battery_time_to_empty",
      "power.network.battery_time_to_full",
    ]) {
      expect(await source.queryMetric({ metricId, scopeId: "3" })).toMatchObject({
        state: "notApplicable",
        value: null,
      });
    }

    // Итоги по фабрике (75 MW постоянной генерации от Сети 1)
    expect((await source.queryMetric({ metricId: "power.production" })).value).toBe(75);
    expect((await source.queryMetric({ metricId: "power.consumption" })).value).toBe(120);

    // Генераторы по типам (MachineType)
    expect((await source.queryMetric({ metricId: "generators.total", scopeId: "Build_GeneratorCoal_C" })).value).toBe(2);
    expect((await source.queryMetric({ metricId: "generators.running", scopeId: "Build_GeneratorCoal_C" })).value).toBe(1);
    expect((await source.queryMetric({ metricId: "generators.production", scopeId: "Build_GeneratorCoal_C" })).value).toBe(75);
    expect((await source.queryMetric({ metricId: "generators.running", scopeId: "Build_GeneratorGeoThermal_C" })).value).toBe(1);
    expect(await source.queryMetric({ metricId: "generators.production", scopeId: "Build_GeneratorGeoThermal_C" })).toMatchObject({
      state: "notApplicable",
      value: null,
    });
  });

  it("correctly models battery discharge under deficit and trips fuse if discharge limit is exceeded", async () => {
    const state: SaveState = {
      saveName: "batt-deficit",
      playDurationSeconds: 100,
      creativeMode: { noPower: false },
      advancedGameSettings: { powerConsumptionMultiplier: 1 },
      production: {
        producers: [
          {
            instanceName: "ref_deficit",
            buildingClass: "Build_OilRefinery_C",
            recipeClass: "Recipe_Plastic_C",
            clockSpeed: 1,
            productionBoost: 1,
          },
          {
            instanceName: "ref_overload_1",
            buildingClass: "Build_OilRefinery_C",
            recipeClass: "Recipe_Plastic_C",
            clockSpeed: 2,
            productionBoost: 1,
          },
          {
            instanceName: "ref_overload_2",
            buildingClass: "Build_OilRefinery_C",
            recipeClass: "Recipe_Plastic_C",
            clockSpeed: 2,
            productionBoost: 1,
          },
        ],
        extractors: [],
        generators: [
          {
            instanceName: "coal_gen_d1",
            buildingClass: "Build_GeneratorCoal_C",
            clockSpeed: 1,
            fuelClass: "Desc_Coal_C",
          },
        ],
        batteries: [
          {
            instanceName: "batt_ok",
            buildingClass: "Build_PowerStorageMk1_C",
            chargeMWh: 50,
          },
          {
            instanceName: "batt_capped",
            buildingClass: "Build_PowerStorageMk1_C",
            chargeMWh: 50,
          },
          {
            instanceName: "batt_empty",
            buildingClass: "Build_PowerStorageMk1_C",
            chargeMWh: 0,
          },
        ],
      },
      topology: {
        buildables: [],
        powerCircuits: [
          // Сеть 10: Генерация 75 MW, потребление 30 + 75 = 105 MW. Дефицит 30 MW <= 100 MW (1 батарея).
          {
            circuitId: 10,
            members: ["coal_gen_d1", "ref_deficit", "ref_overload_1", "batt_ok"],
          },
          // Сеть 20: 0 генерации, потребление 75 + 75 = 150 MW. Дефицит 150 MW > 100 MW (1 батарея).
          {
            circuitId: 20,
            members: ["ref_overload_1", "ref_overload_2", "batt_capped"],
          },
          // Сеть 30: 0 генерации, потребление 30 MW, батарея пуста.
          {
            circuitId: 30,
            members: ["ref_deficit", "batt_empty"],
          },
        ],
      },
      resourceNodeOverrides: [],
    };

    const source = createMockSource({ state });

    // Сеть 10: дефицит покрыт, fuseTripped = 0, output = 30, timeToEmpty = 3600*50/30 = 6000
    expect((await source.queryMetric({ metricId: "power.network.fuse_tripped", scopeId: "10" })).value).toBe(0);
    expect((await source.queryMetric({ metricId: "power.network.battery_output", scopeId: "10" })).value).toBe(30);
    expect(await source.queryMetric({ metricId: "power.network.battery_time_to_empty", scopeId: "10" })).toMatchObject({
      state: "value",
      value: 6000,
    });

    // Сеть 20: дефицит 150 MW превышает лимит батареи 100 MW -> fuseTripped = 1, output = 100, time = 1800
    expect((await source.queryMetric({ metricId: "power.network.fuse_tripped", scopeId: "20" })).value).toBe(1);
    expect((await source.queryMetric({ metricId: "power.network.battery_output", scopeId: "20" })).value).toBe(100);
    expect(await source.queryMetric({ metricId: "power.network.battery_time_to_empty", scopeId: "20" })).toMatchObject({
      state: "value",
      value: 1800,
    });

    // Сеть 30: батарея пуста -> fuseTripped = 1, output = 0, time = notApplicable
    expect((await source.queryMetric({ metricId: "power.network.fuse_tripped", scopeId: "30" })).value).toBe(1);
    expect((await source.queryMetric({ metricId: "power.network.battery_output", scopeId: "30" })).value).toBe(0);
    expect(await source.queryMetric({ metricId: "power.network.battery_time_to_empty", scopeId: "30" })).toMatchObject({
      state: "notApplicable",
      value: null,
    });
  });

  it("splits solid items vs fluids and applies Somersloop + ResourceNodeOverride", async () => {
    const source = createMockSource();

    // Miner Mk1 (60/min) на узле с override purity="pure" (x2 = 120) и 0 потребл.
    // Smelter потребляет 30/min IronOre -> balance = 90
    expect((await source.queryMetric({ metricId: "items.produced", scopeId: "Desc_OreIron_C" })).value).toBe(120);
    expect((await source.queryMetric({ metricId: "items.consumed", scopeId: "Desc_OreIron_C" })).value).toBe(30);
    expect((await source.queryMetric({ metricId: "items.balance", scopeId: "Desc_OreIron_C" })).value).toBe(90);

    // Smelter с productionBoost=2 производит 60/min IronIngot, а Constructor потребляет 30/min
    expect((await source.queryMetric({ metricId: "items.produced", scopeId: "Desc_IronIngot_C" })).value).toBe(60);
    expect((await source.queryMetric({ metricId: "items.consumed", scopeId: "Desc_IronIngot_C" })).value).toBe(30);

    // Refinery @ clockSpeed=2 -> Oil consumed 60 m³/min, Plastic produced 40 items/min, HeavyOilResidue 20 m³/min
    expect((await source.queryMetric({ metricId: "fluids.consumed", scopeId: "Desc_LiquidOil_C" })).value).toBe(60);
    expect((await source.queryMetric({ metricId: "fluids.produced", scopeId: "Desc_HeavyOilResidue_C" })).value).toBe(20);
    expect((await source.queryMetric({ metricId: "fluids.produced", scopeId: "Desc_Water_C" })).value).toBe(120);
    expect((await source.queryMetric({ metricId: "items.produced", scopeId: "Desc_Plastic_C" })).value).toBe(40);

    // Жидкость не должна попадать в items.*, твёрдый предмет — в fluids.*
    await expect(
      source.queryMetric({ metricId: "items.produced", scopeId: "Desc_Water_C" }),
    ).rejects.toMatchObject({ code: "SCOPE_NOT_FOUND" });
    await expect(
      source.queryMetric({ metricId: "fluids.produced", scopeId: "Desc_Plastic_C" }),
    ).rejects.toMatchObject({ code: "SCOPE_NOT_FOUND" });
  });

  it("supports saveEstimated mode using sf-flow throughput reconciliation", async () => {
    const source = createMockSource({
      sourceMode: "saveEstimated",
      solveFlow: () => ({
        delivered: {},
        throughput: {
          miner_1: 0.5, // ограничение конвейером Mk1 (60 вместо 120)
          smelter_1: 1,
        },
        cyclic: [],
      }),
    });

    const res = await source.queryMetric({
      metricId: "items.produced",
      scopeId: "Desc_OreIron_C",
    });
    expect(res.source).toBe("saveEstimated");
    expect(res.value).toBe(60);
  });

  it("caches parsed snapshots by mtimeMs and reloads on change", async () => {
    let mtime = 5000;
    const parseSpy = vi.fn();
    const source = createMockSource({
      mtimeMs: () => mtime,
      onParse: parseSpy,
    });

    await source.queryMetric({ metricId: "power.production" });
    await source.queryMetric({ metricId: "power.consumption" });
    expect(parseSpy).toHaveBeenCalledTimes(1);

    mtime = 5001;
    await source.queryMetric({ metricId: "power.production" });
    expect(parseSpy).toHaveBeenCalledTimes(2);
  });

  it("validates pagination (>50 scopes), cursors, filters and all contract errors", async () => {
    // Генерируем 65 уникальных предметов для проверки обрезания > 50 scopes
    const gameData = createTestGameData();
    const producers = [];
    for (let i = 0; i < 65; i += 1) {
      const idx = String(i).padStart(2, "0");
      const itemClass = `Desc_TestItem_${idx}_C`;
      const recipeClass = `Recipe_Test_${idx}_C`;
      gameData.items[itemClass] = {
        className: itemClass,
        displayName: `Test Item ${idx}`,
        form: "solid",
      };
      gameData.recipes[recipeClass] = {
        className: recipeClass,
        displayName: `Test ${idx}`,
        ingredients: [],
        products: [
          {
            itemClassName: itemClass,
            displayName: `Test Item ${idx}`,
            amount: 1,
            perMinute: 10,
            unit: "items",
          },
        ],
      };
      producers.push({
        instanceName: `prod_${idx}`,
        buildingClass: "Build_ConstructorMk1_C",
        recipeClass,
        clockSpeed: 1,
        productionBoost: 1,
      });
    }

    const base = createTestSaveState();
    base.production.producers = producers;
    base.production.extractors = [];
    const source = createMockSource({ state: base, gameData });

    const first = await source.listMetrics({ metricId: "items.produced" });
    expect(first.metrics).toHaveLength(1);
    expect(first.metrics[0]?.availableScopes).toHaveLength(50);
    expect(first.metrics[0]?.scopesTruncated).toBe(true);
    expect(first.nextScopeCursor).toMatch(/^s_/);

    const second = await source.listMetrics({
      metricId: "items.produced",
      scopeCursor: first.nextScopeCursor,
    });
    expect(second.metrics[0]?.availableScopes).toHaveLength(15);
    expect(second.metrics[0]?.scopesTruncated).toBe(false);
    expect(second.nextScopeCursor).toBe("");

    // Пагинация метрик с pageSize=5
    const page1 = await source.listMetrics({ pageSize: 5 });
    expect(page1.metrics).toHaveLength(5);
    expect(page1.nextCursor).toMatch(/^m_/);

    // Смешивание курсоров должно отклоняться
    await expect(
      source.listMetrics({ cursor: first.nextScopeCursor }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(
      source.listMetrics({ metricId: "items.produced", scopeCursor: page1.nextCursor }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(
      source.listScopes({ metricId: "items.produced", cursor: page1.nextCursor }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });

    // scopeFilter/scopeCursor без metricId
    await expect(
      source.listMetrics({ scopeFilter: "Iron" }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });

    // Границы pageSize
    await expect(source.listMetrics({ pageSize: 0 })).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
    });
    await expect(source.listMetrics({ pageSize: 201 })).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
    });

    // Неизвестная метрика, пропущенный/лишний scopeId, SERIES_NOT_AVAILABLE
    await expect(
      source.queryMetric({ metricId: "no.such.metric" }),
    ).rejects.toMatchObject({ code: "UNKNOWN_METRIC" });
    await expect(
      source.queryMetric({ metricId: "power.production", scopeId: "1" }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(
      source.queryMetric({ metricId: "power.network.production" }),
    ).rejects.toMatchObject({ code: "SCOPE_REQUIRED" });
    await expect(
      source.querySeries({ metricId: "power.production", window: "last5Min" }),
    ).rejects.toMatchObject({ code: "SERIES_NOT_AVAILABLE" });

    // Проверка API_VERSION_MISMATCH и path traversal saveId
    const mismatchSource = createMockSource({ expectedApiVersion: "0.3.0" });
    await expect(mismatchSource.queryMetric({ metricId: "power.production" })).rejects.toBeInstanceOf(
      FicsitAIApiError,
    );
    await expect(
      mismatchSource.queryMetric({ metricId: "power.production" }),
    ).rejects.toMatchObject({ code: "API_VERSION_MISMATCH" });

    const traversalSource = createSaveSource({
      saveDataDir: "/tmp/saves",
      saveId: "../secret",
    });
    await expect(traversalSource.listMetrics()).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
    });
  });
});
