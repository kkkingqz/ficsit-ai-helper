#include "GameFacade/Telemetry/PowerStorage/FicsitAIPowerStorageCollector.h"
#include "Buildables/FGBuildablePowerStorage.h"
#include "FGPowerCircuit.h"
#include "FGPowerInfoComponent.h"

namespace FicsitAI::Telemetry
{

static EFicsitAIBatteryStatus ConvertBatteryStatus(EBatteryStatus InStatus)
{
    switch (InStatus)
    {
    case EBatteryStatus::BS_Idle:
        return EFicsitAIBatteryStatus::Idle;
    case EBatteryStatus::BS_IdleEmpty:
        return EFicsitAIBatteryStatus::IdleEmpty;
    case EBatteryStatus::BS_IdleFull:
        return EFicsitAIBatteryStatus::IdleFull;
    case EBatteryStatus::BS_PowerIn:
        return EFicsitAIBatteryStatus::PowerIn;
    case EBatteryStatus::BS_PowerOut:
        return EFicsitAIBatteryStatus::PowerOut;
    default:
        return EFicsitAIBatteryStatus::Unknown;
    }
}

bool FFicsitAIPowerStorageCollector::Collect(const AFGBuildablePowerStorage* Battery, FPowerStorageTelemetryItem& OutItem)
{
    if (!IsInGameThread() || !IsValid(Battery))
    {
        return false;
    }

    FPowerStorageTelemetryItem Snapshot;

    const UClass* BatteryClass = Battery->GetClass();
    Snapshot.ClassName = BatteryClass ? BatteryClass->GetFName() : NAME_None;

    Snapshot.StoredPowerMWh = Battery->GetPowerStore();
    Snapshot.CapacityMWh = Battery->GetPowerStoreCapacity();
    Snapshot.ChargePercentage = FMath::Clamp(Battery->GetPowerStorePercent(), 0.0f, 1.0f);

    Snapshot.PowerInputMW = Battery->GetPowerInput();
    Snapshot.PowerOutputMW = Battery->GetPowerOutput();

    Snapshot.TimeUntilFullSeconds = Battery->GetTimeUntilFull();
    Snapshot.TimeUntilEmptySeconds = Battery->GetTimeUntilEmpty();

    Snapshot.BatteryStatus = ConvertBatteryStatus(Battery->GetBatteryStatus());
    Snapshot.bHasPower = Battery->HasPower();

    const UFGPowerInfoComponent* PowerInfo = Battery->GetPowerInfo();
    if (PowerInfo)
    {
        const UFGPowerCircuit* Circuit = PowerInfo->GetPowerCircuit();
        Snapshot.CircuitId = Circuit ? Circuit->GetCircuitID() : -1;
    }
    else
    {
        Snapshot.CircuitId = -1;
    }

    OutItem = MoveTemp(Snapshot);
    return true;
}

void FFicsitAIPowerStorageCollector::Aggregate(TArrayView<const FPowerStorageTelemetryItem> Snapshots, FPowerStorageTelemetryAggregate& OutAggregate)
{
    OutAggregate = FPowerStorageTelemetryAggregate{};

    for (const FPowerStorageTelemetryItem& Item : Snapshots)
    {
        OutAggregate.TotalBatteries++;
        if (Item.BatteryStatus == EFicsitAIBatteryStatus::PowerIn)
        {
            OutAggregate.ChargingBatteries++;
        }
        else if (Item.BatteryStatus == EFicsitAIBatteryStatus::PowerOut)
        {
            OutAggregate.DischargingBatteries++;
        }

        OutAggregate.TotalStoredMWh += Item.StoredPowerMWh;
        OutAggregate.TotalCapacityMWh += Item.CapacityMWh;
        OutAggregate.TotalPowerInputMW += Item.PowerInputMW;
        OutAggregate.TotalPowerOutputMW += Item.PowerOutputMW;
    }

    if (OutAggregate.TotalCapacityMWh > 0.0f)
    {
        OutAggregate.OverallChargePercentage = FMath::Clamp(OutAggregate.TotalStoredMWh / OutAggregate.TotalCapacityMWh, 0.0f, 1.0f);
    }

    // Time-to-empty / time-to-full calculation following protocol P-7 §4 and metrics-v0.1.md:
    // t_empty = 3600 * E_stored_MWh / P_out_MW (applicable only while discharging)
    if (OutAggregate.TotalPowerOutputMW > 0.0f)
    {
        OutAggregate.EstimatedTimeToEmptySeconds = 3600.0f * (OutAggregate.TotalStoredMWh / OutAggregate.TotalPowerOutputMW);
    }

    // t_full = 3600 * (E_capacity_MWh - E_stored_MWh) / P_in_MW (applicable only while charging)
    if (OutAggregate.TotalPowerInputMW > 0.0f && OutAggregate.TotalCapacityMWh > OutAggregate.TotalStoredMWh)
    {
        const float DeficitMWh = OutAggregate.TotalCapacityMWh - OutAggregate.TotalStoredMWh;
        OutAggregate.EstimatedTimeToFullSeconds = 3600.0f * (DeficitMWh / OutAggregate.TotalPowerInputMW);
    }
}

} // namespace FicsitAI::Telemetry
