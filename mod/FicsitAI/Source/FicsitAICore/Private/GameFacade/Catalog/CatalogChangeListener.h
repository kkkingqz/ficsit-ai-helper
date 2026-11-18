#pragma once

#include "CoreMinimal.h"
#include "Engine/TimerHandle.h"
#include "Registry/ModContentRegistry.h"
#include "UObject/Object.h"
#include "CatalogChangeListener.generated.h"

class AFGRecipeManager;
class AFGSchematicManager;
class UFGRecipe;
class UFGSchematic;
class UWorld;

namespace FicsitAI::Catalog
{
DECLARE_DELEGATE_OneParam(FOnCatalogChanged, bool /* bContentChanged */);
}

/** Turns a burst of content and unlock notifications into one refresh on the game thread. */
UCLASS()
class UFicsitAICatalogChangeListener : public UObject
{
    GENERATED_BODY()

public:
    bool Start(UWorld& World, FicsitAI::Catalog::FOnCatalogChanged InOnChanged);
    void Stop();

private:
    virtual void BeginDestroy() override;

    UFUNCTION()
    void HandleRecipeAvailable(TSubclassOf<UFGRecipe> Recipe);

    UFUNCTION()
    void HandleSchematicPurchased(TSubclassOf<UFGSchematic> Schematic);

    UFUNCTION()
    void HandleContentRegistered(FGameObjectRegistration Registration);

    void RequestRefresh(bool bContentChanged);
    void Refresh();

    TWeakObjectPtr<UWorld> World;
    TWeakObjectPtr<AFGRecipeManager> RecipeManager;
    TWeakObjectPtr<AFGSchematicManager> SchematicManager;
    TWeakObjectPtr<UModContentRegistry> Registry;
    FicsitAI::Catalog::FOnCatalogChanged OnChanged;
    FTimerHandle PendingRefresh;
    bool bContentDirty = false;
};
