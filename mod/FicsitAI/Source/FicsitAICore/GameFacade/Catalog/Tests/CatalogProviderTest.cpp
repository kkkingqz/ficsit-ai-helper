#include "../CatalogProvider.h"

#if WITH_DEV_AUTOMATION_TESTS
#include "Misc/AutomationTest.h"

namespace FicsitAI::Catalog
{
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FCatalogRecipeQuantityTest, "FicsitAI.Catalog.RecipeQuantity",
    EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FCatalogRecipeQuantityTest::RunTest(const FString&)
{
    const FRecipeQuantity Solid = FRecipeQuantity::FromGameUnits(3, ERecipeUnit::Items, 12.0);
    TestEqual(TEXT("Solid amount per craft"), Solid.PerCraft, 3.0);
    TestTrue(TEXT("Solid rate is 15 items per minute"), Solid.PerMinute.IsSet() && Solid.PerMinute.GetValue() == 15.0);

    const FRecipeQuantity Fluid = FRecipeQuantity::FromGameUnits(2500, ERecipeUnit::CubicMeters, 30.0);
    TestEqual(TEXT("Fluid amount is converted once"), Fluid.PerCraft, 2.5);
    TestTrue(TEXT("Fluid rate is 5 cubic meters per minute"), Fluid.PerMinute.IsSet() && Fluid.PerMinute.GetValue() == 5.0);

    const FRecipeQuantity Instant = FRecipeQuantity::FromGameUnits(1000, ERecipeUnit::CubicMeters, 0.0);
    TestEqual(TEXT("An instant recipe still has a quantity"), Instant.PerCraft, 1.0);
    TestFalse(TEXT("An instant recipe has no per-minute rate"), Instant.PerMinute.IsSet());
    return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FCatalogUnavailableWorldTest, "FicsitAI.Catalog.UnavailableWorld",
    EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FCatalogUnavailableWorldTest::RunTest(const FString&)
{
    TArray<FRecipe> Previous;
    Previous.AddDefaulted_GetRef().ClassName = TEXT("Recipe_Previous_C");
    TestFalse(TEXT("Missing world is unavailable"), TryReadRecipes(nullptr, Previous));
    TestEqual(TEXT("Failure keeps the previous snapshot"), Previous.Num(), 1);
    if (Previous.Num() == 1)
    {
        TestEqual(TEXT("Failure keeps previous recipe data"), Previous[0].ClassName, FName(TEXT("Recipe_Previous_C")));
    }
    return true;
}
}
#endif
