#include "GameFacade/Telemetry/ProductionLoad/FicsitAIMachineLoadCollector.h"
#include "Buildables/FGBuildableFactory.h"
#include "Buildables/FGBuildableManufacturer.h"
#include "FGPowerInfoComponent.h"
#include "FGInventoryComponent.h"
#include "FGRecipe.h"

namespace FicsitAI::Telemetry
{

bool FFicsitAIMachineLoadCollector::Collect(const AFGBuildableFactory* Factory, FMachineLoadTelemetryItem& OutItem)
{
    if (!IsValid(Factory))
    {
        return false;
    }

    OutItem.BuildingId = Factory->GetPathName();
    UClass* FactoryClass = Factory->GetClass();
    OutItem.ClassName = FactoryClass ? FactoryClass->GetFName() : NAME_None;

    const UFGPowerInfoComponent* PowerInfo = Factory->GetPowerInfo();
    OutItem.bHasPower = PowerInfo ? PowerInfo->HasPower() : Factory->HasPower();

    OutItem.bIsProducing = Factory->IsProducing();
    OutItem.Productivity = FMath::Clamp(Factory->GetProductivity(), 0.0f, 1.0f);
    OutItem.CycleTimeSeconds = Factory->GetProductionCycleTime();

    if (const AFGBuildableManufacturer* Manufacturer = Cast<AFGBuildableManufacturer>(Factory))
    {
        OutItem.bIsConfigured = Manufacturer->IsConfigured();
        if (Manufacturer->GetCurrentRecipe())
        {
            OutItem.CurrentRecipeClass = Manufacturer->GetCurrentRecipe()->GetFName();
        }

        const UFGInventoryComponent* InputInv = Manufacturer->GetInputInventory();
        OutItem.bInputInventoryEmpty = InputInv ? InputInv->IsEmpty() : false;

        const UFGInventoryComponent* OutputInv = Manufacturer->GetOutputInventory();
        OutItem.bOutputInventoryFull = OutputInv ? (OutputInv->FindEmptyIndex() == INDEX_NONE) : false;

        // Diagnostic rule classification (§8.6)
        if (!OutItem.bHasPower)
        {
            OutItem.DiagnosticStatus = EFicsitAIMachineStatus::NoPower;
        }
        else if (!OutItem.bIsConfigured)
        {
            OutItem.DiagnosticStatus = EFicsitAIMachineStatus::NoRecipe;
        }
        else if (OutItem.bIsProducing)
        {
            OutItem.DiagnosticStatus = EFicsitAIMachineStatus::Producing;
        }
        else if (OutItem.bInputInventoryEmpty)
        {
            OutItem.DiagnosticStatus = EFicsitAIMachineStatus::Starved;
        }
        else if (OutItem.bOutputInventoryFull)
        {
            OutItem.DiagnosticStatus = EFicsitAIMachineStatus::Blocked;
        }
        else
        {
            OutItem.DiagnosticStatus = EFicsitAIMachineStatus::Idle;
        }
    }
    else
    {
        OutItem.bIsConfigured = true;
        if (!OutItem.bHasPower)
        {
            OutItem.DiagnosticStatus = EFicsitAIMachineStatus::NoPower;
        }
        else if (OutItem.bIsProducing)
        {
            OutItem.DiagnosticStatus = EFicsitAIMachineStatus::Producing;
        }
        else
        {
            OutItem.DiagnosticStatus = EFicsitAIMachineStatus::Idle;
        }
    }

    return true;
}

void FFicsitAIMachineLoadCollector::CollectBatch(const TArray<const AFGBuildableFactory*>& Factories, FMachineLoadTelemetryAggregate& OutAggregate)
{
    OutAggregate.TotalMachines = 0;
    OutAggregate.ProducingMachines = 0;
    OutAggregate.IdleMachines = 0;
    OutAggregate.StarvedMachines = 0;
    OutAggregate.BlockedMachines = 0;
    OutAggregate.UnpoweredMachines = 0;
    OutAggregate.AverageProductivity = 0.0f;
    OutAggregate.CountByRecipe.Empty();
    OutAggregate.Items.Reset(Factories.Num());

    float TotalProductivity = 0.0f;

    for (const AFGBuildableFactory* Factory : Factories)
    {
        FMachineLoadTelemetryItem Item;
        if (Collect(Factory, Item))
        {
            OutAggregate.TotalMachines++;
            TotalProductivity += Item.Productivity;

            switch (Item.DiagnosticStatus)
            {
            case EFicsitAIMachineStatus::Producing:
                OutAggregate.ProducingMachines++;
                break;
            case EFicsitAIMachineStatus::NoPower:
                OutAggregate.UnpoweredMachines++;
                break;
            case EFicsitAIMachineStatus::Starved:
                OutAggregate.StarvedMachines++;
                break;
            case EFicsitAIMachineStatus::Blocked:
                OutAggregate.BlockedMachines++;
                break;
            case EFicsitAIMachineStatus::NoRecipe:
            case EFicsitAIMachineStatus::Idle:
            default:
                OutAggregate.IdleMachines++;
                break;
            }

            if (Item.CurrentRecipeClass != NAME_None)
            {
                OutAggregate.CountByRecipe.FindOrAdd(Item.CurrentRecipeClass, 0)++;
            }

            OutAggregate.Items.Add(MoveTemp(Item));
        }
    }

    if (OutAggregate.TotalMachines > 0)
    {
        OutAggregate.AverageProductivity = TotalProductivity / static_cast<float>(OutAggregate.TotalMachines);
    }
}

} // namespace FicsitAI::Telemetry
