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
    Fuel,
    Biomass,
    GeoThermal,
    Nuclear,
    Unknown
};

/**
 * Snapshot of a single generator building in the world.
 */
struct FGeneratorTelemetryItem
{
    FString BuildingId;
    FName ClassName = NAME_None;
    EFicsitAIGeneratorType GeneratorType = EFicsitAIGeneratorType::Unknown;

    float ProductionCapacityMW = 0.0f;
    float BaseProductionCapacityMW = 0.0f;
    float CurrentProductionMW = 0.0f;
    float LoadPercentage = 0.0f;

    bool bIsProducing = false;
    bool bCanStartProduction = false;
    bool bHasPower = false;

    // Fuel generator details (AFGBuildableGeneratorFuel)
    bool bIsFuelGenerator = false;
    bool bHasFuel = false;
    FName CurrentFuelClass = NAME_None;
    float FuelAmountRatio = 0.0f; // [0.0, 1.0]

    // Supplemental resource details (e.g. water for coal/nuclear generators)
    bool bRequiresSupplemental = false;
    bool bHasSupplemental = false;
    FName SupplementalResourceClass = NAME_None;
    float SupplementalAmountRatio = 0.0f; // [0.0, 1.0]
    float SupplementalConsumptionRate = 0.0f; // m^3/s

    // Geothermal generator details (AFGBuildableGeneratorGeoThermal)
    bool bIsGeoThermal = false;
    float MinProductionMW = 0.0f;
    float MaxProductionMW = 0.0f;
};

/**
 * Aggregated telemetry across multiple generators.
 */
struct FGeneratorsTelemetryAggregate
{
    int32 TotalGenerators = 0;
    int32 RunningGenerators = 0;
    float TotalProductionCapacityMW = 0.0f;
    float TotalActualProductionMW = 0.0f;

    TMap<FName, int32> CountByClass;
    TMap<FName, float> ProductionByClassMW;

    TArray<FGeneratorTelemetryItem> Items;
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
 * Snapshot of an individual power storage / battery building.
 */
struct FPowerStorageTelemetryItem
{
    FString BuildingId;
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
 * Aggregated telemetry across power storage units.
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

    float EstimatedTimeToEmptySeconds = 0.0f;
    float EstimatedTimeToFullSeconds = 0.0f;

    TArray<FPowerStorageTelemetryItem> Items;
};

/**
 * Snapshot of a circuit switch / breaker.
 */
struct FCircuitBreakerTelemetryItem
{
    FString BuildingId;
    FName ClassName = NAME_None;
    FString BuildingTag;

    bool bIsSwitchOn = false;
    bool bIsConnected = false;

    int32 CircuitId0 = -1;
    int32 CircuitId1 = -1;

    bool bIsPrioritySwitch = false;
    int32 Priority = 0;
};

/**
 * Aggregated circuit breakers telemetry.
 */
struct FCircuitBreakersTelemetryAggregate
{
    int32 TotalSwitches = 0;
    int32 OnSwitches = 0;
    int32 OffSwitches = 0;
    int32 DisconnectedSwitches = 0;

    TArray<FCircuitBreakerTelemetryItem> Items;
};

/**
 * Operational classification of factory machines for §8.6 diagnostics.
 */
enum class EFicsitAIMachineStatus : uint8
{
    Producing,       // Active and running normally
    NoRecipe,        // Machine has no recipe configured
    NoPower,         // Machine has no power / fuse blown
    Starved,         // Input buffer empty or insufficient
    Blocked,         // Output buffer full / conveyor stalled
    Idle             // Configured and ready but currently idle
};

/**
 * Telemetry snapshot for an individual factory machine (smelter, constructor, etc.).
 */
struct FMachineLoadTelemetryItem
{
    FString BuildingId;
    FName ClassName = NAME_None;
    FName CurrentRecipeClass = NAME_None;

    bool bIsConfigured = false;
    bool bIsProducing = false;
    bool bHasPower = false;

    float Productivity = 0.0f; // [0.0, 1.0]
    float CycleTimeSeconds = 0.0f;

    bool bInputInventoryEmpty = false;
    bool bOutputInventoryFull = false;

    EFicsitAIMachineStatus DiagnosticStatus = EFicsitAIMachineStatus::Idle;
};

/**
 * Aggregated machine load metrics across factory buildings.
 */
struct FMachineLoadTelemetryAggregate
{
    int32 TotalMachines = 0;
    int32 ProducingMachines = 0;
    int32 IdleMachines = 0;
    int32 StarvedMachines = 0;
    int32 BlockedMachines = 0;
    int32 UnpoweredMachines = 0;

    float AverageProductivity = 0.0f;

    TMap<FName, int32> CountByRecipe;
    TArray<FMachineLoadTelemetryItem> Items;
};

} // namespace FicsitAI::Telemetry
