#pragma once

#include "CoreMinimal.h"
#include "Misc/Optional.h"

namespace FicsitAI::Telemetry
{

/**
 * Generator classification.
 */
enum class EFicsitAIGeneratorType : uint8
{
    Standard,
    Coal,
    Fuel,
    Biomass,
    GeoThermal,
    Nuclear,
    Unknown
};

/**
 * Allocation-free POD snapshot of a single generator building.
 * Building identity (BuildingId) is held by the BuildingIndex caller.
 */
struct FGeneratorTelemetryItem
{
    FName ClassName = NAME_None;
    EFicsitAIGeneratorType GeneratorType = EFicsitAIGeneratorType::Unknown;
    int32 CircuitId = -1;

    float ProductionCapacityMW = 0.0f;
    float BaseProductionCapacityMW = 0.0f;
    float CurrentProductionMW = 0.0f;
    float BaseProductionMW = 0.0f;
    float DynamicProductionMW = 0.0f;
    float DynamicProductionCapacityMW = 0.0f;
    float LoadPercentage = 0.0f;

    bool bIsProducing = false;
    bool bCanStartProduction = false;
    bool bHasPower = false;

    // Fuel generator details (AFGBuildableGeneratorFuel and subclasses)
    bool bIsFuelGenerator = false;
    bool bHasFuel = false;
    FName CurrentFuelClass = NAME_None;
    float FuelAmountRatio = 0.0f; // [0.0, 1.0]

    // Supplemental resource details (e.g. water for coal/nuclear generators)
    bool bRequiresSupplemental = false;
    bool bHasSupplemental = false;
    FName SupplementalResourceClass = NAME_None;
    float SupplementalAmountRatio = 0.0f;   // [0.0, 1.0]
    float SupplementalConsumptionRate = 0.0f; // m^3/s

    // Geothermal generator details (AFGBuildableGeneratorGeoThermal)
    bool bIsGeoThermal = false;
    float MinProductionMW = 0.0f;
    float MaxProductionMW = 0.0f;
};

/**
 * Aggregated telemetry computed on a worker thread from generator snapshots.
 */
struct FGeneratorsTelemetryAggregate
{
    int32 TotalGenerators = 0;
    int32 RunningGenerators = 0;
    float TotalProductionCapacityMW = 0.0f;
    float TotalActualProductionMW = 0.0f;

    TMap<FName, int32> CountByClass;
    TMap<FName, float> ProductionByClassMW;
};

/**
 * Power storage status matching EBatteryStatus.
 */
enum class EFicsitAIBatteryStatus : uint8
{
    Idle = 0,
    IdleEmpty,
    IdleFull,
    PowerIn,
    PowerOut,
    Unknown
};

/**
 * Allocation-free POD snapshot of an individual power storage / battery building.
 * Building identity (BuildingId) is held by the BuildingIndex caller.
 */
struct FPowerStorageTelemetryItem
{
    FName ClassName = NAME_None;
    int32 CircuitId = -1;

    float StoredPowerMWh = 0.0f;
    float CapacityMWh = 0.0f;
    float ChargePercentage = 0.0f; // [0.0, 1.0]

    float PowerInputMW = 0.0f;  // Current charging rate in MW
    float PowerOutputMW = 0.0f; // Current discharging rate in MW

    float TimeUntilFullSeconds = 0.0f;
    float TimeUntilEmptySeconds = 0.0f;

    EFicsitAIBatteryStatus BatteryStatus = EFicsitAIBatteryStatus::Unknown;
    bool bHasPower = false;
};

/**
 * Aggregated telemetry computed on a worker thread from power storage snapshots.
 */
struct FPowerStorageTelemetryAggregate
{
    int32 TotalBatteries = 0;
    int32 ChargingBatteries = 0;
    int32 DischargingBatteries = 0;

    float TotalStoredMWh = 0.0f;
    float TotalCapacityMWh = 0.0f;
    float OverallChargePercentage = 0.0f;

    float TotalPowerInputMW = 0.0f;
    float TotalPowerOutputMW = 0.0f;

    // Unset when not actively discharging/charging (metrics-v0.1.md).
    TOptional<float> EstimatedTimeToEmptySeconds;
    TOptional<float> EstimatedTimeToFullSeconds;
};

/**
 * Allocation-free POD snapshot of a circuit switch / breaker.
 * Building identity (BuildingId) is held by the BuildingIndex caller.
 */
struct FCircuitBreakerTelemetryItem
{
    FName ClassName = NAME_None;

    bool bIsSwitchOn = false;
    bool bIsConnected = false;

    int32 CircuitId0 = -1;
    int32 CircuitId1 = -1;

    bool bIsPrioritySwitch = false;
    int32 Priority = 0;
};

/**
 * Aggregated circuit breakers telemetry computed on a worker thread.
 */
struct FCircuitBreakersTelemetryAggregate
{
    int32 TotalSwitches = 0;
    int32 OnSwitches = 0;
    int32 OffSwitches = 0;
    int32 DisconnectedSwitches = 0;
};

/**
 * Production indicator status mirrored from EProductionStatus (§8.2).
 */
enum class EFicsitAIProductionIndicator : uint8
{
    None,
    Producing,
    ProducingWithCrystal,
    Standby,
    Error,
    Unknown
};

/**
 * Compact per-machine state snapshot for GameThread sampling (§8.2).
 * Records observed/derived machine state flags only; FR-23 cause classification belongs in core/.
 * Building identity (BuildingId) is held by the BuildingIndex caller.
 */
struct FMachineLoadTelemetryItem
{
    FName ClassName = NAME_None;
    FName CurrentRecipeClass = NAME_None;

    bool bHasPower = false;
    bool bIsProducing = false;
    bool bIsProductionPaused = false;
    bool bIsStandby = false;
    bool bIsConfigured = false;
    EFicsitAIProductionIndicator ProductionIndicator = EFicsitAIProductionIndicator::Unknown;

    float Productivity = 0.0f; // [0.0, 1.0]
    float CycleTimeSeconds = 0.0f;

    // Derived buffer readiness flags (§8.2, measured in S3; excluded from v0.1 API).
    // Unset when not evaluated (e.g. unconfigured machine, missing recipe, or null inventory).
    TOptional<bool> bHasIngredientsForCycle;
    TOptional<bool> bHasOutputSpaceForCycle;
};

/**
 * Aggregated machine load metrics computed on a worker thread from machine state snapshots (§8.2).
 */
struct FMachineLoadTelemetryAggregate
{
    int32 TotalMachines = 0;
    int32 ProducingMachines = 0;
    int32 PausedMachines = 0;
    int32 UnpoweredMachines = 0;
    int32 UnconfiguredMachines = 0;

    float AverageProductivity = 0.0f;

    TMap<FName, int32> CountByClass;
    TMap<FName, int32> CountByRecipe;
};

} // namespace FicsitAI::Telemetry
