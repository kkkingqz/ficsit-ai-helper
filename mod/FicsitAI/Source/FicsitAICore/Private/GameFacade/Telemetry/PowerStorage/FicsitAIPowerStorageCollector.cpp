#include "GameFacade/Telemetry/PowerStorage/FicsitAIPowerStorageCollector.h"
#include "Buildables/FGBuildablePowerStorage.h"
#include "FGPowerInfoComponent.h"
#include "FGPowerCircuit.h"

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
    if (!IsValid(Battery))
    {
        return false;
    }

    OutItem.BuildingId = Battery->GetPathName();
    UClass* BatteryClass = Battery->GetClass();
    OutItem.ClassName = BatteryClass ? BatteryClass->GetFName() : NAME_None;

    OutItem.StoredPowerMWh = Battery->GetPowerStore();
    OutItem.CapacityMWh = Battery->GetPowerStoreCapacity();
    OutItem.ChargePercentage = FMath::Clamp(Battery->GetPowerStorePercent(), 0.0f, 1.0f);

    OutItem.PowerInputMW = Battery->GetPowerInput();
    OutItem.PowerOutputMW = Battery->GetPowerOutput();

    OutItem.TimeUntilFullSeconds = Battery->GetTimeUntilFull();
    OutItem.TimeUntilEmptySeconds = Battery->GetTimeUntilEmpty();

    OutItem.BatteryStatus = ConvertBatteryStatus(Battery->GetBatteryStatus());
    OutItem.bHasPower = Battery->HasPower();

    const UFGPowerInfoComponent* PowerInfo = Battery->GetPowerInfo();
    if (PowerInfo)
    {
        const UFGPowerCircuit* Circuit = PowerInfo->GetPowerCircuit();
        OutItem.CircuitId = Circuit ? Circuit->GetCircuitID() : -1;
    }
    else
    {
        OutItem.CircuitId = -1;
    }

    return true;
}

void FFicsitAIPowerStorageCollector::CollectBatch(const TArray<const AFGBuildablePowerStorage*>& Batteries, FPowerStorageTelemetryAggregate& OutAggregate)
{
    OutAggregate.TotalBatteries = 0;
    OutAggregate.ChargingBatteries = 0;
    OutAggregate.DischargingBatteries = 0;
    OutAggregate.TotalStoredMWh = 0.0f;
    OutAggregate.TotalCapacityMWh = 0.0f;
    OutAggregate.OverallChargePercentage = 0.0f;
    OutAggregate.TotalPowerInputMW = 0.0f;
    OutAggregate.TotalPowerOutputMW = 0.0f;
    OutAggregate.EstimatedTimeToEmptySeconds = 0.0f;
    OutAggregate.EstimatedTimeToFullSeconds = 0.0f;
    OutAggregate.Items.Reset(Batteries.Num());

    for (const AFGBuildablePowerStorage* Battery : Batteries)
    {
        FPowerStorageTelemetryItem Item;
        if (Collect(Battery, Item))
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

            OutAggregate.Items.Add(MoveTemp(Item));
        }
    }

    if (OutAggregate.TotalCapacityMWh > 0.0f)
    {
        OutAggregate.OverallChargePercentage = FMath::Clamp(OutAggregate.TotalStoredMWh / OutAggregate.TotalCapacityMWh, 0.0f, 1.0f);
    }

    // Time-to-empty / time-to-full calculation following protocol P-7 §4:
    // t_empty = 3600 * E_stored_MWh / P_out_MW
    if (OutAggregate.TotalPowerOutputMW > 0.0f)
    {
        OutAggregate.EstimatedTimeToEmptySeconds = 3600.0f * (OutAggregate.TotalStoredMWh / OutAggregate.TotalPowerOutputMW);
    }

    // t_full = 3600 * (E_capacity_MWh - E_stored_MWh) / P_in_MW
    if (OutAggregate.TotalPowerInputMW > 0.0f && OutAggregate.TotalCapacityMWh > OutAggregate.TotalStoredMWh)
    {
        const float DeficitMWh = OutAggregate.TotalCapacityMWh - OutAggregate.TotalStoredMWh;
        OutAggregate.EstimatedTimeToFullSeconds = 3600.0f * (DeficitMWh / OutAggregate.TotalPowerInputMW);
    }
}

} // namespace FicsitAI::Telemetry
