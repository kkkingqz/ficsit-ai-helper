#include "GameFacade/Telemetry/CircuitBreakers/FicsitAICircuitBreakerCollector.h"
#include "Buildables/FGBuildableCircuitSwitch.h"
#include "Buildables/FGBuildablePriorityPowerSwitch.h"

namespace FicsitAI::Telemetry
{

bool FFicsitAICircuitBreakerCollector::Collect(const AFGBuildableCircuitSwitch* Switch, FCircuitBreakerTelemetryItem& OutItem)
{
    if (!IsInGameThread() || !IsValid(Switch))
    {
        return false;
    }

    FCircuitBreakerTelemetryItem Snapshot;

    const UClass* SwitchClass = Switch->GetClass();
    Snapshot.ClassName = SwitchClass ? SwitchClass->GetFName() : NAME_None;

    Snapshot.bIsSwitchOn = Switch->IsSwitchOn();
    Snapshot.bIsConnected = Switch->IsSwitchConnected();
    Snapshot.CircuitId0 = Switch->GetCircuitID0();
    Snapshot.CircuitId1 = Switch->GetCircuitID1();

    if (const AFGBuildablePriorityPowerSwitch* PrioritySwitch = Cast<AFGBuildablePriorityPowerSwitch>(Switch))
    {
        Snapshot.bIsPrioritySwitch = true;
        Snapshot.Priority = PrioritySwitch->GetPriority();
    }
    else
    {
        Snapshot.bIsPrioritySwitch = false;
        Snapshot.Priority = 0;
    }

    OutItem = MoveTemp(Snapshot);
    return true;
}

void FFicsitAICircuitBreakerCollector::Aggregate(TArrayView<const FCircuitBreakerTelemetryItem> Snapshots, FCircuitBreakersTelemetryAggregate& OutAggregate)
{
    OutAggregate = FCircuitBreakersTelemetryAggregate{};

    for (const FCircuitBreakerTelemetryItem& Item : Snapshots)
    {
        OutAggregate.TotalSwitches++;
        if (!Item.bIsConnected)
        {
            OutAggregate.DisconnectedSwitches++;
        }
        else if (Item.bIsSwitchOn)
        {
            OutAggregate.OnSwitches++;
        }
        else
        {
            OutAggregate.OffSwitches++;
        }
    }
}

} // namespace FicsitAI::Telemetry
