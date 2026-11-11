#include "GameFacade/Telemetry/ProductionLoad/FicsitAIMachineLoadCollector.h"
#include "Buildables/FGBuildable.h"
#include "Buildables/FGBuildableFactory.h"
#include "Buildables/FGBuildableManufacturer.h"
#include "FGInventoryComponent.h"
#include "FGPowerInfoComponent.h"
#include "FGRecipe.h"
#include "ItemAmount.h"
#include "Resources/FGItemDescriptor.h"

namespace FicsitAI::Telemetry
{

static EFicsitAIProductionIndicator ConvertProductionIndicator(EProductionStatus Status)
{
    switch (Status)
    {
    case EProductionStatus::IS_NONE:
        return EFicsitAIProductionIndicator::None;
    case EProductionStatus::IS_PRODUCING:
        return EFicsitAIProductionIndicator::Producing;
    case EProductionStatus::IS_PRODUCING_WITH_CRYSTAL:
        return EFicsitAIProductionIndicator::ProducingWithCrystal;
    case EProductionStatus::IS_STANDBY:
        return EFicsitAIProductionIndicator::Standby;
    case EProductionStatus::IS_ERROR:
        return EFicsitAIProductionIndicator::Error;
    default:
        return EFicsitAIProductionIndicator::Unknown;
    }
}

bool FFicsitAIMachineLoadCollector::CheckIngredientsForCycle(
    const TArray<FItemAmount>& Ingredients,
    TFunctionRef<int32(TSubclassOf<UFGItemDescriptor>)> GetAvailableCount)
{
    for (int32 i = 0; i < Ingredients.Num(); ++i)
    {
        const FItemAmount& Req = Ingredients[i];
        if (!Req.ItemClass || Req.Amount <= 0)
        {
            continue;
        }

        // Skip if this ItemClass was already verified at an earlier index
        bool bAlreadyChecked = false;
        for (int32 j = 0; j < i; ++j)
        {
            if (Ingredients[j].ItemClass == Req.ItemClass)
            {
                bAlreadyChecked = true;
                break;
            }
        }
        if (bAlreadyChecked)
        {
            continue;
        }

        // Sum any duplicate ingredient entries for the same descriptor without heap allocations
        int32 RequiredAmount = Req.Amount;
        for (int32 j = i + 1; j < Ingredients.Num(); ++j)
        {
            if (Ingredients[j].ItemClass == Req.ItemClass && Ingredients[j].Amount > 0)
            {
                RequiredAmount += Ingredients[j].Amount;
            }
        }

        if (GetAvailableCount(Req.ItemClass) < RequiredAmount)
        {
            return false;
        }
    }

    return true;
}

static bool HasSpaceForCycleOutputs(
    const UFGInventoryComponent& OutputInv,
    const TArray<FItemAmount>& Products,
    float ProductionBoost)
{
    if (Products.IsEmpty())
    {
        return true;
    }

    const double Boost = FMath::Max(1.0, static_cast<double>(ProductionBoost));
    auto CalcScaledAmount = [Boost](int32 BaseAmount) -> int32 {
        return (Boost > 1.0)
            ? FMath::Max(1, FMath::CeilToInt(static_cast<double>(BaseAmount) * Boost))
            : BaseAmount;
    };

    // Zero-allocation fast path for single-output recipes (smelter, constructor, assembler, manufacturer)
    if (Products.Num() == 1)
    {
        const FItemAmount& Prod = Products[0];
        if (!Prod.ItemClass || Prod.Amount <= 0)
        {
            return true;
        }
        return OutputInv.HasEnoughSpaceForStack(FInventoryStack(CalcScaledAmount(Prod.Amount), Prod.ItemClass));
    }

    TArray<FInventoryStack> Stacks;
    Stacks.Reserve(Products.Num());
    for (const FItemAmount& Prod : Products)
    {
        if (Prod.ItemClass && Prod.Amount > 0)
        {
            Stacks.Emplace(CalcScaledAmount(Prod.Amount), Prod.ItemClass);
        }
    }

    if (Stacks.IsEmpty())
    {
        return true;
    }

    return OutputInv.HasEnoughSpaceForStacks(Stacks);
}

bool FFicsitAIMachineLoadCollector::Collect(const AFGBuildableFactory* Factory, FMachineLoadTelemetryItem& OutItem)
{
    if (!IsInGameThread() || !IsValid(Factory))
    {
        return false;
    }

    FMachineLoadTelemetryItem Snapshot;

    const UClass* FactoryClass = Factory->GetClass();
    Snapshot.ClassName = FactoryClass ? FactoryClass->GetFName() : NAME_None;

    const UFGPowerInfoComponent* PowerInfo = Factory->GetPowerInfo();
    Snapshot.bHasPower = PowerInfo ? PowerInfo->HasPower() : Factory->HasPower();

    Snapshot.bIsProducing = Factory->IsProducing();
    Snapshot.bIsProductionPaused = Factory->IsProductionPaused();

    const EProductionStatus Indicator = Factory->GetProductionIndicatorStatus();
    Snapshot.ProductionIndicator = ConvertProductionIndicator(Indicator);
    Snapshot.bIsStandby = (Indicator == EProductionStatus::IS_STANDBY);

    Snapshot.Productivity = FMath::Clamp(Factory->GetProductivity(), 0.0f, 1.0f);
    Snapshot.CycleTimeSeconds = Factory->GetProductionCycleTime();

    if (const AFGBuildableManufacturer* Manufacturer = Cast<AFGBuildableManufacturer>(Factory))
    {
        const TSubclassOf<UFGRecipe> RecipeClass = Manufacturer->GetCurrentRecipe();
        Snapshot.bIsConfigured = Manufacturer->IsConfigured() || (RecipeClass != nullptr);

        if (RecipeClass)
        {
            Snapshot.CurrentRecipeClass = RecipeClass->GetFName();

            if (const UFGRecipe* RecipeCDO = RecipeClass->GetDefaultObject<UFGRecipe>())
            {
                if (const UFGInventoryComponent* InputInv = Manufacturer->GetInputInventory())
                {
                    Snapshot.bHasIngredientsForCycle = CheckIngredientsForCycle(
                        RecipeCDO->GetIngredients(),
                        [InputInv](TSubclassOf<UFGItemDescriptor> ItemClass) -> int32 {
                            return InputInv->GetNumItems(ItemClass);
                        });
                }

                if (const UFGInventoryComponent* OutputInv = Manufacturer->GetOutputInventory())
                {
                    Snapshot.bHasOutputSpaceForCycle = HasSpaceForCycleOutputs(
                        *OutputInv,
                        RecipeCDO->GetProducts(),
                        Manufacturer->GetCurrentProductionBoost());
                }
            }
        }
    }
    else
    {
        Snapshot.bIsConfigured = Factory->IsConfigured();
        // bHasIngredientsForCycle and bHasOutputSpaceForCycle remain unset for non-manufacturer factories
    }

    OutItem = MoveTemp(Snapshot);
    return true;
}

void FFicsitAIMachineLoadCollector::Aggregate(TArrayView<const FMachineLoadTelemetryItem> Snapshots, FMachineLoadTelemetryAggregate& OutAggregate)
{
    OutAggregate = FMachineLoadTelemetryAggregate{};

    float TotalProductivity = 0.0f;

    for (const FMachineLoadTelemetryItem& Item : Snapshots)
    {
        OutAggregate.TotalMachines++;
        TotalProductivity += Item.Productivity;

        if (Item.bIsProducing)
        {
            OutAggregate.ProducingMachines++;
        }
        if (Item.bIsProductionPaused || Item.bIsStandby)
        {
            OutAggregate.PausedMachines++;
        }
        if (!Item.bHasPower)
        {
            OutAggregate.UnpoweredMachines++;
        }
        if (!Item.bIsConfigured)
        {
            OutAggregate.UnconfiguredMachines++;
        }

        if (Item.ClassName != NAME_None)
        {
            OutAggregate.CountByClass.FindOrAdd(Item.ClassName, 0)++;
        }
        if (Item.CurrentRecipeClass != NAME_None)
        {
            OutAggregate.CountByRecipe.FindOrAdd(Item.CurrentRecipeClass, 0)++;
        }
    }

    if (OutAggregate.TotalMachines > 0)
    {
        OutAggregate.AverageProductivity = TotalProductivity / static_cast<float>(OutAggregate.TotalMachines);
    }
}

} // namespace FicsitAI::Telemetry
