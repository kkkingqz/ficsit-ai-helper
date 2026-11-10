#include "CatalogProvider.h"

#include "Engine/World.h"
#include "FGRecipe.h"
#include "FGRecipeManager.h"
#include "FGSchematic.h"
#include "Registry/ModContentRegistry.h"
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

        const EResourceForm Form = UFGItemDescriptor::GetForm(Amount.ItemClass);
        const ERecipeUnit Unit = Form == EResourceForm::RF_LIQUID || Form == EResourceForm::RF_GAS
            ? ERecipeUnit::CubicMeters
            : ERecipeUnit::Items;
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

bool TryReadRecipes(UWorld* World, TArray<FRecipe>& OutRecipes)
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
    TArray<FRecipe> Recipes;
    Recipes.Reserve(Registrations.Num());

    for (const FGameObjectRegistration& Registration : Registrations)
    {
        UClass* RecipeClass = Cast<UClass>(Registration.RegisteredObject.Get());
        if (!RecipeClass || !RecipeClass->IsChildOf(UFGRecipe::StaticClass()))
        {
            continue;
        }

        FRecipe& Recipe = Recipes.AddDefaulted_GetRef();
        Recipe.ClassName = RecipeClass->GetFName();
        Recipe.ClassPath = RecipeClass->GetPathName();
        Recipe.DisplayName = UFGRecipe::GetRecipeName(RecipeClass);
        Recipe.OwnerMod = Registration.OwnedByModReference;
        Recipe.bIsVanilla = Registry->IsRecipeVanilla(RecipeClass);
        Recipe.bIsAlternate = Alternates.Contains(RecipeClass);
        Recipe.bUnlocked = RecipeManager->IsRecipeAvailable(RecipeClass);
        Recipe.DurationSeconds = UFGRecipe::GetManufacturingDuration(RecipeClass);
        Recipe.Ingredients = ReadAmounts(UFGRecipe::GetIngredients(World, RecipeClass), Recipe.DurationSeconds);
        Recipe.Products = ReadAmounts(UFGRecipe::GetProducts(RecipeClass), Recipe.DurationSeconds);

        for (const TSubclassOf<UObject>& Producer : UFGRecipe::GetProducedIn(RecipeClass))
        {
            if (const UClass* ProducerClass = Producer.Get())
            {
                Recipe.ProducedIn.Add(ReadClassId(*ProducerClass));
            }
        }
    }

    OutRecipes = MoveTemp(Recipes);
    return true;
}
}
