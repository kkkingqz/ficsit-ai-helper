#include "GameFacade/Telemetry/CircuitBreakers/FicsitAICircuitBreakerCollector.h"
#include "Buildables/FGBuildableCircuitSwitch.h"
#include "Buildables/FGBuildablePriorityPowerSwitch.h"

namespace FicsitAI::Telemetry
{

bool FFicsitAICircuitBreakerCollector::Collect(const AFGBuildableCircuitSwitch* Switch, FCircuitBreakerTelemetryItem& OutItem)
{
    if (!IsValid(Switch))
    {
        return false;
    }

    OutItem.BuildingId = Switch->GetPathName();
    UClass* SwitchClass = Switch->GetClass();
    OutItem.ClassName = SwitchClass ? SwitchClass->GetFName() : NAME_None;

    OutItem.bIsSwitchOn = Switch->IsSwitchOn();
    OutItem.bIsConnected = Switch->IsSwitchConnected();
    OutItem.CircuitId0 = Switch->GetCircuitID0();
    OutItem.CircuitId1 = Switch->GetCircuitID1();
    OutItem.BuildingTag = Switch->GetBuildingTag_Implementation();

    if (const AFGBuildablePriorityPowerSwitch* PrioritySwitch = Cast<AFGBuildablePriorityPowerSwitch>(Switch))
    {
        OutItem.bIsPrioritySwitch = true;
        OutItem.Priority = PrioritySwitch->GetPriority();
    }
    else
    {
        OutItem.bIsPrioritySwitch = false;
        OutItem.Priority = 0;
    }

    return true;
}

void FFicsitAICircuitBreakerCollector::CollectBatch(const TArray<const AFGBuildableCircuitSwitch*>& Switches, FCircuitBreakersTelemetryAggregate& OutAggregate)
{
    OutAggregate.TotalSwitches = 0;
    OutAggregate.OnSwitches = 0;
    OutAggregate.OffSwitches = 0;
    OutAggregate.DisconnectedSwitches = 0;
    OutAggregate.Items.Reset(Switches.Num());

    for (const AFGBuildableCircuitSwitch* Switch : Switches)
    {
        FCircuitBreakerTelemetryItem Item;
        if (Collect(Switch, Item))
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

            OutAggregate.Items.Add(MoveTemp(Item));
        }
    }
}

} // namespace FicsitAI::Telemetry
