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

struct FFicsitAIManufacturerAccess final : public AFGBuildableManufacturer
{
    static bool CallHasRequiredIngredients(const AFGBuildableManufacturer* Manufacturer)
    {
        if (!Manufacturer)
        {
            return false;
        }

        // Qualified call resolves FactoryGame's exported AFGBuildableManufacturer::HasRequiredIngredients()
        // directly (bypassing C++ vtable slot indices, which shift across Satisfactory builds when
        // AFGBuildable virtuals change relative to SML headers). Verified zero overrides in subclasses.
        return static_cast<const FFicsitAIManufacturerAccess*>(Manufacturer)->AFGBuildableManufacturer::HasRequiredIngredients();
    }
};

template <typename TReturn>
static TReturn InvokeFactoryGetter(const AFGBuildableFactory* Factory, UFunction* Func, TReturn DefaultValue)
{
    if (!Factory || !Func || Func->ReturnValueOffset == MAX_uint16 || Func->ParmsSize > 64
        || Func->ReturnValueOffset + sizeof(TReturn) > Func->ParmsSize)
    {
        return DefaultValue;
    }

    alignas(16) uint8 Params[64] = {};
    // UFunction dispatch runs through FactoryGame's own exec* thunk so virtual overrides
    // (e.g. AFGBuildableManufacturer::IsConfigured) resolve against the live binary's vtable.
    const_cast<AFGBuildableFactory*>(Factory)->ProcessEvent(Func, Params);
    return *reinterpret_cast<const TReturn*>(Params + Func->ReturnValueOffset);
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

    static TWeakObjectPtr<UFunction> IsConfiguredFunc = AFGBuildableFactory::StaticClass()->FindFunctionByName(
        GET_FUNCTION_NAME_CHECKED(AFGBuildableFactory, IsConfigured));
    static TWeakObjectPtr<UFunction> IndicatorFunc = AFGBuildableFactory::StaticClass()->FindFunctionByName(
        GET_FUNCTION_NAME_CHECKED(AFGBuildableFactory, GetProductionIndicatorStatus));
    static TWeakObjectPtr<UFunction> ProductivityFunc = AFGBuildableFactory::StaticClass()->FindFunctionByName(
        GET_FUNCTION_NAME_CHECKED(AFGBuildableFactory, GetProductivity));
    static TWeakObjectPtr<UFunction> CycleTimeFunc = AFGBuildableFactory::StaticClass()->FindFunctionByName(
        GET_FUNCTION_NAME_CHECKED(AFGBuildableFactory, GetProductionCycleTime));

    Snapshot.bIsProducing = Factory->IsProducing();
    Snapshot.bIsProductionPaused = Factory->IsProductionPaused();

    const EProductionStatus Indicator = InvokeFactoryGetter<EProductionStatus>(
        Factory, IndicatorFunc.Get(), EProductionStatus::IS_NONE);
    Snapshot.ProductionIndicator = ConvertProductionIndicator(Indicator);
    Snapshot.bIsStandby = (Indicator == EProductionStatus::IS_STANDBY);

    Snapshot.Productivity = FMath::Clamp(
        InvokeFactoryGetter<float>(Factory, ProductivityFunc.Get(), 0.0f), 0.0f, 1.0f);
    Snapshot.CycleTimeSeconds = InvokeFactoryGetter<float>(Factory, CycleTimeFunc.Get(), 0.0f);

    if (const AFGBuildableManufacturer* Manufacturer = Cast<AFGBuildableManufacturer>(Factory))
    {
        const TSubclassOf<UFGRecipe> RecipeClass = Manufacturer->GetCurrentRecipe();
        Snapshot.bIsConfigured = InvokeFactoryGetter<bool>(Factory, IsConfiguredFunc.Get(), false) || (RecipeClass != nullptr);

        if (RecipeClass)
        {
            Snapshot.CurrentRecipeClass = RecipeClass->GetFName();

            if (Manufacturer->GetInputInventory())
            {
                Snapshot.bHasIngredientsForCycle = FFicsitAIManufacturerAccess::CallHasRequiredIngredients(Manufacturer);
            }

            if (const UFGRecipe* RecipeCDO = RecipeClass->GetDefaultObject<UFGRecipe>())
            {
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
        Snapshot.bIsConfigured = InvokeFactoryGetter<bool>(Factory, IsConfiguredFunc.Get(), false);
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
