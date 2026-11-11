#pragma once

#include "CoreMinimal.h"
#include "Misc/Optional.h"

class UWorld;

namespace FicsitAI::Catalog
{
enum class ERecipeUnit : uint8
{
    Items,
    CubicMeters
};

struct FRecipeQuantity
{
    ERecipeUnit Unit = ERecipeUnit::Items;
    double PerCraft = 0.0;
    TOptional<double> PerMinute;

    static FRecipeQuantity FromGameUnits(int32 Amount, ERecipeUnit Unit, double DurationSeconds);
};

struct FClassId
{
    FName ClassName;
    FString ClassPath;
};

struct FRecipeAmount
{
    FClassId Item;
    FRecipeQuantity Quantity;
};

struct FRecipe
{
    FClassId Id;
    FText DisplayName;
    FName OwnerMod;
    bool bIsVanilla = false;
    bool bIsAlternate = false;
    bool bUnlocked = false;
    double DurationSeconds = 0.0;
    // Nominal recipe defaults. Session cost settings and construction material variants are separate.
    TArray<FRecipeAmount> Ingredients;
    TArray<FRecipeAmount> Products;
    // Includes producer classes such as the build gun and workbench, which need not be in Buildings.
    TArray<FClassId> ProducedIn;
};

struct FItem
{
    FClassId Id;
    FText DisplayName;
    FName OwnerMod;
    TOptional<ERecipeUnit> Unit;
    bool bIsVanilla = false;
    bool bUnlocked = false;
    bool bIsBuildingDescriptor = false;
};

struct FBuilding
{
    FClassId Id;
    TArray<FClassId> Descriptors;
    TOptional<double> DefaultProducingPowerConsumptionMW;
    bool bBuildable = false;
};

struct FSnapshot
{
    // Session setting when the game state is available. The game applies it only to eligible recipes.
    TOptional<float> PartsCostMultiplier;
    TArray<FRecipe> Recipes;
    TArray<FItem> Items;
    TArray<FBuilding> Buildings;
};

// Read on the game thread after the save has started. Failure leaves OutSnapshot intact.
bool TryReadCatalog(UWorld* World, FSnapshot& OutSnapshot);
}
