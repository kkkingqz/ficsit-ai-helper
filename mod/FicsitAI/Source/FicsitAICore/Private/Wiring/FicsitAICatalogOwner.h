#pragma once

#include "CoreMinimal.h"
#include "Subsystem/ModSubsystem.h"
#include "../GameFacade/Catalog/CatalogProvider.h"
#include "FicsitAICatalogOwner.generated.h"

DECLARE_LOG_CATEGORY_EXTERN(LogFicsitAICatalog, Log, All);

/**
 * Единственный владелец снимка каталога в мире (Co-44).
 * Читает каталог один раз на GameThread, когда мир начал игру и SML закрыл реестр модового контента.
 * Подписки зоны Catalog/ обновляют разблокировки в снимке или вызывают RefreshCatalog() при смене контента.
 * В инертном режиме мода (мультиплеер, ADR-016, §4.2) каталог не читается и снимок не отдаётся.
 */
UCLASS()
class AFicsitAICatalogOwner : public AModSubsystem
{
    GENERATED_BODY()

public:
    AFicsitAICatalogOwner();

    virtual void Tick(float DeltaSeconds) override;
    virtual void EndPlay(const EEndPlayReason::Type EndPlayReason) override;

    static AFicsitAICatalogOwner* Get(const UObject* WorldContext);

    /** Снимок или nullptr, пока каталог не прочитан или мод инертен. Указатель живёт до следующего RefreshCatalog(). */
    const FicsitAI::Catalog::FSnapshot* GetSnapshot() const;

    /** Перечитать каталог сейчас. При неудаче прежний снимок остаётся; в инертном режиме — false. Только GameThread. */
    bool RefreshCatalog();

private:
    const class AFicsitAISubsystem* FindModSubsystem() const;

    /** Мод активен: подсистема мода есть и не перешла в инертный режим. */
    bool IsModActive() const;

    void HandleCatalogChanged(bool bContentChanged);

    UPROPERTY(Transient)
    TObjectPtr<class UFicsitAICatalogChangeListener> ChangeListener;

    TOptional<FicsitAI::Catalog::FSnapshot> Snapshot;
    int32 FailedAttempts = 0;
};
