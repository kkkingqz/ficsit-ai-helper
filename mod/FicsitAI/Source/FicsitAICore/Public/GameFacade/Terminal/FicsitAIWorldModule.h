#pragma once

#include "CoreMinimal.h"
#include "Module/GameWorldModule.h"
#include "FicsitAIWorldModule.generated.h"

/**
 * Корневой игровой модуль мира FICSIT AI (SML 3.12).
 * Автоматически регистрирует подсистему AFicsitAISubsystem и схему терминала через mSchematics.
 */
UCLASS()
class FICSITAICORE_API UFicsitAIWorldModule : public UGameWorldModule
{
    GENERATED_BODY()

public:
    UFicsitAIWorldModule();
};
