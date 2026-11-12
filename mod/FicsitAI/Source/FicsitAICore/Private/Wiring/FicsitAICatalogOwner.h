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
 * В инертном режиме мода (мультиплеер, ADR-016, §4.2) каталог не читается и снимок не отдаётся.
 */
UCLASS()
class AFicsitAICatalogOwner : public AModSubsystem
{
    GENERATED_BODY()

public:
    AFicsitAICatalogOwner();

    virtual void Tick(float DeltaSeconds) override;

    static AFicsitAICatalogOwner* Get(const UObject* WorldContext);

    /** Снимок или nullptr, пока каталог не прочитан или мод инертен. Указатель живёт до следующего RefreshCatalog(). */
    const FicsitAI::Catalog::FSnapshot* GetSnapshot() const;

    /** Перечитать каталог сейчас. При неудаче прежний снимок остаётся; в инертном режиме — false. Только GameThread. */
    bool RefreshCatalog();

private:
    const class AFicsitAISubsystem* FindModSubsystem() const;

    /** Мод активен: подсистема мода есть и не перешла в инертный режим. */
    bool IsModActive() const;

    TOptional<FicsitAI::Catalog::FSnapshot> Snapshot;
    int32 FailedAttempts = 0;
};
