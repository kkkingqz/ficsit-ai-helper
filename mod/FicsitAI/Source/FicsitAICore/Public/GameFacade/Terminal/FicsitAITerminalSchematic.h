#pragma once

#include "CoreMinimal.h"
#include "FGSchematic.h"
#include "Unlocks/FGUnlockRecipe.h"
#include "FicsitAITerminalSchematic.generated.h"

/**
 * Разблокировка рецепта терминала для схемы FICSIT AI.
 */
UCLASS()
class FICSITAICORE_API UFicsitAIUnlockTerminalRecipe : public UFGUnlockRecipe
{
    GENERATED_BODY()

public:
    UFicsitAIUnlockTerminalRecipe();
};

/**
 * Схема разблокировки терминала FICSIT AI в HUB / Milestone.
 * Архитектура: ARCHITECTURE.md §5.1, ADR-016, Spike S1.
 */
UCLASS()
class FICSITAICORE_API UFicsitAITerminalSchematic : public UFGSchematic
{
    GENERATED_BODY()

public:
    UFicsitAITerminalSchematic();
};
