#pragma once

#include "CoreMinimal.h"
#include "UObject/Interface.h"
#include "IFicsitAIApi.generated.h"

UINTERFACE(MinimalAPI, BlueprintType)
class UFicsitAIApi : public UInterface
{
    GENERATED_BODY()
};

/**
 * Публичный API мода (§3.6, docs/interfaces/public-api-v0.md).
 * Единственный путь модуля к данным и операциям (ADR-023).
 */
class FICSITAIAPI_API IFicsitAIApi
{
    GENERATED_BODY()
};
