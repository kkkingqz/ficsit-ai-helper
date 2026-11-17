#include "CatalogChangeListener.h"

#include "Engine/World.h"
#include "FGRecipe.h"
#include "FGRecipeManager.h"
#include "FGSchematic.h"
#include "FGSchematicManager.h"
#include "TimerManager.h"

bool UFicsitAICatalogChangeListener::Start(UWorld& InWorld, FicsitAI::Catalog::FOnCatalogChanged InOnChanged)
{
    check(IsInGameThread());
    Stop();

    AFGRecipeManager* Recipes = AFGRecipeManager::Get(&InWorld);
    AFGSchematicManager* Schematics = AFGSchematicManager::Get(&InWorld);
    UModContentRegistry* Content = UModContentRegistry::Get(&InWorld);
    if (!Recipes || !Schematics || !Content || !InOnChanged.IsBound())
    {
        return false;
    }

    World = &InWorld;
    RecipeManager = Recipes;
    SchematicManager = Schematics;
    Registry = Content;
    OnChanged = MoveTemp(InOnChanged);
    Recipes->mOnRecipeAvailable.AddUniqueDynamic(this, &ThisClass::HandleRecipeAvailable);
    Schematics->PurchasedSchematicDelegate.AddUniqueDynamic(this, &ThisClass::HandleSchematicPurchased);
    Content->OnRecipeRegistered.AddUniqueDynamic(this, &ThisClass::HandleContentRegistered);
    Content->OnSchematicRegistered.AddUniqueDynamic(this, &ThisClass::HandleContentRegistered);
    Content->OnResearchTreeRegistered.AddUniqueDynamic(this, &ThisClass::HandleContentRegistered);
    return true;
}

void UFicsitAICatalogChangeListener::Stop()
{
    if (UWorld* CurrentWorld = World.Get())
    {
        CurrentWorld->GetTimerManager().ClearTimer(PendingRefresh);
    }
    if (AFGRecipeManager* Recipes = RecipeManager.Get())
    {
        Recipes->mOnRecipeAvailable.RemoveDynamic(this, &ThisClass::HandleRecipeAvailable);
    }
    if (AFGSchematicManager* Schematics = SchematicManager.Get())
    {
        Schematics->PurchasedSchematicDelegate.RemoveDynamic(this, &ThisClass::HandleSchematicPurchased);
    }
    if (UModContentRegistry* Content = Registry.Get())
    {
        Content->OnRecipeRegistered.RemoveDynamic(this, &ThisClass::HandleContentRegistered);
        Content->OnSchematicRegistered.RemoveDynamic(this, &ThisClass::HandleContentRegistered);
        Content->OnResearchTreeRegistered.RemoveDynamic(this, &ThisClass::HandleContentRegistered);
    }

    PendingRefresh.Invalidate();
    bContentDirty = false;
    World.Reset();
    RecipeManager.Reset();
    SchematicManager.Reset();
    Registry.Reset();
    OnChanged.Unbind();
}

void UFicsitAICatalogChangeListener::BeginDestroy()
{
    Stop();
    Super::BeginDestroy();
}

void UFicsitAICatalogChangeListener::HandleRecipeAvailable(TSubclassOf<UFGRecipe>)
{
    RequestRefresh(false);
}

void UFicsitAICatalogChangeListener::HandleSchematicPurchased(TSubclassOf<UFGSchematic>)
{
    RequestRefresh(false);
}

void UFicsitAICatalogChangeListener::HandleContentRegistered(FGameObjectRegistration)
{
    RequestRefresh(true);
}

void UFicsitAICatalogChangeListener::RequestRefresh(bool bContentChanged)
{
    bContentDirty |= bContentChanged;
    if (UWorld* CurrentWorld = World.Get(); CurrentWorld && !PendingRefresh.IsValid())
    {
        // Schematics may unlock several recipes and items. Read the final state after the batch.
        PendingRefresh = CurrentWorld->GetTimerManager().SetTimerForNextTick(this, &ThisClass::Refresh);
    }
}

void UFicsitAICatalogChangeListener::Refresh()
{
    PendingRefresh.Invalidate();
    const bool bContentChanged = bContentDirty;
    bContentDirty = false;
    FicsitAI::Catalog::FOnCatalogChanged Callback = OnChanged;
    Callback.ExecuteIfBound(bContentChanged);
}
