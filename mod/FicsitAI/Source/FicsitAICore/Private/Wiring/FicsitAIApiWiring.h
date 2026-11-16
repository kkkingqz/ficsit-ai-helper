#pragma once

#include "CoreMinimal.h"
#include "Subsystems/WorldSubsystem.h"
#include "FicsitAIApiWiring.generated.h"

/**
 * Проводка API мира к состоянию мода (V-2): SaveId и инертный режим из AFicsitAISubsystem — в статус API.
 *
 * Подсистема мира создаётся движком сама, регистрации в модуле мира не нужно. Опрос раз в полсекунды: у подсистемы
 * мода нет событий смены SaveId и инертного режима, а сравнение строки и флага ничего не стоит.
 * Источник данных Live подключается здесь же, когда появится (Gf, V-2).
 */
UCLASS()
class UFicsitAIApiWiring : public UTickableWorldSubsystem
{
    GENERATED_BODY()

public:
    virtual bool ShouldCreateSubsystem(UObject* Outer) const override;
    virtual void Tick(float DeltaTime) override;
    virtual TStatId GetStatId() const override;

private:
    float SinceSync = 0.0f;
    bool bSynced = false;
    FString LastSaveId;
    bool bLastInert = false;
};
