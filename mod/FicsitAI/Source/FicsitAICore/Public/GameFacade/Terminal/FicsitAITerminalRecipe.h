#pragma once

#include "CoreMinimal.h"
#include "FGRecipe.h"
#include "FicsitAITerminalRecipe.generated.h"

/**
 * Рецепт строительства терминала FICSIT AI.
 * Архитектура: ARCHITECTURE.md §5.1, ADR-016, Spike S1.
 */
UCLASS()
class FICSITAICORE_API UFicsitAITerminalRecipe : public UFGRecipe
{
    GENERATED_BODY()

public:
    UFicsitAITerminalRecipe();
};
