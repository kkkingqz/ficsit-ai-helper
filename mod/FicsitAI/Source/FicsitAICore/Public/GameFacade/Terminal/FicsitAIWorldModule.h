#pragma once

#include "CoreMinimal.h"
#include "Module/GameWorldModule.h"
#include "FicsitAIWorldModule.generated.h"

/**
 * Игровой модуль мира FICSIT AI.
 * Регистрирует подсистему AFicsitAISubsystem при запуске мира.
 */
UCLASS()
class FICSITAICORE_API UFicsitAIWorldModule : public UGameWorldModule
{
    GENERATED_BODY()

public:
    UFicsitAIWorldModule();
};
