#pragma once

#include "CoreMinimal.h"
#include "Subsystem/ModSubsystem.h"
#include "../GameFacade/Catalog/CatalogProvider.h"
#include "FicsitAICatalogOwner.generated.h"

DECLARE_LOG_CATEGORY_EXTERN(LogFicsitAICatalog, Log, All);

/**
 * Единственный владелец снимка каталога в мире (Co-44).
 * Читает каталог один раз на GameThread, когда мир начал игру и SML закрыл реестр модового контента.
 * Подписки на события и catalogRevision добавляет зона Catalog/ и вызывает RefreshCatalog().
 */
UCLASS()
class AFicsitAICatalogOwner : public AModSubsystem
{
    GENERATED_BODY()

public:
    AFicsitAICatalogOwner();

    virtual void Tick(float DeltaSeconds) override;

    static AFicsitAICatalogOwner* Get(const UObject* WorldContext);

    /** Снимок или nullptr, пока каталог не прочитан. Указатель живёт до следующего RefreshCatalog(). */
    const FicsitAI::Catalog::FSnapshot* GetSnapshot() const { return Snapshot.GetPtrOrNull(); }

    /** Перечитать каталог сейчас. При неудаче прежний снимок остаётся. Только GameThread. */
    bool RefreshCatalog();

private:
    TOptional<FicsitAI::Catalog::FSnapshot> Snapshot;
    int32 FailedAttempts = 0;
};
