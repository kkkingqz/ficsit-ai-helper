import { GameDataIndex, isFluidForm, resolveBuildingDisplayName, resolveItemDisplayName } from "./foreman.js";
import {
  ActorNode,
  FlowEdgeInput,
  FlowNodeInput,
  FlowSolverModule,
  ForemanPackages,
  GameBuilding,
  Purity,
  RateMap,
  ResourceNodeOverride,
  SaveDataSourceMode,
  SaveGraph,
  SaveState,
  SaveVector3,
  ScopeRef,
  ValueState,
  WorldLocations,
  WorldResourceNode,
} from "./types.js";

const OVERCLOCK_POWER_EXPONENT = 1.321928;
const NODE_MATCH_CM = 2000;
const BATTERY_MK1_CAPACITY_MWH = 100;
const BATTERY_MK1_MAX_CHARGE_MW = 100;
const BATTERY_MK1_MAX_DISCHARGE_MW = 100;

const PURITY_MULTIPLIER: Record<Purity, number> = {
  impure: 0.5,
  normal: 1.0,
  pure: 2.0,
};

export interface MetricSample {
  state: ValueState;
  value: number | null;
}

export interface CircuitSnapshot {
  scope: ScopeRef;
  production: MetricSample;
  consumptionMW: number;
  capacity: MetricSample;
  maxConsumptionMW: number;
  fuseTripped: MetricSample;
  batteryCharge: MetricSample;
  batteryOutput: MetricSample;
  batteryTimeToEmpty: MetricSample;
  batteryTimeToFull: MetricSample;
}

export interface GeneratorTypeSnapshot {
  scope: ScopeRef;
  total: number;
  running: number;
  production: MetricSample;
}

export interface ItemRateSnapshot {
  scope: ScopeRef;
  produced: number;
  consumed: number;
  balance: number;
}

export interface SaveSnapshot {
  saveId: string;
  source: SaveDataSourceMode;
  sessionTimeSec: number;
  mtimeMs: number;
  factory: {
    powerProduction: MetricSample;
    powerConsumptionMW: number;
  };
  powerNetworks: ReadonlyMap<string, CircuitSnapshot>;
  powerNetworkScopes: readonly ScopeRef[];
  generatorTypes: ReadonlyMap<string, GeneratorTypeSnapshot>;
  generatorTypeScopes: readonly ScopeRef[];
  solidItems: ReadonlyMap<string, ItemRateSnapshot>;
  solidItemScopes: readonly ScopeRef[];
  fluidItems: ReadonlyMap<string, ItemRateSnapshot>;
  fluidItemScopes: readonly ScopeRef[];
}

export function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function clockFactor(clockSpeed: number, productionBoost: number): number {
  const clock = Math.max(0, clockSpeed || 1);
  const boost = Math.max(1, productionBoost || 1);
  return clock ** OVERCLOCK_POWER_EXPONENT * (boost > 1 ? boost ** 2 : 1);
}

function generatorCapacityMW(
  building: GameBuilding | undefined,
  clockSpeed: number,
): number {
  if (!building || building.variablePowerProduction || !building.powerProduction) {
    return 0;
  }
  return roundTo(building.powerProduction * Math.max(0, clockSpeed || 1), 1);
}

function isGeneratorRunning(
  buildingClass: string,
  fuelClass: string | undefined,
  index: GameDataIndex,
): boolean {
  const building = index.buildings.get(buildingClass);
  return fuelClass !== undefined || building?.variablePowerProduction === true;
}

function actorPowerDrawMW(
  actor: ActorNode,
  index: GameDataIndex,
  powerMul: number,
): { active: number; max: number } {
  if (powerMul <= 0) {
    return { active: 0, max: 0 };
  }

  if (actor.kind === "producer" && actor.producer) {
    const prod = actor.producer;
    const building = index.buildings.get(prod.buildingClass);
    if (!building) {
      return { active: 0, max: 0 };
    }
    const recipe = prod.recipeClass ? index.recipes.get(prod.recipeClass) : undefined;
    const baseActive =
      building.powerConsumption > 0
        ? building.powerConsumption
        : recipe?.variablePower
          ? (recipe.variablePower.min + recipe.variablePower.max) / 2
          : (building.maxPowerConsumption ?? 0);
    const baseMax =
      building.powerConsumption > 0
        ? building.powerConsumption
        : recipe?.variablePower
          ? recipe.variablePower.max
          : (building.maxPowerConsumption ?? 0);

    const mult = clockFactor(prod.clockSpeed, prod.productionBoost) * powerMul;
    const maxMW = roundTo(baseMax * mult, 1);
    const activeMW = prod.recipeClass ? roundTo(baseActive * mult, 1) : 0;
    return { active: activeMW, max: maxMW };
  }

  if (actor.kind === "extractor" && actor.extractor) {
    const ext = actor.extractor;
    const building = index.buildings.get(ext.buildingClass);
    if (!building) {
      return { active: 0, max: 0 };
    }
    const mult = clockFactor(ext.clockSpeed, ext.productionBoost) * powerMul;
    const mw = roundTo(building.powerConsumption * mult, 1);
    return { active: mw, max: mw };
  }

  if (actor.kind === "building" && !actor.battery) {
    const building = index.buildings.get(actor.classKey);
    if (building && building.powerConsumption > 0 && !building.powerProduction) {
      const mw = roundTo(building.powerConsumption * powerMul, 1);
      return { active: mw, max: mw };
    }
  }

  return { active: 0, max: 0 };
}

function buildBatteryMetrics(
  batteryCount: number,
  chargeMWh: number,
  productionMW: number,
  consumptionMW: number,
  powerMul: number,
): {
  batteryCharge: MetricSample;
  batteryOutput: MetricSample;
  batteryTimeToEmpty: MetricSample;
  batteryTimeToFull: MetricSample;
  fuseTripped: MetricSample;
} {
  const na: MetricSample = { state: "notApplicable", value: null };
  if (batteryCount <= 0) {
    const isTripped = powerMul > 0 && consumptionMW > productionMW ? 1 : 0;
    return {
      batteryCharge: na,
      batteryOutput: na,
      batteryTimeToEmpty: na,
      batteryTimeToFull: na,
      fuseTripped: { state: "value", value: isTripped },
    };
  }

  const totalCapacityMWh = batteryCount * BATTERY_MK1_CAPACITY_MWH;
  const clampedChargeMWh = Math.max(0, Math.min(chargeMWh, totalCapacityMWh));
  const batteryCharge: MetricSample = {
    state: "value",
    value: roundTo((clampedChargeMWh / totalCapacityMWh) * 100, 1),
  };

  if (consumptionMW > productionMW) {
    const deficitMW = roundTo(consumptionMW - productionMW, 1);
    const maxDischargeMW = batteryCount * BATTERY_MK1_MAX_DISCHARGE_MW;

    if (clampedChargeMWh > 0) {
      const dischargeMW = roundTo(Math.min(deficitMW, maxDischargeMW), 1);
      const isTripped = powerMul > 0 && deficitMW > maxDischargeMW ? 1 : 0;
      return {
        batteryCharge,
        batteryOutput: { state: "value", value: dischargeMW },
        batteryTimeToEmpty: {
          state: "value",
          value: roundTo((3600 * clampedChargeMWh) / dischargeMW, 0),
        },
        batteryTimeToFull: na,
        fuseTripped: { state: "value", value: isTripped },
      };
    }

    // Батареи пусты при дефиците -> аварийное отключение
    return {
      batteryCharge,
      batteryOutput: { state: "value", value: 0 },
      batteryTimeToEmpty: na,
      batteryTimeToFull: na,
      fuseTripped: { state: "value", value: powerMul > 0 ? 1 : 0 },
    };
  }

  if (productionMW > consumptionMW) {
    const surplusMW = roundTo(productionMW - consumptionMW, 1);
    const maxChargeMW = batteryCount * BATTERY_MK1_MAX_CHARGE_MW;
    const chargeRateMW = Math.min(surplusMW, maxChargeMW);

    return {
      batteryCharge,
      batteryOutput: { state: "value", value: 0 },
      batteryTimeToEmpty: na,
      batteryTimeToFull:
        clampedChargeMWh < totalCapacityMWh && chargeRateMW > 0
          ? {
              state: "value",
              value: roundTo(
                (3600 * (totalCapacityMWh - clampedChargeMWh)) / chargeRateMW,
                0,
              ),
            }
          : na,
      fuseTripped: { state: "value", value: 0 },
    };
  }

  // productionMW === consumptionMW
  return {
    batteryCharge,
    batteryOutput: { state: "value", value: 0 },
    batteryTimeToEmpty: na,
    batteryTimeToFull: na,
    fuseTripped: { state: "value", value: 0 },
  };
}

function computePowerSnapshot(
  state: SaveState,
  graph: SaveGraph,
  index: GameDataIndex,
): {
  powerNetworks: Map<string, CircuitSnapshot>;
  powerNetworkScopes: ScopeRef[];
  factoryProduction: MetricSample;
  factoryConsumptionMW: number;
} {
  const powerMul = state.creativeMode.noPower
    ? 0
    : (state.advancedGameSettings?.powerConsumptionMultiplier ?? 1);

  const powerNetworks = new Map<string, CircuitSnapshot>();
  const powerNetworkScopes: ScopeRef[] = [];
  let factoryProductionMW = 0;
  let factoryConsumptionMW = 0;
  let factoryHasVariableGenerators = false;

  const na: MetricSample = { state: "notApplicable", value: null };
  const circuits = [...graph.powerCircuits()].sort((a, b) => a.circuitId - b.circuitId);

  for (const circuit of circuits) {
    const scopeId = String(circuit.circuitId);
    const scope: ScopeRef = {
      scopeId,
      displayName: `Power Circuit ${circuit.circuitId}`,
    };

    let capacityMW = 0;
    let productionMW = 0;
    let consumptionMW = 0;
    let maxConsumptionMW = 0;
    let batteryCount = 0;
    let batteryChargeMWh = 0;
    let hasVariableGenerators = false;

    for (const memberId of circuit.members) {
      const actor = graph.getActor(memberId);
      if (!actor) {
        continue;
      }

      if (actor.kind === "generator" && actor.generator) {
        const building = index.buildings.get(actor.generator.buildingClass);
        if (building?.variablePowerProduction) {
          hasVariableGenerators = true;
        } else {
          const capMW = generatorCapacityMW(building, actor.generator.clockSpeed);
          capacityMW += capMW;
          if (
            isGeneratorRunning(
              actor.generator.buildingClass,
              actor.generator.fuelClass,
              index,
            )
          ) {
            productionMW += capMW;
          }
        }
        continue;
      }

      if (actor.battery) {
        batteryCount += 1;
        batteryChargeMWh += Math.max(0, actor.battery.chargeMWh);
        continue;
      }

      const draw = actorPowerDrawMW(actor, index, powerMul);
      consumptionMW += draw.active;
      maxConsumptionMW += draw.max;
    }

    capacityMW = roundTo(capacityMW, 1);
    productionMW = roundTo(productionMW, 1);
    consumptionMW = roundTo(consumptionMW, 1);
    maxConsumptionMW = roundTo(maxConsumptionMW, 1);

    const totalBatteryCapacityMWh = batteryCount * BATTERY_MK1_CAPACITY_MWH;
    const clampedChargeMWh = Math.max(
      0,
      Math.min(batteryChargeMWh, totalBatteryCapacityMWh),
    );
    const circuitBatteryCharge: MetricSample =
      batteryCount > 0
        ? {
            state: "value",
            value: roundTo((clampedChargeMWh / totalBatteryCapacityMWh) * 100, 1),
          }
        : na;

    let circuitProduction: MetricSample;
    let circuitCapacity: MetricSample;
    let circuitFuseTripped: MetricSample;
    let circuitBatteryOutput: MetricSample;
    let circuitBatteryTimeToEmpty: MetricSample;
    let circuitBatteryTimeToFull: MetricSample;

    if (hasVariableGenerators) {
      circuitProduction = na;
      circuitCapacity = na;
      circuitFuseTripped = na;
      circuitBatteryOutput = na;
      circuitBatteryTimeToEmpty = na;
      circuitBatteryTimeToFull = na;
    } else {
      circuitProduction = { state: "value", value: productionMW };
      circuitCapacity = { state: "value", value: capacityMW };
      const batt = buildBatteryMetrics(
        batteryCount,
        batteryChargeMWh,
        productionMW,
        consumptionMW,
        powerMul,
      );
      circuitBatteryOutput = batt.batteryOutput;
      circuitBatteryTimeToEmpty = batt.batteryTimeToEmpty;
      circuitBatteryTimeToFull = batt.batteryTimeToFull;
      circuitFuseTripped = batt.fuseTripped;
    }

    powerNetworks.set(scopeId, {
      scope,
      production: circuitProduction,
      consumptionMW,
      capacity: circuitCapacity,
      maxConsumptionMW,
      fuseTripped: circuitFuseTripped,
      batteryCharge: circuitBatteryCharge,
      batteryOutput: circuitBatteryOutput,
      batteryTimeToEmpty: circuitBatteryTimeToEmpty,
      batteryTimeToFull: circuitBatteryTimeToFull,
    });
    powerNetworkScopes.push(scope);

    if (hasVariableGenerators) {
      factoryHasVariableGenerators = true;
    }
    factoryProductionMW += productionMW;
    factoryConsumptionMW += consumptionMW;
  }

  const factoryProduction: MetricSample =
    factoryProductionMW === 0 && factoryHasVariableGenerators
      ? na
      : { state: "value", value: roundTo(factoryProductionMW, 1) };

  return {
    powerNetworks,
    powerNetworkScopes,
    factoryProduction,
    factoryConsumptionMW: roundTo(factoryConsumptionMW, 1),
  };
}

function computeGeneratorTypesSnapshot(
  state: SaveState,
  index: GameDataIndex,
): {
  generatorTypes: Map<string, GeneratorTypeSnapshot>;
  generatorTypeScopes: ScopeRef[];
} {
  const accum = new Map<
    string,
    {
      scope: ScopeRef;
      total: number;
      running: number;
      productionMW: number;
      variableOutput: boolean;
    }
  >();

  for (const gen of state.production.generators) {
    const scopeId = gen.buildingClass;
    const building = index.buildings.get(gen.buildingClass);
    const isVariable = Boolean(building?.variablePowerProduction);

    const existing = accum.get(scopeId) ?? {
      scope: {
        scopeId,
        displayName: resolveBuildingDisplayName(index, gen.buildingClass),
      },
      total: 0,
      running: 0,
      productionMW: 0,
      variableOutput: isVariable,
    };
    existing.total += 1;
    const running = isGeneratorRunning(gen.buildingClass, gen.fuelClass, index);
    if (running) {
      existing.running += 1;
      if (!isVariable) {
        existing.productionMW = roundTo(
          existing.productionMW + generatorCapacityMW(building, gen.clockSpeed),
          1,
        );
      }
    }
    accum.set(scopeId, existing);
  }

  const map = new Map<string, GeneratorTypeSnapshot>();
  for (const [key, entry] of accum.entries()) {
    map.set(key, {
      scope: entry.scope,
      total: entry.total,
      running: entry.running,
      production: entry.variableOutput
        ? { state: "notApplicable", value: null }
        : { state: "value", value: entry.productionMW },
    });
  }

  const generatorTypeScopes = [...map.values()]
    .map((entry) => entry.scope)
    .sort((a, b) => a.scopeId.localeCompare(b.scopeId));

  return {
    generatorTypes: map,
    generatorTypeScopes,
  };
}

function distance3D(a: SaveVector3, b: { x: number; y: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function nearestWorldNode(
  nodes: readonly WorldResourceNode[],
  location: SaveVector3,
): WorldResourceNode | undefined {
  let best: WorldResourceNode | undefined;
  let bestDist = Infinity;
  for (const node of nodes) {
    const d = distance3D(location, node);
    if (d < bestDist) {
      bestDist = d;
      best = node;
    }
  }
  return bestDist <= NODE_MATCH_CM ? best : undefined;
}

function nearestOverride(
  overrides: readonly ResourceNodeOverride[],
  location: SaveVector3,
): ResourceNodeOverride | undefined {
  let best: ResourceNodeOverride | undefined;
  let bestDist = Infinity;
  for (const override of overrides) {
    if (!override.position) {
      continue;
    }
    const d = distance3D(location, override.position);
    if (d < bestDist) {
      bestDist = d;
      best = override;
    }
  }
  return bestDist <= NODE_MATCH_CM ? best : undefined;
}

interface MachineRates {
  supply: RateMap;
  demand: RateMap;
  isFluidByItem: Map<string, boolean>;
}

function computeMachineRates(
  state: SaveState,
  index: GameDataIndex,
  world: WorldLocations,
  waterExtractorRegex: RegExp,
  waterItemClass: string,
): Map<string, MachineRates> {
  const byActor = new Map<string, MachineRates>();
  const worldNodes = world.resourceNodes ?? [];

  for (const prod of state.production.producers) {
    if (!prod.recipeClass) {
      continue;
    }
    const recipe = index.recipes.get(prod.recipeClass);
    if (!recipe) {
      continue;
    }
    const clock = Math.max(0, prod.clockSpeed || 1);
    const boost = Math.max(1, prod.productionBoost || 1);

    const supply: RateMap = {};
    const demand: RateMap = {};
    const isFluidByItem = new Map<string, boolean>();

    for (const output of recipe.products) {
      const rate = output.perMinute * clock * boost;
      supply[output.itemClassName] = (supply[output.itemClassName] ?? 0) + rate;
      const itemDef = index.items.get(output.itemClassName);
      isFluidByItem.set(
        output.itemClassName,
        output.unit === "m³" || isFluidForm(itemDef?.form),
      );
    }

    for (const input of recipe.ingredients) {
      const rate = input.perMinute * clock;
      demand[input.itemClassName] = (demand[input.itemClassName] ?? 0) + rate;
      const itemDef = index.items.get(input.itemClassName);
      isFluidByItem.set(
        input.itemClassName,
        input.unit === "m³" || isFluidForm(itemDef?.form),
      );
    }

    byActor.set(prod.instanceName, { supply, demand, isFluidByItem });
  }

  for (const ext of state.production.extractors) {
    const building = index.buildings.get(ext.buildingClass);
    if (!building?.extractionRatePerMin) {
      continue;
    }
    const clock = Math.max(0, ext.clockSpeed || 1);
    const boost = Math.max(1, ext.productionBoost || 1);

    let resourceClass: string | undefined;
    let purity: Purity = "normal";

    if (waterExtractorRegex.test(ext.buildingClass)) {
      resourceClass = waterItemClass;
    } else if (ext.location) {
      const override = nearestOverride(state.resourceNodeOverrides, ext.location);
      const baseNode = nearestWorldNode(worldNodes, ext.location);
      resourceClass = override?.resourceClass ?? baseNode?.resourceClass ?? undefined;
      purity = override?.purity ?? baseNode?.purity ?? "normal";
    }

    if (!resourceClass) {
      continue;
    }

    const rate =
      building.extractionRatePerMin * PURITY_MULTIPLIER[purity] * clock * boost;
    const itemDef = index.items.get(resourceClass);
    const isFluid =
      resourceClass === waterItemClass || isFluidForm(itemDef?.form);

    byActor.set(ext.instanceName, {
      supply: { [resourceClass]: rate },
      demand: {},
      isFluidByItem: new Map([[resourceClass, isFluid]]),
    });
  }

  return byActor;
}

function estimateFlowThroughputs(
  graph: SaveGraph,
  index: GameDataIndex,
  machineRates: ReadonlyMap<string, MachineRates>,
  flowModule: FlowSolverModule | undefined,
): Map<string, number> {
  const scales = new Map<string, number>();
  if (!flowModule?.solveFlow || !graph.flowEdges) {
    return scales;
  }

  const rawEdges = graph.flowEdges();
  if (rawEdges.length === 0) {
    return scales;
  }

  const nodeIds = new Set<string>();
  const edges: FlowEdgeInput[] = [];

  for (const edge of rawEdges) {
    nodeIds.add(edge.from);
    nodeIds.add(edge.to);

    const fromActor = graph.getActor(edge.from);
    const toActor = graph.getActor(edge.to);
    const caps: number[] = [];

    for (const actor of [fromActor, toActor]) {
      if (!actor) {
        continue;
      }
      const building = index.buildings.get(actor.classKey);
      if (edge.kind === "conveyor" && building?.conveyorSpeedPerMin !== undefined) {
        caps.push(building.conveyorSpeedPerMin);
      }
      if (edge.kind === "pipe" && building?.pipeFlowPerMin !== undefined) {
        caps.push(building.pipeFlowPerMin);
      }
    }

    const capacity = caps.length > 0 ? Math.min(...caps) : Number.POSITIVE_INFINITY;
    const flowEdge: FlowEdgeInput = {
      from: edge.from,
      to: edge.to,
      capacity,
    };

    const splitterRules = graph.splitterRulesOf?.(edge.from);
    if (splitterRules && splitterRules.length > 0) {
      const explicitItems = splitterRules
        .filter((r) => r.rule === "item" && typeof r.itemClass === "string")
        .map((r) => r.itemClass as string);
      if (explicitItems.length > 0 && splitterRules.every((r) => r.rule === "item")) {
        flowEdge.allow = [...new Set(explicitItems)];
      }
    }

    edges.push(flowEdge);
  }

  for (const actorId of machineRates.keys()) {
    nodeIds.add(actorId);
  }

  const nodes: FlowNodeInput[] = [];
  for (const id of nodeIds) {
    const rates = machineRates.get(id);
    if (rates) {
      nodes.push({
        id,
        supply: rates.supply,
        demand: rates.demand,
      });
    } else {
      nodes.push({ id });
    }
  }

  const result = flowModule.solveFlow({ nodes, edges });
  const cyclicSet = new Set(result.cyclic ?? []);

  for (const [actorId, value] of Object.entries(result.throughput ?? {})) {
    if (!cyclicSet.has(actorId) && Number.isFinite(value)) {
      scales.set(actorId, Math.max(0, Math.min(1, value)));
    }
  }

  return scales;
}

function computeProductionSnapshot(
  state: SaveState,
  graph: SaveGraph,
  index: GameDataIndex,
  world: WorldLocations,
  packages: ForemanPackages,
  sourceMode: SaveDataSourceMode,
): {
  solidItems: Map<string, ItemRateSnapshot>;
  solidItemScopes: ScopeRef[];
  fluidItems: Map<string, ItemRateSnapshot>;
  fluidItemScopes: ScopeRef[];
} {
  const machineRates = computeMachineRates(
    state,
    index,
    world,
    packages.WATER_EXTRACTOR,
    packages.WATER_ITEM_CLASS,
  );

  const flowScales =
    sourceMode === "saveEstimated"
      ? estimateFlowThroughputs(graph, index, machineRates, packages.flowModule)
      : new Map<string, number>();

  const solidAccum = new Map<string, { produced: number; consumed: number }>();
  const fluidAccum = new Map<string, { produced: number; consumed: number }>();

  for (const [actorId, rates] of machineRates.entries()) {
    const scale = flowScales.get(actorId) ?? 1;

    for (const [itemClass, rawRate] of Object.entries(rates.supply)) {
      const target = rates.isFluidByItem.get(itemClass) ? fluidAccum : solidAccum;
      const entry = target.get(itemClass) ?? { produced: 0, consumed: 0 };
      entry.produced += rawRate * scale;
      target.set(itemClass, entry);
    }

    for (const [itemClass, rawRate] of Object.entries(rates.demand)) {
      const target = rates.isFluidByItem.get(itemClass) ? fluidAccum : solidAccum;
      const entry = target.get(itemClass) ?? { produced: 0, consumed: 0 };
      entry.consumed += rawRate * scale;
      target.set(itemClass, entry);
    }
  }

  const finalise = (
    accum: Map<string, { produced: number; consumed: number }>,
  ): { map: Map<string, ItemRateSnapshot>; scopes: ScopeRef[] } => {
    const map = new Map<string, ItemRateSnapshot>();
    const scopes: ScopeRef[] = [];
    const sortedIds = [...accum.keys()].sort((a, b) => a.localeCompare(b));

    for (const itemClass of sortedIds) {
      const raw = accum.get(itemClass);
      if (!raw) {
        continue;
      }
      const scope: ScopeRef = {
        scopeId: itemClass,
        displayName: resolveItemDisplayName(index, itemClass),
      };
      const produced = roundTo(raw.produced, 1);
      const consumed = roundTo(raw.consumed, 1);
      const balance = roundTo(raw.produced - raw.consumed, 1);
      map.set(itemClass, { scope, produced, consumed, balance });
      scopes.push(scope);
    }
    return { map, scopes };
  };

  const solids = finalise(solidAccum);
  const fluids = finalise(fluidAccum);

  return {
    solidItems: solids.map,
    solidItemScopes: solids.scopes,
    fluidItems: fluids.map,
    fluidItemScopes: fluids.scopes,
  };
}

/** Строит детерминированный снимок всех 20 метрик v0.1 поверх SaveState, SaveGraph и GameData. */
export function buildSaveSnapshot(params: {
  saveId: string;
  mtimeMs: number;
  state: SaveState;
  graph: SaveGraph;
  index: GameDataIndex;
  world: WorldLocations;
  packages: ForemanPackages;
  sourceMode: SaveDataSourceMode;
}): SaveSnapshot {
  const { saveId, mtimeMs, state, graph, index, world, packages, sourceMode } = params;
  const power = computePowerSnapshot(state, graph, index);
  const generators = computeGeneratorTypesSnapshot(state, index);
  const production = computeProductionSnapshot(
    state,
    graph,
    index,
    world,
    packages,
    sourceMode,
  );

  return {
    saveId: saveId || state.saveName || state.sessionName || "unknown",
    source: sourceMode,
    sessionTimeSec: Math.max(0, Math.round(state.playDurationSeconds ?? 0)),
    mtimeMs,
    factory: {
      powerProduction: power.factoryProduction,
      powerConsumptionMW: power.factoryConsumptionMW,
    },
    powerNetworks: power.powerNetworks,
    powerNetworkScopes: power.powerNetworkScopes,
    generatorTypes: generators.generatorTypes,
    generatorTypeScopes: generators.generatorTypeScopes,
    solidItems: production.solidItems,
    solidItemScopes: production.solidItemScopes,
    fluidItems: production.fluidItems,
    fluidItemScopes: production.fluidItemScopes,
  };
}
