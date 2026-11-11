#pragma once

#include "CoreMinimal.h"
#include "Resources/FGBuildingDescriptor.h"
#include "FicsitAITerminalDescriptor.generated.h"

/**
 * Дескриптор строительного объекта AI Terminal для каталога рецептов и Build Gun.
 * Архитектура: ARCHITECTURE.md §3.1, §5.1, Spike S1.
 */
UCLASS()
class FICSITAICORE_API UFicsitAITerminalDescriptor : public UFGBuildingDescriptor
{
    GENERATED_BODY()

public:
    UFicsitAITerminalDescriptor();
};
