#include "CatalogProvider.h"

#include "Buildables/FGBuildableFactory.h"
#include "Engine/World.h"
#include "FGGameState.h"
#include "FGRecipe.h"
#include "FGRecipeManager.h"
#include "FGSchematic.h"
#include "Registry/ModContentRegistry.h"
#include "Resources/FGBuildingDescriptor.h"
#include "Resources/FGItemDescriptor.h"
#include "Unlocks/FGUnlockRecipe.h"

namespace FicsitAI::Catalog
{
namespace
{
FClassId ReadClassId(const UClass& Class)
{
    return {Class.GetFName(), Class.GetPathName()};
}

TOptional<ERecipeUnit> ReadItemUnit(TSubclassOf<UFGItemDescriptor> ItemClass)
{
    switch (UFGItemDescriptor::GetForm(ItemClass))
    {
    case EResourceForm::RF_SOLID:
        return ERecipeUnit::Items;
    case EResourceForm::RF_LIQUID:
    case EResourceForm::RF_GAS:
        return ERecipeUnit::CubicMeters;
    default:
        return {};
    }
}

TArray<FRecipeAmount> ReadAmounts(const TArray<FItemAmount>& Amounts, double DurationSeconds)
{
    TArray<FRecipeAmount> Result;
    Result.Reserve(Amounts.Num());
    for (const FItemAmount& Amount : Amounts)
    {
        const UClass* ItemClass = Amount.ItemClass.Get();
        if (!ItemClass)
        {
            continue;
        }

        const ERecipeUnit Unit = ReadItemUnit(Amount.ItemClass).Get(ERecipeUnit::Items);
        Result.Add({ReadClassId(*ItemClass), FRecipeQuantity::FromGameUnits(Amount.Amount, Unit, DurationSeconds)});
    }
    return Result;
}

TSet<UClass*> ReadAlternateRecipes(const UModContentRegistry& Registry)
{
    TSet<UClass*> Recipes;
    for (const FGameObjectRegistration& Registration : Registry.GetRegisteredSchematics())
    {
        UClass* Schematic = Cast<UClass>(Registration.RegisteredObject.Get());
        if (!Schematic || !Schematic->IsChildOf(UFGSchematic::StaticClass())
            || UFGSchematic::GetType(Schematic) != ESchematicType::EST_Alternate)
        {
            continue;
        }

        for (const UFGUnlock* Unlock : UFGSchematic::GetUnlocks(Schematic))
        {
            if (const UFGUnlockRecipe* RecipeUnlock = Cast<UFGUnlockRecipe>(Unlock))
            {
                for (const TSubclassOf<UFGRecipe>& Recipe : RecipeUnlock->GetRecipesToUnlock())
                {
                    if (UClass* RecipeClass = Recipe.Get())
                    {
                        Recipes.Add(RecipeClass);
                    }
                }
            }
        }
    }
    return Recipes;
}

void ReadDescriptors(const UModContentRegistry& Registry, const AFGRecipeManager& RecipeManager, FSnapshot& Snapshot)
{
    const TArray<FGameObjectRegistration> Registrations = Registry.GetLoadedItemDescriptors();
    Snapshot.Items.Reserve(Registrations.Num());
    TMap<const UClass*, int32> BuildingIndices;

    for (const FGameObjectRegistration& Registration : Registrations)
    {
        UClass* Descriptor = Cast<UClass>(Registration.RegisteredObject.Get());
        if (!Descriptor || !Descriptor->IsChildOf(UFGItemDescriptor::StaticClass()))
        {
            continue;
        }

        FItem& Item = Snapshot.Items.AddDefaulted_GetRef();
        Item.Id = ReadClassId(*Descriptor);
        Item.DisplayName = UFGItemDescriptor::GetItemName(Descriptor);
        Item.OwnerMod = Registration.OwnedByModReference;
        Item.Unit = ReadItemUnit(Descriptor);
        Item.bIsVanilla = Registration.HasAnyFlags(EGameObjectRegistrationFlags::BuiltIn);
        Item.bUnlocked = RecipeManager.IsItemDescriptorAvailable(Descriptor);
        Item.bIsBuildingDescriptor = Descriptor->IsChildOf(UFGBuildingDescriptor::StaticClass());
        if (!Item.bIsBuildingDescriptor)
        {
            continue;
        }

        const TSubclassOf<AFGBuildable> Buildable = UFGBuildingDescriptor::GetBuildableClass(Descriptor);
        const UClass* BuildingClass = Buildable.Get();
        if (!BuildingClass)
        {
            continue;
        }

        if (const int32* ExistingIndex = BuildingIndices.Find(BuildingClass))
        {
            Snapshot.Buildings[*ExistingIndex].Descriptors.Add(Item.Id);
            continue;
        }

        BuildingIndices.Add(BuildingClass, Snapshot.Buildings.Num());
        FBuilding& Building = Snapshot.Buildings.AddDefaulted_GetRef();
        Building.Id = ReadClassId(*BuildingClass);
        Building.Descriptors.Add(Item.Id);
        Building.bBuildable = RecipeManager.IsBuildingAvailable(Buildable);
        if (const AFGBuildableFactory* Factory = Cast<AFGBuildableFactory>(BuildingClass->GetDefaultObject()))
        {
            Building.DefaultProducingPowerConsumptionMW = Factory->GetDefaultProducingPowerConsumption();
        }
    }
}
}

FRecipeQuantity FRecipeQuantity::FromGameUnits(int32 Amount, ERecipeUnit Unit, double DurationSeconds)
{
    FRecipeQuantity Result;
    Result.Unit = Unit;
    Result.PerCraft = Unit == ERecipeUnit::CubicMeters ? Amount / 1000.0 : Amount;
    if (FMath::IsFinite(DurationSeconds) && DurationSeconds > 0.0)
    {
        Result.PerMinute = Result.PerCraft * 60.0 / DurationSeconds;
    }
    return Result;
}

bool TryReadCatalog(UWorld* World, FSnapshot& OutSnapshot)
{
    if (!IsInGameThread() || !IsValid(World) || !World->IsGameWorld() || !World->HasBegunPlay())
    {
        return false;
    }

    const UModContentRegistry* Registry = UModContentRegistry::Get(World);
    const AFGRecipeManager* RecipeManager = AFGRecipeManager::Get(World);
    if (!Registry || !RecipeManager)
    {
        return false;
    }

    const TSet<UClass*> Alternates = ReadAlternateRecipes(*Registry);
    const TArray<FGameObjectRegistration> Registrations = Registry->GetRegisteredRecipes();
    FSnapshot Snapshot;
    if (const AFGGameState* GameState = World->GetGameState<AFGGameState>())
    {
        Snapshot.PartsCostMultiplier = GameState->GetPartsCostMultiplier();
    }
    Snapshot.Recipes.Reserve(Registrations.Num());

    for (const FGameObjectRegistration& Registration : Registrations)
    {
        UClass* RecipeClass = Cast<UClass>(Registration.RegisteredObject.Get());
        if (!RecipeClass || !RecipeClass->IsChildOf(UFGRecipe::StaticClass()))
        {
            continue;
        }

        const UFGRecipe& Defaults = *RecipeClass->GetDefaultObject<UFGRecipe>();
        FRecipe& Recipe = Snapshot.Recipes.AddDefaulted_GetRef();
        Recipe.Id = ReadClassId(*RecipeClass);
        Recipe.DisplayName = UFGRecipe::GetRecipeName(RecipeClass);
        Recipe.OwnerMod = Registration.OwnedByModReference;
        Recipe.bIsVanilla = Registry->IsRecipeVanilla(RecipeClass);
        Recipe.bIsAlternate = Alternates.Contains(RecipeClass);
        Recipe.bUnlocked = RecipeManager->IsRecipeAvailable(RecipeClass);
        Recipe.DurationSeconds = Defaults.GetManufacturingDuration();
        Recipe.Ingredients = ReadAmounts(Defaults.GetIngredients(), Recipe.DurationSeconds);
        Recipe.Products = ReadAmounts(Defaults.GetProducts(), Recipe.DurationSeconds);

        for (const TSubclassOf<UObject>& Producer : UFGRecipe::GetProducedIn(RecipeClass))
        {
            if (const UClass* ProducerClass = Producer.Get())
            {
                Recipe.ProducedIn.Add(ReadClassId(*ProducerClass));
            }
        }
    }

    ReadDescriptors(*Registry, *RecipeManager, Snapshot);
    OutSnapshot = MoveTemp(Snapshot);
    return true;
}
}
