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
    FSnapshot Previous;
    Previous.PartsCostMultiplier = 1.5f;
    Previous.CatalogRevision = 123;
    Previous.Recipes.AddDefaulted_GetRef().Id.ClassName = TEXT("Recipe_Previous_C");
    Previous.Items.AddDefaulted_GetRef().Id.ClassName = TEXT("Desc_Previous_C");
    Previous.Buildings.AddDefaulted_GetRef().Id.ClassName = TEXT("Build_Previous_C");

    TestFalse(TEXT("Missing world is unavailable"), TryReadCatalog(nullptr, Previous));
    TestFalse(TEXT("Cannot refresh unlocks without a world"), TryRefreshCatalogUnlocks(nullptr, Previous));
    TestEqual(TEXT("A failed read preserves the revision"), Previous.CatalogRevision, static_cast<uint64>(123));
    TestTrue(TEXT("Failure keeps the previous session cost setting"),
        Previous.PartsCostMultiplier.IsSet() && Previous.PartsCostMultiplier.GetValue() == 1.5f);
    TestEqual(TEXT("Failure keeps the previous recipes"), Previous.Recipes.Num(), 1);
    TestEqual(TEXT("Failure keeps the previous items"), Previous.Items.Num(), 1);
    TestEqual(TEXT("Failure keeps the previous buildings"), Previous.Buildings.Num(), 1);
    if (Previous.Recipes.Num() == 1 && Previous.Items.Num() == 1 && Previous.Buildings.Num() == 1)
    {
        TestEqual(TEXT("Previous recipe ID is preserved"), Previous.Recipes[0].Id.ClassName, FName(TEXT("Recipe_Previous_C")));
        TestEqual(TEXT("Previous item ID is preserved"), Previous.Items[0].Id.ClassName, FName(TEXT("Desc_Previous_C")));
        TestEqual(TEXT("Previous building ID is preserved"), Previous.Buildings[0].Id.ClassName, FName(TEXT("Build_Previous_C")));
    }
    return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FCatalogRevisionTest, "FicsitAI.Catalog.Revision",
    EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FCatalogRevisionTest::RunTest(const FString&)
{
    FSnapshot Snapshot;
    Snapshot.PartsCostMultiplier = 1.0f;
    FRecipe& Recipe = Snapshot.Recipes.AddDefaulted_GetRef();
    Recipe.Id = {TEXT("Recipe_A_C"), TEXT("/Game/Recipe_A.Recipe_A_C")};
    Recipe.DurationSeconds = 10.0;
    Recipe.Products.Add({{TEXT("Desc_A_C"), TEXT("/Game/Desc_A.Desc_A_C")}, {ERecipeUnit::Items, 2.0, 12.0}});
    Snapshot.Recipes.AddDefaulted_GetRef().Id = {TEXT("Recipe_B_C"), TEXT("/Game/Recipe_B.Recipe_B_C")};
    Snapshot.Items.AddDefaulted_GetRef().Id = {TEXT("Desc_A_C"), TEXT("/Game/Desc_A.Desc_A_C")};
    Snapshot.Buildings.AddDefaulted_GetRef().Id = {TEXT("Build_A_C"), TEXT("/Game/Build_A.Build_A_C")};

    const uint64 Initial = ComputeCatalogRevision(Snapshot);
    TestTrue(TEXT("A revision is exact in JSON"), Initial > 0 && Initial <= 9007199254740991ull);

    FSnapshot Reordered = Snapshot;
    Reordered.Recipes.Swap(0, 1);
    Reordered.Recipes[0].DisplayName = FText::FromString(TEXT("Translated label"));
    TestEqual(TEXT("Registry order and localized labels keep the revision"), ComputeCatalogRevision(Reordered), Initial);

    FSnapshot Unlocked = Snapshot;
    Unlocked.Recipes[0].bUnlocked = true;
    TestNotEqual(TEXT("Unlocking a recipe invalidates its revision"), ComputeCatalogRevision(Unlocked), Initial);
    Unlocked = Snapshot;
    Unlocked.Items[0].bUnlocked = true;
    TestNotEqual(TEXT("Unlocking an item invalidates its revision"), ComputeCatalogRevision(Unlocked), Initial);
    Unlocked = Snapshot;
    Unlocked.Buildings[0].bBuildable = true;
    TestNotEqual(TEXT("Unlocking a building invalidates its revision"), ComputeCatalogRevision(Unlocked), Initial);

    FSnapshot Changed = Snapshot;
    Changed.Recipes[0].Products[0].Quantity.PerCraft = 3.0;
    TestNotEqual(TEXT("A changed recipe product invalidates its revision"), ComputeCatalogRevision(Changed), Initial);
    Changed = Snapshot;
    Changed.Recipes.Pop();
    TestNotEqual(TEXT("A removed recipe invalidates its revision"), ComputeCatalogRevision(Changed), Initial);
    Changed = Snapshot;
    Changed.PartsCostMultiplier = 2.0f;
    TestNotEqual(TEXT("A changed session cost invalidates its revision"), ComputeCatalogRevision(Changed), Initial);
    return true;
}
}
#endif
