#pragma once

#include "CoreMinimal.h"
#include "UObject/Interface.h"
#include "FicsitAIApiTypes.h"
#include "IFicsitAIApi.generated.h"

class FFicsitAIApiClient;

UINTERFACE(MinimalAPI, BlueprintType)
class UFicsitAIApi : public UInterface
{
    GENERATED_BODY()
};

/**
 * Публичный API мода (§3.6, docs/interfaces/public-api-v0.md).
 * Единственный путь модуля к данным и операциям (ADR-023). Хост кладёт его в FFicsitAIScreenContext::Api.
 *
 * Клиент подключается и дальше работает через своё подключение: запросы, события, лимит — на подключение.
 */
class FICSITAIAPI_API IFicsitAIApi
{
    GENERATED_BODY()
public:
    /** Версия контракта, которую отдаёт мод: "0.5.0". */
    virtual FString GetApiVersion() const = 0;

    /** Подключить клиента. Только GameThread. */
    virtual TSharedRef<FFicsitAIApiClient> Connect(const FFicsitAIApiClientInfo& Info) = 0;
};
